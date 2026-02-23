import { useEffect } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { ecefToEnu, lonLatToECEF } from '../../../lib/planner/i3sGeometryUtils'
import { DEFAULT_VIEW_STATE } from './constants'
import {
  applyRadiusClipShader,
  clamp,
  disposeObject,
  getFeaturePaths,
  lineColorForFeature,
} from './helpers'

function getFeatureWidthAndOffset(feature) {
  const isRiver = feature.entityType === 'river'
  const widthRaw = Number(feature?.attributes?.width)
  const width = Number.isFinite(widthRaw)
    ? clamp(widthRaw, 2, isRiver ? 50 : 30)
    : isRiver
      ? 8
      : 6

  return {
    width,
    zOffset: isRiver ? 0.8 : 0.6,
  }
}

function appendRibbonSegments(path, frame, width, zOffset, positions, indices) {
  if (!Array.isArray(path) || path.length < 2) {
    return 0
  }

  const halfWidth = Math.max(0.5, width / 2)
  let prevX = 0
  let prevY = 0
  let prevZ = 0
  let hasPrev = false
  let trianglesAdded = 0

  for (const point of path) {
    if (!Array.isArray(point) || point.length < 2) {
      continue
    }

    const lon = Number(point[0])
    const lat = Number(point[1])
    const alt = Number(point[2] || 0)
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(alt)) {
      continue
    }

    const ecef = lonLatToECEF(lon, lat, alt)
    const enu = ecefToEnu(ecef, frame)
    const x = enu[0]
    const y = enu[1]
    const z = enu[2]

    if (!hasPrev) {
      prevX = x
      prevY = y
      prevZ = z
      hasPrev = true
      continue
    }

    const dx = x - prevX
    const dy = y - prevY
    const length = Math.hypot(dx, dy)
    if (length < 1e-3) {
      prevX = x
      prevY = y
      prevZ = z
      continue
    }

    const nx = -dy / length
    const ny = dx / length
    const ox = nx * halfWidth
    const oy = ny * halfWidth
    const z0 = prevZ + zOffset
    const z1 = z + zOffset
    const base = positions.length / 3

    positions.push(
      prevX + ox, prevY + oy, z0,
      prevX - ox, prevY - oy, z0,
      x - ox, y - oy, z1,
      x + ox, y + oy, z1,
    )
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    trianglesAdded += 2

    prevX = x
    prevY = y
    prevZ = z
  }

  return trianglesAdded
}

function buildRoadOrRiverMesh(entityType, sourceFeatures, frame, radiusUniformRef, selected = false) {
  const positions = []
  const indices = []
  const triangleFeatureIndices = []
  const featureIds = []
  const featureMetaById = Object.create(null)
  const featureIndexById = new Map()

  for (const feature of sourceFeatures) {
    if (feature.entityType !== entityType) {
      continue
    }

    const paths = getFeaturePaths(feature)
    if (!paths.length) {
      continue
    }

    const sourceId = String(feature.id)
    let featureIndex = featureIndexById.get(sourceId)
    if (featureIndex === undefined) {
      featureIndex = featureIds.length
      featureIndexById.set(sourceId, featureIndex)
      featureIds.push(sourceId)
      featureMetaById[sourceId] = {
        entityType: feature.entityType,
        name: feature.attributes?.name || feature.entityType,
      }
    }

    const { width, zOffset } = getFeatureWidthAndOffset(feature)
    let totalTrianglesForFeature = 0

    for (const path of paths) {
      totalTrianglesForFeature += appendRibbonSegments(path, frame, width, zOffset, positions, indices)
    }

    for (let i = 0; i < totalTrianglesForFeature; i += 1) {
      triangleFeatureIndices.push(featureIndex)
    }
  }

  if (!positions.length) {
    return null
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
  const vertexCount = positions.length / 3
  const indexArray = vertexCount > 65535 ? new Uint32Array(indices) : new Uint16Array(indices)
  geometry.setIndex(new THREE.BufferAttribute(indexArray, 1))
  geometry.computeBoundingSphere()

  const color = lineColorForFeature(entityType, selected)
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color[0] / 255, color[1] / 255, color[2] / 255),
    transparent: true,
    opacity: color[3] / 255,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  })
  applyRadiusClipShader(
    material,
    radiusUniformRef.current,
    selected ? `planner-radius-clip-feature-selected-${entityType}-v2` : `planner-radius-clip-feature-${entityType}-v2`,
  )

  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.renderOrder = selected ? 21 : 20
  mesh.userData = {
    mergedFeatureMesh: !selected,
    selectionOverlay: selected,
    entityType,
    featureIds,
    featureMetaById,
    triangleFeatureIndices: triangleFeatureIndices.length ? Uint32Array.from(triangleFeatureIndices) : null,
  }

  return mesh
}

