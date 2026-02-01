import React, { useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';

function Box({ position, color, label }) {
  const meshRef = useRef();
  const [hovered, setHovered] = useState(false);
  return (
    <group position={position}>
      <mesh
        ref={meshRef}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        scale={hovered ? 1.1 : 1}
      >
        <boxGeometry args={[1.2, 1.2, 1.2]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 1.2, 0]}>
        <planeGeometry args={[1.5, 0.3]} />
        <meshBasicMaterial color="#1a1a2e" transparent opacity={0.9} />
      </mesh>
    </group>
  );
}

function Scene() {
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 5, 5]} intensity={1} />
      <Box position={[0, 1.5, 0]} color="#1f2937" label="FOCUS" />
      <Box position={[-1.8, -0.5, 0]} color="#fce7f3" label="QUICK" />
      <Box position={[1.8, -0.5, 0]} color="#a78bfa" label="WAITING" />
      <gridHelper args={[10, 10, '#e5e7eb', '#f3f4f6']} position={[0, -2, 0]} />
    </>
  );
}

function DailyOrbit() {
  return (
    <div className="daily-orbit-container">
      <h2 className="sections-title">Daily Orbit</h2>
      <p className="orbit-subtitle">FOCUS · QUICK · WAITING</p>
      <div className="orbit-canvas-wrap">
        <Canvas camera={{ position: [0, 0, 6], fov: 50 }}>
          <Scene />
          <OrbitControls enableZoom enablePan />
        </Canvas>
      </div>
    </div>
  );
}

export default DailyOrbit;
