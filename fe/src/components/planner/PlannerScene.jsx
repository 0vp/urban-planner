import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { Edges, Grid, OrbitControls, TransformControls } from '@react-three/drei'
import { usePlannerStore } from '../../lib/planner/plannerStore'

function useExtrudedGeometry(footprint = [], height = 1) {
  return useMemo(() => {
    if (!footprint.length) {
      return null
    }

    const shape = new THREE.Shape()
    footprint.forEach((point, index) => {
      const y = -point.z
      if (index === 0) {
        shape.moveTo(point.x, y)
      } else {
        shape.lineTo(point.x, y)
      }
    })
    shape.closePath()

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(0.1, height),
      bevelEnabled: false,
    })

    geometry.rotateX(-Math.PI / 2)
    return geometry
  }, [footprint, height])
}

function Ground({ theme, onClearSelection }) {
  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.01, 0]}
        receiveShadow
        onPointerDown={(event) => {
          event.stopPropagation()
          onClearSelection()
        }}
      >
        <planeGeometry args={[5000, 5000]} />
        <meshStandardMaterial color={theme.ground.color} />
      </mesh>
      <Grid
        args={[4000, 4000]}
        cellSize={10}
        cellThickness={0.45}
        cellColor={theme.ground.gridCell}
        sectionSize={100}
        sectionThickness={0.8}
        sectionColor={theme.ground.gridSection}
        fadeDistance={800}
        fadeStrength={1}
        followCamera
        infiniteGrid
      />
    </>
  )
}

function SegmentedRibbon({ entity, color, thickness = 0.14, onSelect }) {
  const path = entity.geometry.path ?? []
  const width = entity.style.width ?? 6

  if (path.length < 2) {
    return null
  }

  return (
    <group>
      {path.slice(0, -1).map((point, index) => {
        const next = path[index + 1]
        const dx = next.x - point.x
        const dz = next.z - point.z
        const length = Math.hypot(dx, dz)

        if (length < 0.01) {
          return null
        }

        const angle = -Math.atan2(dz, dx)

        return (
          <mesh
            key={`${entity.id}-${index}`}
            position={[(point.x + next.x) / 2, thickness / 2, (point.z + next.z) / 2]}
            rotation={[0, angle, 0]}
            receiveShadow
            onPointerDown={(event) => {
              event.stopPropagation()
              onSelect(entity.id)
            }}
          >
            <boxGeometry args={[length, thickness, width]} />
            <meshStandardMaterial color={color} roughness={0.95} metalness={0.04} />
          </mesh>
        )
      })}
    </group>
  )
}

function EntityMesh({ entity, theme, selected, tool, onSelect }) {
  const groupRef = useRef(null)
  const updateEntityTransform = usePlannerStore((state) => state.updateEntityTransform)
  const beginTransformChange = usePlannerStore((state) => state.beginTransformChange)

  const transformMode =
    tool === 'move' ? 'translate' : tool === 'rotate' ? 'rotate' : tool === 'scale' ? 'scale' : null

  const canTransform = selected && Boolean(transformMode)

  const selectedColor = theme.layers.selected
  const buildingColor = selected
    ? selectedColor
    : theme.zones[entity.style.zone] ?? entity.style.color ?? theme.zones.default
  const roadColor = selected ? selectedColor : entity.style.color ?? theme.layers.roads
  const riverColor = selected ? selectedColor : entity.style.color ?? theme.layers.rivers
  const parkColor = selected ? selectedColor : entity.style.color ?? theme.layers.parks

  const buildingGeometry = useExtrudedGeometry(entity.geometry.footprint, entity.style.height ?? 14)
  const parkGeometry = useExtrudedGeometry(entity.geometry.footprint, entity.style.height ?? 0.5)

  const body = (
    <group
      ref={groupRef}
      position={entity.transform.position}
      rotation={entity.transform.rotation}
      scale={entity.transform.scale}
      onPointerDown={(event) => {
        event.stopPropagation()
        onSelect(entity.id)
      }}
    >
      {entity.type === 'building' && buildingGeometry && (
        <mesh castShadow receiveShadow geometry={buildingGeometry}>
          <meshStandardMaterial color={buildingColor} roughness={0.7} metalness={0.06} />
          <Edges color={theme.layers.buildingOutline} linewidth={1} />
        </mesh>
      )}

      {entity.type === 'road' && <SegmentedRibbon entity={entity} color={roadColor} onSelect={onSelect} />}

      {entity.type === 'river' && (
        <SegmentedRibbon entity={entity} color={riverColor} thickness={0.08} onSelect={onSelect} />
      )}

      {entity.type === 'park' && parkGeometry && (
        <mesh castShadow receiveShadow geometry={parkGeometry}>
          <meshStandardMaterial color={parkColor} roughness={1} metalness={0} />
          <Edges color={theme.layers.buildingOutline} linewidth={1} />
        </mesh>
      )}
    </group>
  )

  if (!canTransform) {
    return body
  }

  return (
    <TransformControls
      mode={transformMode}
      onMouseDown={() => beginTransformChange()}
      onObjectChange={() => {
        if (!groupRef.current) {
          return
        }

        updateEntityTransform(entity.id, {
          position: groupRef.current.position.toArray(),
          rotation: groupRef.current.rotation.toArray().slice(0, 3),
          scale: groupRef.current.scale.toArray(),
        })
      }}
    >
      {body}
    </TransformControls>
  )
}

export function PlannerScene({ theme }) {
  const entities = usePlannerStore((state) => state.entities)
  const layers = usePlannerStore((state) => state.layers)
  const selectedEntityId = usePlannerStore((state) => state.selectedEntityId)
  const tool = usePlannerStore((state) => state.tool)
  const selectEntity = usePlannerStore((state) => state.selectEntity)
  const clearSelection = usePlannerStore((state) => state.clearSelection)

  const visibleEntities = useMemo(() => {
    return entities.filter((entity) => layers[entity.type] !== false)
  }, [entities, layers])

  return (
    <Canvas
      shadows
      dpr={[1, 1.6]}
      gl={{ antialias: true }}
      camera={{ position: [220, 160, 220], fov: 45, near: 0.1, far: 9000 }}
      onPointerMissed={(event) => {
        if (event.type === 'click') {
          clearSelection()
        }
      }}
    >
      <color attach="background" args={[theme.scene.background]} />
      <fog attach="fog" args={[theme.scene.fog, theme.scene.fogNear, theme.scene.fogFar]} />
      <ambientLight intensity={theme.lighting.ambient} />
      <hemisphereLight
        intensity={theme.lighting.hemisphere}
        skyColor={theme.lighting.skyColor}
        groundColor={theme.lighting.groundColor}
      />
      <directionalLight
        castShadow
        color={theme.lighting.sunColor}
        intensity={theme.lighting.directional}
        position={[220, 280, 140]}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />

      <Ground theme={theme} onClearSelection={clearSelection} />

      {visibleEntities.map((entity) => (
        <EntityMesh
          key={entity.id}
          entity={entity}
          theme={theme}
          selected={selectedEntityId === entity.id}
          tool={tool}
          onSelect={selectEntity}
        />
      ))}

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        maxPolarAngle={Math.PI / 2.03}
        minDistance={20}
        maxDistance={1700}
      />
    </Canvas>
  )
}
