import { TilesRenderer, TilesPlugin, TilesAttributionOverlay } from "3d-tiles-renderer/r3f";
import { CesiumIonAuthPlugin, TileCompressionPlugin } from "3d-tiles-renderer/plugins";
import * as THREE from "three";
import { useMemo, useRef, useCallback } from "react";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

const CESIUM_ION_ACCESS_TOKEN = import.meta.env.VITE_CESIUM_ION_ACCESS_TOKEN || "";
const CESIUM_AUTH_ARGS = [{ apiToken: CESIUM_ION_ACCESS_TOKEN, assetId: 96188 }];

// Initialize DRACOLoader once
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");



export function World3D({ targetLocation }: { targetLocation: { lat: number; lng: number } | null }) {
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
    const height = 0; 

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
      <ambientLight intensity={1.5} />
      <directionalLight position={[100, 200, 50]} intensity={2.5} castShadow />
      
      {/* Helper grid at local origin */}
      <gridHelper args={[1000, 100, '#ffffff', '#555555']} position={[0, 0, 0]} />

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
                      child.material.side = THREE.FrontSide;
                      child.material.transparent = false;
                      child.material.depthWrite = true;
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
    </group>
  );
}
