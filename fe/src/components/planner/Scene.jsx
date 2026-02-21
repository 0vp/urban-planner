import { MOUSE } from 'three'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { GridPlane } from './GridPlane'

export function Scene() {
  return (
    <Canvas
      camera={{ position: [8, 8, 8], fov: 50 }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={['#0a0a0a']} />
      <ambientLight intensity={1} />
      <GridPlane />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.1}
        mouseButtons={{
          LEFT: MOUSE.ROTATE,
          MIDDLE: MOUSE.PAN,
          RIGHT: MOUSE.ROTATE,
        }}
      />
    </Canvas>
  )
}
