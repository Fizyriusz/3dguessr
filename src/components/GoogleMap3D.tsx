import { useEffect, useRef, useState } from "react";

// Register custom HTML5 elements in TypeScript JSX types
declare global {
  namespace JSX {
    interface IntrinsicElements {
      "gmp-map-3d": any;
      "gmp-model-3d": any;
      "gmp-marker-3d": any;
    }
  }
  namespace React {
    namespace JSX {
      interface IntrinsicElements {
        "gmp-map-3d": any;
        "gmp-model-3d": any;
        "gmp-marker-3d": any;
      }
    }
  }
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "gmp-map-3d": any;
      "gmp-model-3d": any;
      "gmp-marker-3d": any;
    }
  }
}

type GoogleMap3DProps = {
  targetLocation: { lat: number; lng: number } | null;
  players: any[];
  localPlayerId: string;
  onLocationChange: (lat: number, lng: number) => void;
};

export function GoogleMap3D({
  targetLocation,
  players,
  localPlayerId,
  onLocationChange,
}: GoogleMap3DProps) {
  const mapRef = useRef<any>(null);
  const droneRef = useRef<any>(null);

  const [apiLoaded, setApiLoaded] = useState(false);
  const [apiError, setApiError] = useState(false);

  // Flight states (held in refs for requestAnimationFrame speed/concurrency)
  const positionRef = useRef<{ lat: number; lng: number; altitude: number } | null>(null);
  const headingRef = useRef<number>(0); // 0 = North, 90 = East, 180 = South, 270 = West

  // Keyboard controls state
  const keys = useRef({ w: false, s: false, a: false, d: false });

  // Initialize Maps3D library and wait for custom elements registration
  useEffect(() => {
    let active = true;
    const initAPI = async () => {
      const startTime = Date.now();
      // Poll until the bootstrap script loads and window.google.maps exists
      while (!window.google || !window.google.maps || !window.google.maps.importLibrary) {
        if (Date.now() - startTime > 10000) {
          // Timeout after 10s
          if (active) setApiError(true);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      try {
        // Force-load the maps3d library which registers the custom elements in the browser
        await window.google.maps.importLibrary("maps3d");
        if (active) {
          setApiLoaded(true);
        }
      } catch (err) {
        console.error("Failed to load maps3d library:", err);
        if (active) setApiError(true);
      }
    };

    initAPI();
    return () => {
      active = false;
    };
  }, []);

  // Sync starting location when round changes
  useEffect(() => {
    if (targetLocation) {
      positionRef.current = {
        lat: targetLocation.lat,
        lng: targetLocation.lng,
        altitude: 50, // 50m above ground
      };
      headingRef.current = 0;
    }
  }, [targetLocation]);

  // Key Event Listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore key events if the user is typing in a form input
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "w" || e.key === "ArrowUp") keys.current.w = true;
      if (key === "s" || e.key === "ArrowDown") keys.current.s = true;
      if (key === "a" || e.key === "ArrowLeft") keys.current.a = true;
      if (key === "d" || e.key === "ArrowRight") keys.current.d = true;
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === "w" || e.key === "ArrowUp") keys.current.w = false;
      if (key === "s" || e.key === "ArrowDown") keys.current.s = false;
      if (key === "a" || e.key === "ArrowLeft") keys.current.a = false;
      if (key === "d" || e.key === "ArrowRight") keys.current.d = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // Main Flight & Camera Loop
  useEffect(() => {
    if (!apiLoaded || !targetLocation) return;

    let animFrameId: number;
    let lastTime = performance.now();
    let lastSocketSendTime = 0;

    const loop = (time: number) => {
      const dt = (time - lastTime) / 1000; // time delta in seconds
      lastTime = time;

      // Clamp delta to avoid massive jumps during tab suspension
      const clampedDt = Math.min(dt, 0.1);

      const mapEl = mapRef.current;
      const droneEl = droneRef.current;
      const pos = positionRef.current;

      if (mapEl && droneEl && pos) {
        // 1. Rotation control (A/D)
        const ROTATION_SPEED = 110; // degrees per second
        if (keys.current.a) {
          headingRef.current = (headingRef.current - ROTATION_SPEED * clampedDt + 360) % 360;
        }
        if (keys.current.d) {
          headingRef.current = (headingRef.current + ROTATION_SPEED * clampedDt) % 360;
        }

        // 2. Translational forward/backward control (W/S)
        const MAX_SPEED = 35; // meters per second
        if (keys.current.w || keys.current.s) {
          const dir = keys.current.w ? 1 : -1;
          const headingRad = (headingRef.current * Math.PI) / 180;
          const dLatDir = Math.cos(headingRad);
          const dLngDir = Math.sin(headingRad);

          // Convert speed meters to latitude/longitude degree changes
          const metersPerDegreeLat = 111132;
          const metersPerDegreeLng = 111132 * Math.cos((pos.lat * Math.PI) / 180);

          const latSpeed = (MAX_SPEED * dir * dLatDir) / metersPerDegreeLat;
          const lngSpeed = (MAX_SPEED * dir * dLngDir) / metersPerDegreeLng;

          pos.lat += latSpeed * clampedDt;
          pos.lng += lngSpeed * clampedDt;
        }

        // 3. Update local drone model properties
        droneEl.position = {
          lat: pos.lat,
          lng: pos.lng,
          altitude: pos.altitude,
        };
        droneEl.orientation = {
          heading: headingRef.current,
          tilt: 0,
          roll: 0,
        };

        // 4. Update camera to follow drone
        mapEl.center = {
          lat: pos.lat,
          lng: pos.lng,
          altitude: pos.altitude,
        };
        mapEl.heading = headingRef.current;
        mapEl.tilt = 65; // looking down at a nice angle
        mapEl.range = 40; // distance behind drone in meters

        // 5. Throttled websocket position update (20Hz)
        if (time - lastSocketSendTime > 50) {
          lastSocketSendTime = time;
          onLocationChange(pos.lat, pos.lng);
        }
      }

      animFrameId = requestAnimationFrame(loop);
    };

    animFrameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrameId);
  }, [apiLoaded, targetLocation, onLocationChange]);

  if (apiError) {
    return (
      <div
        className="glass-panel"
        style={{
          margin: "40px auto",
          padding: "24px",
          maxWidth: "450px",
          textAlign: "center",
          borderLeft: "4px solid #ef4444",
        }}
      >
        <h3 style={{ margin: "0 0 10px 0", color: "#ef4444" }}>Błąd wczytywania 3D</h3>
        <p style={{ margin: 0, fontSize: "13px", color: "var(--text-secondary)" }}>
          Nie udało się zainicjować biblioteki Google 3D. Upewnij się, że klucz API posiada uprawnienia do obsługi Map 3D.
        </p>
      </div>
    );
  }

  if (!apiLoaded) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          width: "100%",
          height: "100%",
          background: "#0c0a09",
        }}
      >
        <div className="glass-panel animate-pulse" style={{ padding: "20px 40px", color: "#818cf8" }}>
          Inicjalizacja Google 3D Earth...
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {/* Google 3D Custom Map Element */}
      <gmp-map-3d
        ref={mapRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      >
        {/* Local Player Drone (Binary glTF Cube served locally) */}
        {targetLocation && (
          <gmp-model-3d
            ref={droneRef}
            src="/models/drone.glb"
            altitude-mode="relative-to-ground"
            scale="1.5"
          />
        )}

        {/* Other Players (Rendered as distinct 3D Markers/Models) */}
        {targetLocation &&
          players.map((p) => {
            if (p.id === localPlayerId) return null;
            return (
              <gmp-marker-3d
                key={p.id}
                position={`${p.lat}, ${p.lng}, 50`}
                altitude-mode="relative-to-ground"
                extruded="true"
              >
                {/* Visual Label showing player's name tag in 3D space */}
                <div
                  style={{
                    background: "rgba(12, 10, 9, 0.85)",
                    border: "1px solid rgba(251, 191, 36, 0.6)",
                    color: "#fbbf24",
                    padding: "3px 6px",
                    borderRadius: "4px",
                    fontSize: "10px",
                    fontWeight: 800,
                    whiteSpace: "nowrap",
                    transform: "translate(-50%, -100%)",
                    boxShadow: "0 0 10px rgba(0,0,0,0.5)",
                    pointerEvents: "none",
                  }}
                >
                  🛸 {p.nickname}
                </div>
              </gmp-marker-3d>
            );
          })}
      </gmp-map-3d>
    </div>
  );
}
