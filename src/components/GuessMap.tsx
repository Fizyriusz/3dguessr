import { useEffect, useRef, useState } from "react";
import L from "leaflet";

type MapPlayer = {
  id: string;
  nickname: string;
  guess: { lat: number; lng: number } | null;
  roundPoints: number;
  distance: number | null;
};

type GuessMapProps = {
  status: "LOBBY" | "ROUND_ACTIVE" | "ROUND_RESULTS" | "GAME_OVER";
  players: MapPlayer[];
  targetLocation: { lat: number; lng: number; name: string } | null;
  onGuessSubmit: (lat: number, lng: number) => void;
  hasGuessed: boolean;
  theme: "light" | "dark";
};

export function GuessMap({ status, players, targetLocation, onGuessSubmit, hasGuessed, theme }: GuessMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const resultLayersRef = useRef<L.LayerGroup | null>(null);
  
  const [selectedLatLng, setSelectedLatLng] = useState<{ lat: number; lng: number } | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // Use refs to avoid stale closures in the Leaflet map click handler
  const statusRef = useRef(status);
  const hasGuessedRef = useRef(hasGuessed);
  const lastTargetLocationRef = useRef<string | null>(null);

  useEffect(() => {
    statusRef.current = status;
    hasGuessedRef.current = hasGuessed;
  }, [status, hasGuessed]);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Create Leaflet Map centered on Poland
    const map = L.map(mapContainerRef.current, {
      center: [52.0689, 19.4797],
      zoom: 6,
      zoomControl: false,
      attributionControl: false
    });

    // Add Google Maps Roadmap tiles centered on Poland
    const initialUrl = "https://mt{s}.google.com/vt/lyrs=m&hl=pl&x={x}&y={y}&z={z}";

    const tiles = L.tileLayer(initialUrl, {
      subdomains: ["0", "1", "2", "3"],
      maxZoom: 20
    }).addTo(map);

    tileLayerRef.current = tiles;

    // Add zoom control in top right
    L.control.zoom({ position: "topright" }).addTo(map);

    mapRef.current = map;
    resultLayersRef.current = L.layerGroup().addTo(map);

    // Map click handler
    map.on("click", (e: L.LeafletMouseEvent) => {
      if (statusRef.current !== "ROUND_ACTIVE" || hasGuessedRef.current) return;

      const { lat, lng } = e.latlng;
      setSelectedLatLng({ lat, lng });

      // Custom pulse icon for the player's current selection
      const pulseIcon = L.divIcon({
        className: 'custom-pulse-marker',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      });

      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
      } else {
        markerRef.current = L.marker([lat, lng], { icon: pulseIcon }).addTo(map);
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      markerRef.current = null;
    };
  }, []);

  // Theme changes are handled via the CSS class on the container div
  useEffect(() => {
    // No action needed for Google Maps tiles URL, handled by CSS filter
  }, [theme]);

  // Effect 1: Handle Round resets (Clear local guess pin, auto-collapse map, and reset map view once per round)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (status === "ROUND_ACTIVE") {
      const targetKey = targetLocation ? `${targetLocation.lat},${targetLocation.lng}` : null;
      
      // Only reset if this is actually a new target location/round
      if (targetKey !== lastTargetLocationRef.current) {
        lastTargetLocationRef.current = targetKey;

        // Clear local selection pin
        if (markerRef.current) {
          markerRef.current.remove();
          markerRef.current = null;
        }
        setSelectedLatLng(null);

        // Reset map view to center on Poland
        map.setView([52.0689, 19.4797], 6);

        // Auto-collapse map for the new round
        setIsExpanded(false);
      }
    } else {
      // Clear target key when not active so it triggers reset properly next time
      lastTargetLocationRef.current = null;
    }
  }, [status, targetLocation]);

  // Effect 2: Handle Results phase (Draw player guesses and distance lines)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear previous results layer
    if (resultLayersRef.current) {
      resultLayersRef.current.clearLayers();
    }

    if ((status === "ROUND_RESULTS" || status === "GAME_OVER") && targetLocation && resultLayersRef.current) {
      // 1. Draw target location
      const targetIcon = L.divIcon({
        className: 'target-marker',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      });
      
      const targetMarker = L.marker([targetLocation.lat, targetLocation.lng], { icon: targetIcon })
        .bindTooltip(`<b>CEL:</b> ${targetLocation.name || "Prawidłowa lokalizacja"}`, { permanent: true, direction: "top", className: "glass-tooltip" });
      
      resultLayersRef.current.addLayer(targetMarker);

      // Collect all coordinates to fit bounds
      const boundsCoords: L.LatLngExpression[] = [[targetLocation.lat, targetLocation.lng]];

      // 2. Draw other players' guesses and link lines
      players.forEach(player => {
        if (player.guess) {
          const guessLatLng: L.LatLngExpression = [player.guess.lat, player.guess.lng];
          boundsCoords.push(guessLatLng);

          // Draw player guess marker
          const playerIcon = L.divIcon({
            className: 'custom-pulse-marker',
            iconSize: [14, 14],
            iconAnchor: [7, 7]
          });

          const playerMarker = L.marker(guessLatLng, { icon: playerIcon })
            .bindTooltip(`<b>${player.nickname}</b>: ${player.distance?.toFixed(1)} km (+${player.roundPoints} pkt)`, { permanent: false, direction: "top" });

          // Draw dotted line between player guess and target
          const polyline = L.polyline([guessLatLng, [targetLocation.lat, targetLocation.lng]], {
            color: "#6366f1", // Indigo-500
            weight: 2.5,
            dashArray: "6, 8",
            opacity: 0.85
          });

          resultLayersRef.current?.addLayer(playerMarker);
          resultLayersRef.current?.addLayer(polyline);
        }
      });

      // Fit map bounds to show target and guesses
      if (boundsCoords.length > 1) {
        const bounds = L.latLngBounds(boundsCoords);
        map.fitBounds(bounds.pad(0.15));
      } else {
        map.setView([targetLocation.lat, targetLocation.lng], 10);
      }
    }
  }, [status, targetLocation, players]);

  // Handle map resizing when expanded
  useEffect(() => {
    if (mapRef.current) {
      setTimeout(() => {
        mapRef.current?.invalidateSize();
      }, 300);
    }
  }, [isExpanded, status]);

  const handleGuessSubmit = () => {
    if (selectedLatLng) {
      onGuessSubmit(selectedLatLng.lat, selectedLatLng.lng);
    }
  };

  // Determine container dimensions based on game phase and expanded state
  const isResultsMode = status === "ROUND_RESULTS" || status === "GAME_OVER";
  const isCollapsed = status === "ROUND_ACTIVE" && !isExpanded;
  
  const mapStyle: React.CSSProperties = isResultsMode 
    ? {
        width: "100%",
        height: "100%",
        borderRadius: "0px",
        transition: "all 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
      }
    : {
        width: "min(680px, 90vw)",
        height: "min(500px, 70vh)",
        borderRadius: "16px",
        boxShadow: "0 12px 40px rgba(0, 0, 0, 0.6)",
        transform: isCollapsed ? "scale(0.85) translateY(20px)" : "scale(1) translateY(0)",
        opacity: isCollapsed ? 0 : 1,
        pointerEvents: isCollapsed ? "none" : "auto",
        transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
      };

  return (
    <>
      {status === "ROUND_ACTIVE" && isCollapsed && (
        <button
          className="btn-primary animate-fade-in"
          style={{
            position: "absolute",
            bottom: "24px",
            right: "24px",
            zIndex: 25,
            padding: "14px 28px",
            fontSize: "16px",
            fontWeight: 700,
            borderRadius: "30px",
            boxShadow: "0 8px 32px rgba(99, 102, 241, 0.4)",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            cursor: "pointer",
            border: "2px solid rgba(255, 255, 255, 0.2)",
            backdropFilter: "blur(8px)",
            whiteSpace: "nowrap"
          }}
          onClick={() => {
            setIsExpanded(true);
          }}
        >
          🗺️ {hasGuessed ? "Zobacz swój wybór" : "Zgadnij / Guess"}
        </button>
      )}

      <div
        style={{
          position: isResultsMode ? "relative" : "absolute",
          bottom: isResultsMode ? "auto" : "24px",
          right: isResultsMode ? "auto" : "24px",
          zIndex: 15,
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          ...mapStyle
        }}
      >
        <div 
          ref={mapContainerRef} 
          className={theme === "dark" ? "leaflet-google-dark" : ""}
          style={{ 
            width: "100%", 
            height: "100%", 
            border: isResultsMode ? "none" : "2px solid var(--glass-border)",
            borderRadius: isResultsMode ? "0px" : "16px",
            boxShadow: isResultsMode ? "none" : "0 10px 30px rgba(0, 0, 0, 0.5)"
          }} 
        />
        
        {!isResultsMode && (
          <button
            onClick={() => setIsExpanded(false)}
            style={{
              position: "absolute",
              top: "12px",
              left: "12px",
              zIndex: 1000,
              background: "rgba(13, 12, 29, 0.75)",
              border: "1px solid rgba(255, 255, 255, 0.2)",
              color: "white",
              width: "36px",
              height: "36px",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "16px",
              cursor: "pointer",
              backdropFilter: "blur(4px)",
              transition: "all 0.2s"
            }}
            title="Zwiń mapę"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(13, 12, 29, 0.9)";
              e.currentTarget.style.borderColor = "#6366f1";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(13, 12, 29, 0.75)";
              e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.2)";
            }}
          >
            ✕
          </button>
        )}

        {status === "ROUND_ACTIVE" && !hasGuessed && (
          <button
            className="btn-primary"
            style={{
              position: "absolute",
              bottom: "16px",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 1000,
              whiteSpace: "nowrap",
              padding: "10px 24px",
              fontSize: "15px",
              fontWeight: 700,
              boxShadow: "0 4px 15px rgba(99, 102, 241, 0.4)"
            }}
            disabled={!selectedLatLng}
            onClick={handleGuessSubmit}
          >
            {selectedLatLng ? "Zatwierdź wybór (Guess)" : "Zaznacz na mapie"}
          </button>
        )}

        {status === "ROUND_ACTIVE" && hasGuessed && (
          <div
            style={{
              position: "absolute",
              bottom: "16px",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 1000,
              background: "rgba(16, 185, 129, 0.9)",
              color: "white",
              padding: "8px 20px",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 700,
              whiteSpace: "nowrap",
              boxShadow: "0 4px 12px rgba(16, 185, 129, 0.3)"
            }}
          >
            ✓ Wybór zatwierdzony
          </div>
        )}
      </div>
    </>
  );
}
