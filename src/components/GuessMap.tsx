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
  const [isHovered, setIsHovered] = useState(false);

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

    // Add tiles based on current theme
    const initialUrl = theme === "light"
      ? "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
      : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

    const tiles = L.tileLayer(initialUrl, {
      maxZoom: 19
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

  // Sync Map Theme when theme changes
  useEffect(() => {
    if (!tileLayerRef.current) return;
    const url = theme === "light"
      ? "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
      : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
    tileLayerRef.current.setUrl(url);
  }, [theme]);

  // Effect 1: Handle Round resets (Clear local guess pin and reset map view once per round)
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

  // Handle map resizing when hovered/expanded
  useEffect(() => {
    if (mapRef.current) {
      setTimeout(() => {
        mapRef.current?.invalidateSize();
      }, 300);
    }
  }, [isHovered, status]);

  const handleGuessSubmit = () => {
    if (selectedLatLng) {
      onGuessSubmit(selectedLatLng.lat, selectedLatLng.lng);
    }
  };

  // Determine container dimensions based on game phase and hover state
  const isResultsMode = status === "ROUND_RESULTS" || status === "GAME_OVER";
  
  const mapStyle: React.CSSProperties = isResultsMode 
    ? {
        width: "100%",
        height: "100%",
        borderRadius: "0px",
        transition: "all 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
      }
    : {
        width: isHovered ? "420px" : "320px",
        height: isHovered ? "320px" : "220px",
        borderRadius: "16px",
        transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
      };

  return (
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
      onMouseEnter={() => !isResultsMode && setIsHovered(true)}
      onMouseLeave={() => !isResultsMode && setIsHovered(false)}
    >
      <div 
        ref={mapContainerRef} 
        style={{ 
          width: "100%", 
          height: "100%", 
          border: isResultsMode ? "none" : "2px solid var(--glass-border)",
          borderRadius: isResultsMode ? "0px" : "16px",
          boxShadow: isResultsMode ? "none" : "0 10px 30px rgba(0, 0, 0, 0.5)"
        }} 
      />
      
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
            padding: "8px 20px",
            fontSize: "14px"
          }}
          disabled={!selectedLatLng}
          onClick={handleGuessSubmit}
        >
          {selectedLatLng ? "Zatwierdź wybór (Guess)" : "Zaznacz na mapie"}
        </button>
      )}
    </div>
  );
}
