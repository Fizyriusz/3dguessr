import { TilesRenderer, TilesPlugin, TilesAttributionOverlay } from "3d-tiles-renderer/r3f";
import { CesiumIonAuthPlugin, TileCompressionPlugin } from "3d-tiles-renderer/plugins";
import * as THREE from "three";
import { useMemo, useRef, useCallback } from "react";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { Html } from "@react-three/drei";

function getElevation(lat: number): number {
  if (Math.abs(lat - 49.2958) < 0.05) return 830; // Zakopane
  if (Math.abs(lat - 50.0626) < 0.05) return 220; // Kraków
  if (Math.abs(lat - 52.2304) < 0.05) return 110; // Warszawa
  if (Math.abs(lat - 51.1098) < 0.05 || Math.abs(lat - 51.1143) < 0.05) return 120; // Wrocław
  if (Math.abs(lat - 52.4082) < 0.05) return 85; // Poznań
  if (Math.abs(lat - 53.0103) < 0.05) return 50; // Toruń
  if (Math.abs(lat - 54.4443) < 0.05) return 40; // Sopot
  if (Math.abs(lat - 54.0405) < 0.05) return 15; // Malbork
  if (Math.abs(lat - 54.3486) < 0.05) return 5; // Gdańsk
  return 100; // default fallback
}

const CESIUM_ION_ACCESS_TOKEN = import.meta.env.VITE_CESIUM_ION_ACCESS_TOKEN || "";
const CESIUM_AUTH_ARGS = [{ apiToken: CESIUM_ION_ACCESS_TOKEN, assetId: 96188 }];

// Initialize DRACOLoader once
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");



