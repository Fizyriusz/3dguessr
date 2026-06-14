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
  onLocationChange: (lat: number, lng: number, heading?: number) => void;
};

const DRONE_SCALE = 22.0; // Change this value to adjust the drone size in the environment

const lerpAngle = (current: number, target: number, step: number) => {
  let diff = ((target - current + 180) % 360) - 180;
  return (current + diff * step + 360) % 360;
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
  const droneHeadingRef = useRef<number>(0);
  const droneTiltRef = useRef<number>(0);
  const droneRollRef = useRef<number>(0);

  // Keyboard controls state
  const keys = useRef({ w: false, s: false, a: false, d: false, q: false, e: false });

  // Wait for maps3d custom elements to be registered by the script in index.html
  // Do NOT call importLibrary() here – the script tag already loaded maps3d,
  // calling it again causes 'Element already defined' double-registration errors.
  useEffect(() => {
    let active = true;
    const initAPI = async () => {
      const startTime = Date.now();
      // Poll until gmp-map-3d custom element is defined (registered by the bootstrap script)
      while (!customElements.get('gmp-map-3d')) {
        if (Date.now() - startTime > 15000) {
          if (active) setApiError(true);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      if (active) setApiLoaded(true);
    };

    initAPI();
    return () => { active = false; };
  }, []);

  // Prevent native scroll wheel zoom and auto-tilt
  useEffect(() => {
    if (!apiLoaded) return;
    const mapEl = mapRef.current;
    if (mapEl) {
      const handleWheel = (e: WheelEvent) => {
        e.preventDefault();
      };
      mapEl.addEventListener("wheel", handleWheel, { passive: false });
      return () => {
        mapEl.removeEventListener("wheel", handleWheel);
      };
    }
  }, [apiLoaded]);

  const targetLat = targetLocation?.lat;
  const targetLng = targetLocation?.lng;

  // Sync starting location and query elevation when round changes or API loads
  useEffect(() => {
    if (targetLat != null && targetLng != null) {
      const isSameLocation = positionRef.current && 
                             positionRef.current.lat === targetLat && 
                             positionRef.current.lng === targetLng;

      if (!isSameLocation) {
        // Set a sensible starting altitude (300m MSL fallback) immediately so we don't spawn underground
        positionRef.current = {
          lat: targetLat,
          lng: targetLng,
          altitude: 300,
        };
        headingRef.current = 0;
      }

      if (apiLoaded) {
        // Query the actual elevation from Google Maps ElevationService
        const queryElevation = () => {
          try {
            const ElevationService = (window as any).google?.maps?.ElevationService;
            if (ElevationService) {
              const elevator = new ElevationService();
              elevator.getElevationForLocations({
                locations: [{ lat: targetLat, lng: targetLng }]
              }, (results: any, status: any) => {
                if (status === "OK" && results && results[0]) {
                  const elev = results[0].elevation;
                  console.log("Resolved ground elevation:", elev);
                  positionRef.current = {
                    lat: targetLat,
                    lng: targetLng,
                    altitude: elev + 40, // 40 meters above resolved ground level
                  };
                }
              });
            }
          } catch (e) {
            console.error("Failed to query ground elevation:", e);
          }
        };

        queryElevation();
      }
    }
  }, [targetLat, targetLng, apiLoaded]);

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
      if (key === "q") keys.current.q = true;
      if (key === "e") keys.current.e = true;
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === "w" || e.key === "ArrowUp") keys.current.w = false;
      if (key === "s" || e.key === "ArrowDown") keys.current.s = false;
      if (key === "a" || e.key === "ArrowLeft") keys.current.a = false;
      if (key === "d" || e.key === "ArrowRight") keys.current.d = false;
      if (key === "q") keys.current.q = false;
      if (key === "e") keys.current.e = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const cameraTiltRef = useRef<number>(65);

  const onLocationChangeRef = useRef(onLocationChange);
  useEffect(() => {
    onLocationChangeRef.current = onLocationChange;
  }, [onLocationChange]);

  // Main Flight & Camera Loop
  useEffect(() => {
    if (!apiLoaded || targetLat == null || targetLng == null) return;

    let animFrameId: number;
    let lastTime = performance.now();
    let lastSocketSendTime = 0;
    let initialized = false;

    const loop = (time: number) => {
      const dt = (time - lastTime) / 1000; // time delta in seconds
      lastTime = time;

      // Clamp delta to avoid massive jumps during tab suspension
      const clampedDt = Math.min(dt, 0.1);

      const mapEl = mapRef.current;
      const droneEl = droneRef.current;
      const pos = positionRef.current;

      if (mapEl && droneEl && pos) {
        // Read camera heading and tilt from map element
        let currentHeading = mapEl.heading ?? headingRef.current;
        let currentTilt = mapEl.tilt ?? cameraTiltRef.current;

        // Clamp camera tilt to maintain a good viewing angle (prevent flipping or looking straight down)
        if (currentTilt > 85) {
          currentTilt = 85;
        } else if (currentTilt < 40) {
          currentTilt = 40;
        }

        // Save them to refs
        headingRef.current = currentHeading;
        cameraTiltRef.current = currentTilt;

        // Initialize camera on first frame
        if (!initialized) {
          initialized = true;
          mapEl.center = { lat: pos.lat, lng: pos.lng, altitude: pos.altitude };
          mapEl.tilt = currentTilt;
          mapEl.heading = currentHeading;
          mapEl.range = 94;
        }

        // 1. Rotation control (A/D) - rotates the camera heading
        const ROTATION_SPEED = 90; // degrees per second
        let headingChanged = false;
        if (keys.current.a) {
          currentHeading = (currentHeading - ROTATION_SPEED * clampedDt + 360) % 360;
          headingChanged = true;
        }
        if (keys.current.d) {
          currentHeading = (currentHeading + ROTATION_SPEED * clampedDt) % 360;
          headingChanged = true;
        }

        if (headingChanged) {
          mapEl.heading = currentHeading;
          headingRef.current = currentHeading;
        }

        // 1.5. Tilt control (Q/E) - tilts the camera up and down
        const TILT_SPEED = 45; // degrees per second
        let tiltChanged = false;
        if (keys.current.q) {
          currentTilt = Math.max(40, currentTilt - TILT_SPEED * clampedDt);
          tiltChanged = true;
        }
        if (keys.current.e) {
          currentTilt = Math.min(85, currentTilt + TILT_SPEED * clampedDt);
          tiltChanged = true;
        }

        if (tiltChanged) {
          mapEl.tilt = currentTilt;
          cameraTiltRef.current = currentTilt;
        }

        // 2. Translational forward/backward control (W/S) relative to current camera heading
        const MAX_SPEED = 50; // meters per second
        if (keys.current.w || keys.current.s) {
          const dir = keys.current.w ? 1 : -1;
          const headingRad = (currentHeading * Math.PI) / 180;
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

        // Drone heading logic
        let targetDroneHeading = droneHeadingRef.current;
        if (keys.current.w) {
          targetDroneHeading = currentHeading;
        } else if (keys.current.s) {
          targetDroneHeading = (currentHeading + 180) % 360;
        }
        
        // Smoothly interpolate current drone heading towards target
        droneHeadingRef.current = lerpAngle(droneHeadingRef.current, targetDroneHeading, Math.min(1, 10 * clampedDt));

        // Drone tilt (pitch) logic
        const targetTiltVal = keys.current.w ? 10 : (keys.current.s ? -10 : 0);
        droneTiltRef.current = droneTiltRef.current + (targetTiltVal - droneTiltRef.current) * Math.min(1, 8 * clampedDt);

        // Drone roll logic
        const targetRollVal = keys.current.a ? -15 : (keys.current.d ? 15 : 0);
        droneRollRef.current = droneRollRef.current + (targetRollVal - droneRollRef.current) * Math.min(1, 8 * clampedDt);

        // 3. Update local drone model properties
        droneEl.position = {
          lat: pos.lat,
          lng: pos.lng,
          altitude: pos.altitude,
        };
        droneEl.orientation = {
          heading: droneHeadingRef.current,
          tilt: droneTiltRef.current,
          roll: droneRollRef.current,
        };

        // 4. Always track drone position with camera center (smooth follow)
        //    Explicitly re-apply heading, tilt, and range to prevent mapEl.center resets from overriding them
        mapEl.center = {
          lat: pos.lat,
          lng: pos.lng,
          altitude: pos.altitude,
        };
        mapEl.heading = currentHeading;
        mapEl.tilt = currentTilt;
        mapEl.range = 94;

        // 5. Throttled websocket position update (20Hz)
        if (time - lastSocketSendTime > 50) {
          lastSocketSendTime = time;
          onLocationChangeRef.current(pos.lat, pos.lng, droneHeadingRef.current);
        }
      }

      animFrameId = requestAnimationFrame(loop);
    };

    animFrameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrameId);
  }, [apiLoaded, targetLat, targetLng]);


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
        center={targetLocation ? { lat: targetLocation.lat, lng: targetLocation.lng } : undefined}
        tilt={65}
        range={94}
        mode="SATELLITE"
      >
        {/* Local Player Drone – scale must be set as a JS property (number), not HTML attribute */}
        {targetLocation && (
          <gmp-model-3d
            ref={(el: any) => {
              droneRef.current = el;
              if (el) el.scale = DRONE_SCALE;
            }}
            src="/models/sample.glb"
            altitude-mode="absolute"
          />
        )}

        {/* Other Players (Rendered as distinct 3D Markers/Models) */}
        {targetLocation &&
          players.flatMap((p) => {
            if (p.id === localPlayerId) return [];
            return [
              <gmp-model-3d
                key={`model-${p.id}`}
                ref={(el: any) => {
                  if (el) el.scale = DRONE_SCALE;
                }}
                src="/models/sample.glb"
                position={{ lat: p.lat, lng: p.lng, altitude: 40 }}
                altitude-mode="relative-to-ground"
                orientation={{ heading: p.heading ?? 0, tilt: 0, roll: 0 }}
              />,
              <gmp-marker-3d
                key={`marker-${p.id}`}
                position={{ lat: p.lat, lng: p.lng, altitude: 50 }}
                altitude-mode="relative-to-ground"
                extruded={true}
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
            ];
          })}
      </gmp-map-3d>
    </div>
  );
}
