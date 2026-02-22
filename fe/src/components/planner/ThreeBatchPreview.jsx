import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { buildThreeBatchData } from '../../lib/planner/threeBatchRenderer'

function BuildingInstances({ buildings }) {
  const meshRef = useRef(null)

  useEffect(() => {
    if (!meshRef.current) {
      return
    }

    const matrix = new THREE.Matrix4()
    const quaternion = new THREE.Quaternion()

    buildings.forEach((building, index) => {
      const position = new THREE.Vector3(...building.position)
      const scale = new THREE.Vector3(...building.scale)
      matrix.compose(position, quaternion, scale)
      meshRef.current.setMatrixAt(index, matrix)
    })

    meshRef.current.instanceMatrix.needsUpdate = true
  }, [buildings])

  if (buildings.length === 0) {
    return null
  }

  return (
    <instancedMesh ref={meshRef} args={[null, null, buildings.length]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#b0b6bd" transparent opacity={0.5} />
    </instancedMesh>
  )
}

function SegmentBatch({ positions, color, opacity }) {
  const geometry = useMemo(() => {
    const next = new THREE.BufferGeometry()

    if (positions.length > 0) {
      next.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    }

    return next
  }, [positions])

  useEffect(() => () => geometry.dispose(), [geometry])

  if (positions.length === 0) {
    return null
  }

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={color} transparent opacity={opacity} />
    </lineSegments>
  )
}

export function ThreeBatchPreview({ features }) {
  const batch = useMemo(() => buildThreeBatchData(features), [features])

  return (
    <div className="h-56 w-full rounded-md border border-zinc-800 overflow-hidden">
      <Canvas camera={{ position: [80, 80, 80], fov: 45 }}>
        <color attach="background" args={['#09090b']} />
        <ambientLight intensity={0.8} />
        <directionalLight position={[60, 90, 30]} intensity={0.75} />

        <group rotation={[-Math.PI / 2, 0, 0]}>
          <gridHelper args={[300, 24, '#334155', '#1f2937']} />
          <BuildingInstances buildings={batch.buildings} />
          <SegmentBatch positions={batch.roads} color="#e4a11b" opacity={0.95} />
          <SegmentBatch positions={batch.rivers} color="#4ea8de" opacity={0.95} />
          <SegmentBatch positions={batch.parks} color="#5ee08b" opacity={0.9} />
        </group>

        <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
      </Canvas>
    </div>
  )
}
