import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

type DronePlayerProps = {
  targetLocation: { lat: number; lng: number } | null;
  onLocationChange: (lat: number, lng: number) => void;
};

export function DronePlayer({ targetLocation, onLocationChange }: DronePlayerProps) {
  const droneRef = useRef<THREE.Mesh>(null);
  const velocity = useRef(new THREE.Vector3());
  const lastUpdateTime = useRef(0);

  // Keep track of keys pressed
  const keys = useRef({ w: false, s: false, a: false, d: false });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore key events if user is typing in an input
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

  const yaw = useRef(0);

  useFrame((state, delta) => {
    if (!droneRef.current || !targetLocation) return;

    // Movement Parameters
    const MAX_SPEED = 30; // meters per second
    const ACCEL = 8; // Acceleration rate
    const ROTATION_SPEED = 2.0; // radians per second

    // Update heading (yaw) with A/D keys
    if (keys.current.a) {
      yaw.current += ROTATION_SPEED * delta;
    }
    if (keys.current.d) {
      yaw.current -= ROTATION_SPEED * delta;
    }

    // Set drone mesh heading
    droneRef.current.rotation.y = yaw.current;

    // Calculate heading directions
    const forwardDir = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw.current);
    
    // Calculate target velocity vector
    const targetVelocity = new THREE.Vector3();
    if (keys.current.w) {
      targetVelocity.addScaledVector(forwardDir, MAX_SPEED);
    }
    if (keys.current.s) {
      targetVelocity.addScaledVector(forwardDir, -MAX_SPEED);
    }

    // Smoothly interpolate current velocity vector (frame-rate independent)
    const lerpFactor = 1 - Math.exp(-ACCEL * delta);
    velocity.current.lerp(targetVelocity, lerpFactor);

    // Apply movement
    const pos = droneRef.current.position;
    pos.addScaledVector(velocity.current, delta);

    // Lock Altitude (Y) always to 50
    pos.y = 50;

    // Camera Smooth Follow: Camera offset is 10m back (+Z) and 5m up (+Y) rotated by yaw
    const cameraOffset = new THREE.Vector3(0, 5, 10).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw.current);
    const targetCameraPos = pos.clone().add(cameraOffset);
    state.camera.position.lerp(targetCameraPos, 0.1);
    state.camera.lookAt(pos);

    // Coordinate Projection (Three.js coordinates back to lat/lng)
    const startLat = targetLocation.lat;
    const startLng = targetLocation.lng;

    // Approximations of earth curvature at round center
    const metersPerDegreeLat = 111132;
    const metersPerDegreeLng = 111132 * Math.cos(startLat * Math.PI / 180);

    // North is -Z, East is +X
    const currentLat = startLat + (-pos.z) / metersPerDegreeLat;
    const currentLng = startLng + pos.x / metersPerDegreeLng;

    // Throttled update triggers
    const now = performance.now();
    if (now - lastUpdateTime.current > 50) { // Sync at 20Hz
      lastUpdateTime.current = now;
      onLocationChange(currentLat, currentLng);
    }
  });

  return (
    <mesh ref={droneRef} position={[0, 50, 0]} castShadow receiveShadow>
      <boxGeometry args={[2, 1, 2]} />
      {/* Sleek dark metallic drone theme */}
      <meshStandardMaterial 
        color="#312e81" 
        roughness={0.2} 
        metalness={0.9} 
        emissive="#4338ca"
        emissiveIntensity={0.4}
      />
    </mesh>
  );
}
