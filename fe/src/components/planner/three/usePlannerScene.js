import { useEffect } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { ecefToEnu, lonLatToECEF } from '../../../lib/planner/i3sGeometryUtils'
import { DEFAULT_VIEW_STATE } from './constants'
import {
  applyRadiusClipShader,
  buildPolylineRibbonGeometry,
  clamp,
  disposeObject,
  getFeaturePaths,
  lineColorForFeature,
} from './helpers'

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
      new THREE.MeshStandardMaterial({ color: 0x0f1720, roughness: 1, metalness: 0 }),
    )
    ground.rotation.x = 0
    ground.position.z = -120
    ground.receiveShadow = false
    scene.add(ground)

    const grid = new THREE.GridHelper(24000, 48, 0x1f2937, 0x111827)
    grid.rotation.x = Math.PI / 2
    grid.material.transparent = true
    grid.material.opacity = 0.5
    grid.material.depthWrite = false
    grid.renderOrder = 12
    scene.add(grid)

    const basemapGroup = new THREE.Group()
    const i3sGroup = new THREE.Group()
    const featureGroup = new THREE.Group()
    const highlightGroup = new THREE.Group()
    scene.add(basemapGroup)
    scene.add(i3sGroup)
    scene.add(featureGroup)
    scene.add(highlightGroup)
    basemapGroupRef.current = basemapGroup
    i3sGroupRef.current = i3sGroup
    featureGroupRef.current = featureGroup
    highlightGroupRef.current = highlightGroup

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
    mountRef,
    mapViewStateRef,
    placeCameraFromView,
    queueTileSync,
    rendererRef,
    sceneRef,
    syncQueuedRef,
    syncTimerRef,
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

    for (const feature of features) {
      if (feature.entityType !== 'road' && feature.entityType !== 'river') {
        continue
      }
      const paths = getFeaturePaths(feature)
      if (!paths.length) {
        continue
      }

      const color = lineColorForFeature(feature.entityType, false)
      const widthRaw = Number(feature?.attributes?.width)
      const width = Number.isFinite(widthRaw)
        ? clamp(widthRaw, 2, feature.entityType === 'river' ? 50 : 30)
        : feature.entityType === 'river'
          ? 8
          : 6
      const zOffset = feature.entityType === 'river' ? 0.8 : 0.6
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color[0] / 255, color[1] / 255, color[2] / 255),
        transparent: true,
        opacity: color[3] / 255,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
      })
      applyRadiusClipShader(material, radiusClipUniformRef.current, 'planner-radius-clip-feature-v1')

      for (const path of paths) {
        const points = []
        for (const point of path) {
          if (!Array.isArray(point) || point.length < 2) {
            continue
          }
          const ecef = lonLatToECEF(Number(point[0]), Number(point[1]), Number(point[2] || 0))
          const enu = ecefToEnu(ecef, frame)
          points.push([enu[0], enu[1], enu[2]])
        }
        const geometry = buildPolylineRibbonGeometry(points, width, zOffset)
        if (!geometry) {
          continue
        }

        const mesh = new THREE.Mesh(geometry, material)
        mesh.renderOrder = 20
        mesh.userData = {
          sourceId: feature.id,
          entityType: feature.entityType,
          name: feature.attributes?.name || feature.entityType,
        }
        featureGroup.add(mesh)
      }
    }
  }, [enuFrameRef, featureGroupRef, features, radiusClipUniformRef])

  useEffect(() => {
    const featureGroup = featureGroupRef.current
    if (!featureGroup) {
      return
    }

    for (const child of featureGroup.children) {
      const material = child.material
      if (!material) {
        continue
      }

      const sourceId = child.userData?.sourceId
      const entityType = child.userData?.entityType
      const isSelected = Boolean(selectedFeatureId && sourceId === selectedFeatureId)
      const color = lineColorForFeature(entityType, isSelected)
      material.color.setRGB(color[0] / 255, color[1] / 255, color[2] / 255)
      material.opacity = color[3] / 255
    }
  }, [featureGroupRef, features, selectedFeatureId])
}
