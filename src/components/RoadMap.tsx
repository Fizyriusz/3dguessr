import { useEffect, useRef } from "react";
import L from "leaflet";

type MapPlayer = {
  id: string;
  nickname: string;
  lat: number;
  lng: number;
  isHost: boolean;
};

type RoadMapProps = {
  players: MapPlayer[];
  localPlayerId: string;
  theme: "light" | "dark";
};

// Seeded random color generator for player beans based on their ID
function getPlayerColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return `hsl(${Math.abs(hash) % 360}, 80%, 55%)`;
}

export function RoadMap({ players, localPlayerId, theme }: RoadMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Center initially on Poland
    const map = L.map(mapContainerRef.current, {
      center: [52.0689, 19.4797],
      zoom: 16, // Zoomed in on local roads (RPG style)
      zoomControl: false,
      attributionControl: false,
      dragging: true,
      touchZoom: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false
    });

    // Add Dark Mode tiles initially
    const initialUrl = theme === "light"
      ? "https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png"
      : "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png";

    const tiles = L.tileLayer(initialUrl, {
      maxZoom: 19
    }).addTo(map);

    tileLayerRef.current = tiles;

    L.control.zoom({ position: "topright" }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      markersRef.current.clear();
    };
  }, []);

  // Sync Map Theme when theme changes
  useEffect(() => {
    if (!tileLayerRef.current) return;
    const url = theme === "light"
      ? "https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png"
      : "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png";
    tileLayerRef.current.setUrl(url);
  }, [theme]);

  // Sync player bean markers in real-time
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentMarkers = markersRef.current;

    // Track active player IDs
    const activePlayerIds = new Set(players.map(p => p.id));

    // Remove markers of players who left
    for (const [id, marker] of currentMarkers.entries()) {
      if (!activePlayerIds.has(id)) {
        marker.remove();
        currentMarkers.delete(id);
      }
    }

    // Add or update player markers
    players.forEach(player => {
      const playerColor = getPlayerColor(player.id);
      const isLocal = player.id === localPlayerId;

      // Custom divicon with CSS capsule shape and eye dots
      const beanIcon = L.divIcon({
        className: "", // Empty to disable Leaflet default box
        html: `
          <div class="player-bean-wrapper">
            <div class="player-bean" style="background-color: ${playerColor}; border-color: ${isLocal ? '#fbbf24' : 'white'};"></div>
            <div class="player-bean-label" style="border-color: ${isLocal ? 'rgba(251, 191, 36, 0.4)' : 'rgba(255, 255, 255, 0.15)'}">
              ${player.nickname} ${isLocal ? '(Ty)' : ''}
            </div>
          </div>
        `,
        iconSize: [60, 60],
        iconAnchor: [30, 30]
      });

      const marker = currentMarkers.get(player.id);

      if (marker) {
        // Smoothly pan marker to new coordinates
        marker.setLatLng([player.lat, player.lng]);
      } else {
        // Create new marker
        const newMarker = L.marker([player.lat, player.lng], { icon: beanIcon }).addTo(map);
        currentMarkers.set(player.id, newMarker);
      }
    });

    // Auto-center map around the local player's bean
    const localPlayer = players.find(p => p.id === localPlayerId);
    if (localPlayer) {
      map.panTo([localPlayer.lat, localPlayer.lng]);
    }
  }, [players, localPlayerId]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div 
        ref={mapContainerRef} 
        style={{ 
          width: "100%", 
          height: "100%",
          borderLeft: "1px solid var(--glass-border)"
        }} 
      />
      {/* Visual Indicator of Controls */}
      <div 
        className="glass-panel"
        style={{
          position: "absolute",
          top: "16px",
          left: "16px",
          zIndex: 1000,
          padding: "8px 16px",
          fontSize: "12px",
          color: "#6366f1",
          fontWeight: 700,
          pointerEvents: "none"
        }}
      >
        🗺️ MAPA DRÓG (Widzisz tu inne fasolki)
      </div>
    </div>
  );
}
