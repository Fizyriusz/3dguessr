import { useEffect, useRef, useState } from "react";

// Declare global variables for window
declare global {
  interface Window {
    google: any;
  }
}

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

type MapPlayer = {
  id: string;
  nickname: string;
  lat: number;
  lng: number;
};

type StreetViewPlayProps = {
  lat: number;
  lng: number;
  onLocationChange: (lat: number, lng: number) => void;
  players: MapPlayer[];
  localPlayerId: string;
};

// Seeded random color generator for player beans based on their ID (consistent with RoadMap.tsx)
function getPlayerColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return `hsl(${Math.abs(hash) % 360}, 80%, 55%)`;
}

export function StreetViewPlay({ lat, lng, onLocationChange, players, localPlayerId }: StreetViewPlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panoramaRef = useRef<any>(null);
  const [loaded, setLoaded] = useState(false);
  const [scriptError, setScriptError] = useState(false);

  // Keep track of the last locally snapped coordinates to avoid feedback loops with the parent props
  const lastLocalCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const isSearchingRef = useRef(false);

  // Store Google Maps Marker instances for other players
  const markersRef = useRef<Map<string, { marker: any }>>(new Map());

  // Keep the latest callback reference in a ref to avoid stale closures in the window keydown listener
  const onLocationChangeRef = useRef(onLocationChange);

  useEffect(() => {
    onLocationChangeRef.current = onLocationChange;
  }, [onLocationChange]);

  // Dynamic loading of Google Maps API
  useEffect(() => {
    if (window.google && window.google.maps) {
      setLoaded(true);
      return;
    }

    const scriptId = "google-maps-script";
    let script = document.getElementById(scriptId) as HTMLScriptElement;

    if (!script) {
      script = document.createElement("script");
      script.id = scriptId;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${API_KEY}&v=weekly`;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }

    const handleScriptLoad = () => {
      setLoaded(true);
    };

    const handleScriptError = () => {
      setScriptError(true);
      console.error("Failed to load Google Maps SDK script.");
    };

    script.addEventListener("load", handleScriptLoad);
    script.addEventListener("error", handleScriptError);

    return () => {
      script.removeEventListener("load", handleScriptLoad);
      script.removeEventListener("error", handleScriptError);
    };
  }, []);

  // Initialize Street View Panorama
  useEffect(() => {
    if (!loaded || !containerRef.current || !window.google?.maps) return;

    try {
      if (!panoramaRef.current) {
        // Find the nearest official Google Street View panorama to snap to on initial mount
        const svService = new window.google.maps.StreetViewService();
        svService.getPanorama({
          location: { lat, lng },
          radius: 150,
          source: window.google.maps.StreetViewSource.GOOGLE
        }, (data: any, status: any) => {
          let startPos = { lat, lng };
          if (status === window.google.maps.StreetViewStatus.OK && data && data.location && data.location.latLng) {
            startPos = { lat: data.location.latLng.lat(), lng: data.location.latLng.lng() };
            lastLocalCoordsRef.current = startPos;
            onLocationChangeRef.current(startPos.lat, startPos.lng); // Sync back immediately
          }

          panoramaRef.current = new window.google.maps.StreetViewPanorama(containerRef.current, {
            position: startPos,
            pov: { heading: 0, pitch: 0 },
            zoom: 0,
            addressControl: false,
            showRoadLabels: false,
            linksControl: false, // Disable default navigation arrows
            clickToGo: false,    // Disable clicking to move
            panControl: true,
            enableCloseButton: false,
            source: window.google.maps.StreetViewSource.GOOGLE // Restrict to official Google imagery
          });

          // Listen for position changes (e.g. when moved by W/S keys)
          panoramaRef.current.addListener("position_changed", () => {
            const pos = panoramaRef.current.getPosition();
            if (pos) {
              const posLat = pos.lat();
              const posLng = pos.lng();
              // Only trigger callback if it's different from our last local coords to prevent loop spam
              if (!lastLocalCoordsRef.current || 
                  Math.abs(lastLocalCoordsRef.current.lat - posLat) > 0.00001 || 
                  Math.abs(lastLocalCoordsRef.current.lng - posLng) > 0.00001) {
                lastLocalCoordsRef.current = { lat: posLat, lng: posLng };
                onLocationChangeRef.current(posLat, posLng);
              }
            }
          });
        });
      }
    } catch (err) {
      console.error("Error creating Street View:", err);
    }
  }, [loaded]);

  // Synchronize coordinate updates from the parent (e.g., new rounds or host resets)
  useEffect(() => {
    if (!loaded || !panoramaRef.current) return;

    // Check if the change is a server teleportation (like a new round start)
    const isNewRound = !lastLocalCoordsRef.current ||
      Math.abs(lastLocalCoordsRef.current.lat - lat) > 0.0005 ||
      Math.abs(lastLocalCoordsRef.current.lng - lng) > 0.0005;

    if (isNewRound) {
      const svService = new window.google.maps.StreetViewService();
      svService.getPanorama({
        location: { lat, lng },
        radius: 150,
        source: window.google.maps.StreetViewSource.GOOGLE
      }, (data: any, status: any) => {
        if (status === window.google.maps.StreetViewStatus.OK && data && data.location && data.location.latLng) {
          const snappedLat = data.location.latLng.lat();
          const snappedLng = data.location.latLng.lng();
          lastLocalCoordsRef.current = { lat: snappedLat, lng: snappedLng };
          panoramaRef.current.setPosition(data.location.latLng);
          onLocationChangeRef.current(snappedLat, snappedLng); // Sync snapped coordinates back to server
        } else {
          lastLocalCoordsRef.current = { lat, lng };
          panoramaRef.current.setPosition({ lat, lng });
        }
      });
    }
  }, [loaded, lat, lng]);

  // Synchronize other players' markers inside the Street View 3D space
  useEffect(() => {
    if (!loaded || !panoramaRef.current || !window.google?.maps) return;

    const currentMarkers = markersRef.current;
    
    // Filter active players (excluding local player)
    const activePlayers = players.filter(p => p.id !== localPlayerId);
    const activePlayerIds = new Set(activePlayers.map(p => p.id));

    // Remove obsolete markers of players who left
    for (const [id, markerInfo] of currentMarkers.entries()) {
      if (!activePlayerIds.has(id)) {
        markerInfo.marker.setMap(null);
        currentMarkers.delete(id);
      }
    }

    // Add or update markers
    activePlayers.forEach(player => {
      const playerColor = getPlayerColor(player.id);
      
      // Dynamic SVG icon mapping the capsule color-coded bean design
      const svgString = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 50" width="30" height="50">
          <rect x="5" y="5" width="20" height="40" rx="10" ry="10" fill="${playerColor}" stroke="#FFFFFF" stroke-width="2" />
          <circle cx="11" cy="15" r="2" fill="#000000" />
          <circle cx="19" cy="15" r="2" fill="#000000" />
        </svg>
      `;
      const iconUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgString);
      const position = { lat: player.lat, lng: player.lng };

      const markerInfo = currentMarkers.get(player.id);

      if (markerInfo) {
        // Update existing marker position in Street View
        markerInfo.marker.setPosition(position);
      } else {
        // Create a new native Google Maps marker positioned inside Street View
        const marker = new window.google.maps.Marker({
          position,
          map: panoramaRef.current,
          icon: {
            url: iconUrl,
            scaledSize: new window.google.maps.Size(30, 50),
            anchor: new window.google.maps.Point(15, 50)
          },
          label: {
            text: player.nickname,
            color: "#ffffff",
            fontWeight: "bold",
            fontSize: "12px",
            className: "google-marker-label" // Styled in index.css
          }
        });

        currentMarkers.set(player.id, { marker });
      }
    });

  }, [loaded, players, localPlayerId]);

  // Clean up markers on unmount
  useEffect(() => {
    return () => {
      markersRef.current.forEach(item => item.marker.setMap(null));
      markersRef.current.clear();
    };
  }, []);

  // Keyboard navigation handler (WSAD / Arrows)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!panoramaRef.current) return;

      const key = e.key.toLowerCase();
      const isWalkKey = key === "w" || key === "s" || e.key === "ArrowUp" || e.key === "ArrowDown";
      const isRotateKey = key === "a" || key === "d" || e.key === "ArrowLeft" || e.key === "ArrowRight";

      if (!isWalkKey && !isRotateKey) return;

      // Intercept key events in capture phase so Google Maps standard handlers don't swallow them
      e.preventDefault();
      e.stopPropagation();

      const pov = panoramaRef.current.getPov();

      if (isRotateKey) {
        // Rotate camera heading smoothly
        const rotateDiff = 10; // degrees
        const direction = (key === "a" || e.key === "ArrowLeft") ? -1 : 1;
        const newHeading = (pov.heading + rotateDiff * direction + 360) % 360;
        panoramaRef.current.setPov({
          heading: newHeading,
          pitch: pov.pitch
        });
      } else if (isWalkKey) {
        // Calculate next coordinates based on heading
        const pos = panoramaRef.current.getPosition();
        if (!pos) return;

        if (isSearchingRef.current) return; // Prevent multiple requests at the same time

        const headingRad = (pov.heading * Math.PI) / 180;
        const stepSize = 0.00015; // movement step in degrees (~15 meters)
        const direction = (key === "w" || e.key === "ArrowUp") ? 1 : -1;

        const targetLat = pos.lat() + Math.cos(headingRad) * stepSize * direction;
        const targetLng = pos.lng() + Math.sin(headingRad) * stepSize * direction;

        isSearchingRef.current = true;

        const svService = new window.google.maps.StreetViewService();
        svService.getPanorama({
          location: { lat: targetLat, lng: targetLng },
          radius: 80,
          source: window.google.maps.StreetViewSource.GOOGLE // Restrict to official Google roads
        }, (data: any, status: any) => {
          isSearchingRef.current = false;
          if (status === window.google.maps.StreetViewStatus.OK && data && data.location && data.location.latLng) {
            const finalLat = data.location.latLng.lat();
            const finalLng = data.location.latLng.lng();
            lastLocalCoordsRef.current = { lat: finalLat, lng: finalLng };
            panoramaRef.current.setPosition(data.location.latLng);
            onLocationChangeRef.current(finalLat, finalLng);
          }
        });
      }
    };

    // Use capture phase (true) to intercept the event before Google Maps
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [loaded]);

  if (scriptError) {
    return (
      <div style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#111",
        color: "#ff4444",
        textAlign: "center",
        padding: "20px"
      }}>
        <h2>Błąd: Nie udało się wczytać SDK Google Maps. Sprawdź połączenie z internetem.</h2>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: "#0d0c1d"
      }}
    />
  );
}