export function World3D({ 
  targetLocation,
  players = [],
  localPlayerId
}: { 
  targetLocation: { lat: number; lng: number } | null;
  players?: any[];
  localPlayerId?: string;
}) {
  const tilesRef = useRef<any>(null);
  const failedUrls = useRef<Set<string>>(new Set());

  const onTilesRendererRef = useCallback((tiles: any) => {
    if (tiles) {
      tilesRef.current = tiles;

      // Force progressive tile display - show low-res tiles immediately while high-res load
      tiles.displayActiveTiles = true;

      // Configure limits
      tiles.downloadQueue.maxJobs = 64;
      tiles.lruCache.maxBytesSize = 2048 * 1024 * 1024; // 2GB

      // Configure GLTFLoader to use DRACOLoader for compressed Cesium Tiles
      const manager = tiles.manager;
      const gltfLoader = new GLTFLoader(manager);
      gltfLoader.setDRACOLoader(dracoLoader);
      
      manager.addHandler(/\.gltf$/, gltfLoader);
      manager.addHandler(/\.glb$/, gltfLoader);

      // Preprocess URL to block failed tiles
      tiles.preprocessURL = (uri: string) => {
        const match = uri.match(/\/files\/([^./?]+)\.glb/);
        if (match) {
          const fileId = match[1];
          if (failedUrls.current.has(fileId)) {
            // Return an empty, minimal GLTF to resolve instantly without network request
            return 'data:application/json,{"asset":{"version":"2.0"},"scenes":[{"nodes":[]}],"nodes":[]}#.gltf';
          }
        }
        return uri;
      };

      // Add event listener directly to original TilesRenderer for safety
      tiles.addEventListener('load-error', (e: any) => {
        const url = e.url;
        if (url) {
          const match = url.match(/\/files\/([^./?]+)\.glb/);
          if (match) {
            const fileId = match[1];
            failedUrls.current.add(fileId);
            console.warn(`[TilesRenderer] Blacklisted failed tile: ${fileId}`);
          }
        }
      });
    }
  }, []);

  const { position, quaternion } = useMemo(() => {
    if (!targetLocation) {
      // Default fallback values if no location is active (should not happen in ROUND_ACTIVE, but good for safety)
      return { position: new THREE.Vector3(0, 0, 0), quaternion: new THREE.Quaternion() };
    }
    const lat = targetLocation.lat;
    const lon = targetLocation.lng;
    const height = getElevation(lat); 

    // WGS84 ECEF constants
    const a = 6378137.0; 
    const e2 = 0.00669437999014; 
    
    const latRad = THREE.MathUtils.degToRad(lat);
    const lonRad = THREE.MathUtils.degToRad(lon);

    const n = a / Math.sqrt(1 - e2 * Math.sin(latRad) * Math.sin(latRad));
    const x = (n + height) * Math.cos(latRad) * Math.cos(lonRad);
    const y = (n + height) * Math.cos(latRad) * Math.sin(lonRad);
    const z = (n * (1 - e2) + height) * Math.sin(latRad);

    const ecefPosition = new THREE.Vector3(x, y, z);
    
    // Normal vector at the surface
    const normal = new THREE.Vector3(
      Math.cos(latRad) * Math.cos(lonRad),
      Math.cos(latRad) * Math.sin(lonRad),
      Math.sin(latRad)
    ).normalize();

    // ENU (East, North, Up) Basis Vectors
    const zAxis = normal; // Up in ENU becomes Y in Three.js later
    const xAxis = new THREE.Vector3(-Math.sin(lonRad), Math.cos(lonRad), 0).normalize(); // East
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize(); // North
    
    // Three.js uses Y-up, -Z forward. We want North to be -Z.
    // So East -> +X, North -> -Z, Up -> +Y
    const enuMatrix = new THREE.Matrix4().makeBasis(
      xAxis, 
      zAxis, 
      yAxis.clone().negate() 
    );
    
    // The matrix that transforms from ECEF to our desired ENU space
    const ecefToEnu = enuMatrix.invert();
    
    const rotationQuat = new THREE.Quaternion().setFromRotationMatrix(ecefToEnu);
    // Apply rotation to the negative ecefPosition to find the translation needed to put it at 0,0,0
    const translation = ecefPosition.clone().negate().applyQuaternion(rotationQuat);
    
    return { position: translation, quaternion: rotationQuat };
  }, [targetLocation]);

  return (
    <group>
      <color attach="background" args={["#0c0a09"]} />
      <fog attach="fog" args={["#0c0a09", 100, 600]} />

      <ambientLight intensity={0.5} />
      <directionalLight position={[200, 300, 100]} intensity={1.8} castShadow />
      <hemisphereLight args={["#818cf8", "#0c0a09", 0.7]} />
      
      {/* Helper grid at local origin (Y=0, ground level) */}
      <gridHelper args={[2000, 100, '#4f46e5', '#334155']} position={[0, 0, 0]} />

      {targetLocation && (
        <group position={position} quaternion={quaternion}>
          <group name="TilesRenderer">
            <TilesRenderer 
              ref={onTilesRendererRef} 
              errorTarget={2} 
              displayActiveTiles={true}
              onLoadModel={(e: any) => {
                if (e && e.scene) {
                  e.scene.traverse((child: any) => {
                    if (child.isMesh && child.material) {
                      // Apply slate gray structural material for styled architectural aesthetic
                      child.material = new THREE.MeshStandardMaterial({
                        color: new THREE.Color("#334155"), // slate-700
                        roughness: 0.5,
                        metalness: 0.1,
                        flatShading: true,
                        side: THREE.DoubleSide
                      });
                      child.castShadow = true;
                      child.receiveShadow = true;
                    }
                  });
                }
              }}
              onLoadError={(e: any) => {
                console.error("Tile load error:", e?.error || e);
                if (e?.tile?.content?.uri) {
                  const uri = e.tile.content.uri;
                  const match = uri.match(/\/files\/([^./?]+)\.glb/);
                  if (match) {
                    const fileId = match[1];
                    failedUrls.current.add(fileId);
                    console.warn(`[React onLoadError] Blacklisted failed tile: ${fileId}`);
                  }
                }
              }}
            >
              <TilesPlugin plugin={CesiumIonAuthPlugin} args={CESIUM_AUTH_ARGS} />
              <TilesPlugin plugin={TileCompressionPlugin} />
              <TilesAttributionOverlay />
            </TilesRenderer>
          </group>
        </group>
      )}

      {/* Other Players 3D Representation */}
      {targetLocation && players.map((p) => {
        if (p.id === localPlayerId) return null;

        const startLat = targetLocation.lat;
        const startLng = targetLocation.lng;
        const metersPerDegreeLat = 111132;
        const metersPerDegreeLng = 111132 * Math.cos(startLat * Math.PI / 180);

        // Compute local position coordinates relative to target center
        const px = (p.lng - startLng) * metersPerDegreeLng;
        const pz = -(p.lat - startLat) * metersPerDegreeLat;

        return (
          <group key={p.id} position={[px, 50, pz]}>
            {/* Glowing sphere drone for other player */}
            <mesh castShadow>
              <sphereGeometry args={[1.5, 16, 16]} />
              <meshStandardMaterial 
                color="#fbbf24" 
                roughness={0.2}
                metalness={0.8}
                emissive="#f59e0b"
                emissiveIntensity={0.6}
              />
            </mesh>
            {/* Nickname tag hovering above player */}
            <Html distanceFactor={40} position={[0, 3.5, 0]} center>
              <div 
                className="glass-panel"
                style={{
                  background: "rgba(12, 10, 9, 0.85)",
                  border: "1px solid rgba(251, 191, 36, 0.5)",
                  color: "#fbbf24",
                  padding: "4px 8px",
                  borderRadius: "6px",
                  fontSize: "11px",
                  fontWeight: 800,
                  whiteSpace: "nowrap",
                  pointerEvents: "none",
                  boxShadow: "0 0 10px rgba(251, 191, 36, 0.2)"
                }}
              >
                {p.nickname}
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}