export function usePlannerScene({
  mountRef,
  animationRef,
  syncTimerRef,
  syncQueuedRef,
  rendererRef,
  sceneRef,
  cameraRef,
  controlsRef,
  basemapGroupRef,
  i3sGroupRef,
  featureGroupRef,
  highlightGroupRef,
  transformAnchorRef,
  moveTransformControlsRef,
  mapViewStateRef,
  queueTileSync,
  deriveMapViewState,
  placeCameraFromView,
  clearBasemapTiles,
  clearTileRecords,
  features,
  selectedFeatureId,
  enuFrameRef,
  radiusClipUniformRef,
}) {
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) {
      return
    }

    const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.92
    renderer.shadowMap.enabled = false
    mount.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0a0a0a)
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(55, mount.clientWidth / Math.max(1, mount.clientHeight), 3, 70000)
    camera.up.set(0, 0, 1)
    cameraRef.current = camera

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.12
    controls.maxDistance = 70000
    controls.minDistance = 45
    controls.maxPolarAngle = Math.PI / 2.02
    controls.screenSpacePanning = true
    controlsRef.current = controls

    const ambient = new THREE.AmbientLight(0xffffff, 0.2)
    scene.add(ambient)

    const hemi = new THREE.HemisphereLight(0xffffff, 0x1a2334, 0.48)
    scene.add(hemi)

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.15)
    dirLight.position.set(900, -700, 1400)
    dirLight.castShadow = false
    scene.add(dirLight)

    const fillLight = new THREE.DirectionalLight(0xa3b5d8, 0.34)
    fillLight.position.set(-1100, 850, 920)
    scene.add(fillLight)

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(60000, 60000),
      new THREE.MeshStandardMaterial({ color: 0x0D0D0D, roughness: 1, metalness: 0 }),
    )
    ground.rotation.x = 0
    ground.position.z = -120
    ground.receiveShadow = false
    scene.add(ground)

    const grid = new THREE.GridHelper(24000, 48, 0xffffff, 0xffffff)
    grid.rotation.x = Math.PI / 2
    grid.material.transparent = true
    grid.material.opacity = 0.3
    grid.material.depthWrite = false
    grid.renderOrder = 12
    scene.add(grid)

    const basemapGroup = new THREE.Group()
    const i3sGroup = new THREE.Group()
    const featureGroup = new THREE.Group()
    const highlightGroup = new THREE.Group()
    const transformAnchor = new THREE.Object3D()
    transformAnchor.visible = false
    scene.add(basemapGroup)
    scene.add(i3sGroup)
    scene.add(featureGroup)
    scene.add(highlightGroup)
    scene.add(transformAnchor)
    basemapGroupRef.current = basemapGroup
    i3sGroupRef.current = i3sGroup
    featureGroupRef.current = featureGroup
    highlightGroupRef.current = highlightGroup
    transformAnchorRef.current = transformAnchor

    const moveTransformControls = new TransformControls(camera, renderer.domElement)
    const moveTransformHelper = moveTransformControls.getHelper()
    moveTransformControls.setMode('translate')
    moveTransformControls.setSpace('world')
    moveTransformControls.setSize(0.95)
    moveTransformControls.enabled = false
    moveTransformControls.visible = false
    scene.add(moveTransformHelper)
    moveTransformControlsRef.current = moveTransformControls

    const onTransformDraggingChanged = (event) => {
      controls.enabled = !event.value
    }
    moveTransformControls.addEventListener('dragging-changed', onTransformDraggingChanged)

    placeCameraFromView(DEFAULT_VIEW_STATE, [0, 0, 0])
    queueTileSync()
    const startupSyncRaf = requestAnimationFrame(() => {
      queueTileSync()
    })

    const onResize = () => {
      const width = Math.max(1, mount.clientWidth)
      const height = Math.max(1, mount.clientHeight)
      renderer.setSize(width, height)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      queueTileSync()
    }

    const onControlsChanged = () => {
      mapViewStateRef.current = deriveMapViewState()
      queueTileSync()
    }

    const onControlsEnded = () => {
      mapViewStateRef.current = deriveMapViewState()
      queueTileSync()
    }

    controls.addEventListener('change', onControlsChanged)
    controls.addEventListener('end', onControlsEnded)
    window.addEventListener('resize', onResize)

    const animate = () => {
      animationRef.current = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(startupSyncRaf)
      cancelAnimationFrame(animationRef.current)
      controls.removeEventListener('change', onControlsChanged)
      controls.removeEventListener('end', onControlsEnded)
      controls.dispose()
      window.removeEventListener('resize', onResize)
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current)
        syncTimerRef.current = 0
      }
      syncQueuedRef.current = false
      clearBasemapTiles()
      clearTileRecords()
      while (featureGroup.children.length) {
        const child = featureGroup.children.pop()
        disposeObject(child)
      }
      while (highlightGroup.children.length) {
        const child = highlightGroup.children.pop()
        disposeObject(child)
      }
      moveTransformControls.removeEventListener('dragging-changed', onTransformDraggingChanged)
      moveTransformControls.detach()
      scene.remove(moveTransformHelper)
      moveTransformControls.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement)
      }
      rendererRef.current = null
      sceneRef.current = null
      cameraRef.current = null
      controlsRef.current = null
      basemapGroupRef.current = null
      i3sGroupRef.current = null
      featureGroupRef.current = null
      highlightGroupRef.current = null
      transformAnchorRef.current = null
      moveTransformControlsRef.current = null
    }
  }, [
    animationRef,
    basemapGroupRef,
    cameraRef,
    clearBasemapTiles,
    clearTileRecords,
    controlsRef,
    deriveMapViewState,
    featureGroupRef,
    highlightGroupRef,
    i3sGroupRef,
    moveTransformControlsRef,
    mountRef,
    mapViewStateRef,
    placeCameraFromView,
    queueTileSync,
    rendererRef,
    sceneRef,
    syncQueuedRef,
    syncTimerRef,
    transformAnchorRef,
  ])

  useEffect(() => {
    const featureGroup = featureGroupRef.current
    const frame = enuFrameRef.current
    if (!featureGroup || !frame) {
      return
    }

    while (featureGroup.children.length) {
      const child = featureGroup.children.pop()
      disposeObject(child)
    }

    const roadMesh = buildRoadOrRiverMesh('road', features, frame, radiusClipUniformRef)
    if (roadMesh) {
      featureGroup.add(roadMesh)
    }

    const riverMesh = buildRoadOrRiverMesh('river', features, frame, radiusClipUniformRef)
    if (riverMesh) {
      featureGroup.add(riverMesh)
    }
  }, [enuFrameRef, featureGroupRef, features, radiusClipUniformRef])

  useEffect(() => {
    const featureGroup = featureGroupRef.current
    const frame = enuFrameRef.current
    if (!featureGroup) {
      return
    }

    for (let i = featureGroup.children.length - 1; i >= 0; i -= 1) {
      const child = featureGroup.children[i]
      if (child?.userData?.selectionOverlay) {
        featureGroup.remove(child)
        disposeObject(child)
      }
    }

    if (!selectedFeatureId || !frame) {
      return
    }

    const selectedFeature = features.find((feature) => (
      (feature.entityType === 'road' || feature.entityType === 'river')
      && String(feature.id) === String(selectedFeatureId)
    ))
    if (!selectedFeature) {
      return
    }

    const selectedMesh = buildRoadOrRiverMesh(
      selectedFeature.entityType,
      [selectedFeature],
      frame,
      radiusClipUniformRef,
      true,
    )
    if (selectedMesh) {
      featureGroup.add(selectedMesh)
    }
  }, [enuFrameRef, featureGroupRef, features, radiusClipUniformRef, selectedFeatureId])
}
