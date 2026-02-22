import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh'
import { load } from '@loaders.gl/core'
import { Tileset3D } from '@loaders.gl/tiles'
import { I3SLoader, loadFeatureAttributes } from '@loaders.gl/i3s'
import { fetchCityData } from '../../lib/planner/arcgisDataService'
import { fetchPlannerMap, savePlannerMap } from '../../lib/planner/api'
import {
  applyModsToTileGeometry,
  buildEnuFrame,
  buildTileFeatureIndex,
  computeMoveDelta,
  ecefToEnu,
  enuToLonLatAlt,
  lonLatToECEF,
  parseBuildingKey,
  vectorEcefToEnu,
} from '../../lib/planner/i3sGeometryUtils'
import { I3SViewportAdapter } from '../../lib/planner/i3sViewportAdapter'

const DEFAULT_LOCATION = 'Montreal, Quebec, Canada'
const I3S_SCENE_LAYER_URL =
  'https://basemaps3d.arcgis.com/arcgis/rest/services/Esri3D_Buildings_v1/SceneServer/layers/0'
const WORLD_MAP_TILE_URL =
  'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
const DEFAULT_VIEW_STATE = {
  longitude: -73.5673,
  latitude: 45.5017,
  zoom: 15,
  pitch: 60,
  bearing: 20,
}

const COLORS = {
  road: [228, 161, 27, 235],
  roadSelected: [96, 165, 250, 255],
  river: [78, 168, 222, 240],
  riverSelected: [96, 165, 250, 255],
}

const ENTITY_OPTIONS = [
  { value: 'building', label: 'Building' },
  { value: 'road', label: 'Road' },
  { value: 'river', label: 'River' },
]
const SELECT_HINT = 'Click a feature to select.'
const CAMERA_REFERENCE_ZOOM = 15
const CAMERA_REFERENCE_DISTANCE = 1800
const DEFAULT_FETCH_RADIUS_METERS = 1200
const MIN_FETCH_RADIUS_METERS = 300
const MAX_FETCH_RADIUS_METERS = 10000
const TILE_CACHE_LIMIT = 320
const BASEMAP_CACHE_LIMIT = 320
const BASEMAP_TILE_RADIUS = 4
const TILE_SYNC_DEBOUNCE_MS = 120

THREE.Mesh.prototype.raycast = acceleratedRaycast
if (!THREE.BufferGeometry.prototype.computeBoundsTree) {
  THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
}
if (!THREE.BufferGeometry.prototype.disposeBoundsTree) {
  THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree
}

function normalizeColorAttribute(rawColors, vertexCount) {
  if (!rawColors?.value || !rawColors?.size) {
    return null
  }
  const size = rawColors.size
  if (size !== 3 && size !== 4) {
    return null
  }

  const source = rawColors.value
  if (size === 3) {
    if (source instanceof Uint8Array || source instanceof Uint8ClampedArray) {
      return new THREE.BufferAttribute(source, 3, true)
    }
    return new THREE.BufferAttribute(Uint8Array.from(source), 3, true)
  }

  const rgb = new Uint8Array(vertexCount * 3)
  for (let i = 0, j = 0; i < source.length && j < rgb.length; i += 4, j += 3) {
    rgb[j] = source[i]
    rgb[j + 1] = source[i + 1]
    rgb[j + 2] = source[i + 2]
  }
  return new THREE.BufferAttribute(rgb, 3, true)
}

function getFeaturePaths(feature) {
  const paths = feature?.geometry?.paths
  if (!Array.isArray(paths) || !paths.length) {
    return []
  }
  return paths.filter((path) => Array.isArray(path) && path.length > 1)
}

function lineColorForFeature(entityType, isSelected) {
  if (entityType === 'river') {
    return isSelected ? COLORS.riverSelected : COLORS.river
  }
  return isSelected ? COLORS.roadSelected : COLORS.road
}

function buildPolylineRibbonGeometry(points, width, zOffset = 0.6) {
  if (!Array.isArray(points) || points.length < 2) {
    return null
  }

  const halfWidth = Math.max(0.5, width / 2)
  const positions = []
  const indices = []

  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i]
    const p1 = points[i + 1]
    const dx = p1[0] - p0[0]
    const dy = p1[1] - p0[1]
    const length = Math.hypot(dx, dy)
    if (length < 1e-3) {
      continue
    }

    const nx = -dy / length
    const ny = dx / length
    const ox = nx * halfWidth
    const oy = ny * halfWidth

    const z0 = (Number.isFinite(p0[2]) ? p0[2] : 0) + zOffset
    const z1 = (Number.isFinite(p1[2]) ? p1[2] : 0) + zOffset

    const base = positions.length / 3
    positions.push(
      p0[0] + ox, p0[1] + oy, z0,
      p0[0] - ox, p0[1] - oy, z0,
      p1[0] - ox, p1[1] - oy, z1,
      p1[0] + ox, p1[1] + oy, z1,
    )
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  if (!positions.length) {
    return null
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}

function disposeObject(node) {
  if (node.children?.length) {
    for (const child of [...node.children]) {
      disposeObject(child)
      node.remove(child)
    }
  }
  if (node.geometry) {
    node.geometry.disposeBoundsTree?.()
    node.geometry.dispose()
  }
  if (node.material) {
    if (Array.isArray(node.material)) {
      node.material.forEach((material) => material.dispose())
    } else {
      node.material.dispose()
    }
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function normalizeFetchRadius(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return DEFAULT_FETCH_RADIUS_METERS
  }
  return Math.round(clamp(parsed, MIN_FETCH_RADIUS_METERS, MAX_FETCH_RADIUS_METERS))
}

function lonToTileX(lon, zoom) {
  return Math.floor(((lon + 180) / 360) * 2 ** zoom)
}

function latToTileY(lat, zoom) {
  const latRad = (clamp(lat, -85.05112878, 85.05112878) * Math.PI) / 180
  const value = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2
  return Math.floor(value * 2 ** zoom)
}

function tileXToLon(x, zoom) {
  return (x / 2 ** zoom) * 360 - 180
}

function tileYToLat(y, zoom) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** zoom
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

function getTileBounds(x, y, zoom) {
  return {
    west: tileXToLon(x, zoom),
    east: tileXToLon(x + 1, zoom),
    north: tileYToLat(y, zoom),
    south: tileYToLat(y + 1, zoom),
  }
}

function applyRadiusClipShader(material, radiusUniform, cacheKey) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.plannerRadius = radiusUniform
    shader.vertexShader = `varying vec3 vPlannerPosition;\n${shader.vertexShader}`
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vPlannerPosition = transformed;',
      )
    shader.fragmentShader = `uniform float plannerRadius;\nvarying vec3 vPlannerPosition;\n${shader.fragmentShader}`
      .replace(
        '#include <clipping_planes_fragment>',
        '#include <clipping_planes_fragment>\n  if (dot(vPlannerPosition.xy, vPlannerPosition.xy) > plannerRadius * plannerRadius) discard;',
      )
  }
  material.customProgramCacheKey = () => cacheKey
}

export function ThreePlannerShell() {
  const [entityType, setEntityType] = useState('building')
  const [locationInput, setLocationInput] = useState(DEFAULT_LOCATION)
  const [searchRadiusInput, setSearchRadiusInput] = useState(String(DEFAULT_FETCH_RADIUS_METERS))
  const [activeLocation, setActiveLocation] = useState(DEFAULT_LOCATION)
  const [activeRadiusMeters, setActiveRadiusMeters] = useState(DEFAULT_FETCH_RADIUS_METERS)
  const [features, setFeatures] = useState([])
  const [selectedFeatureId, setSelectedFeatureId] = useState(null)
  const [selectedSourceType, setSelectedSourceType] = useState(null)
  const [status, setStatus] = useState('Initializing planner...')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [viewState, setViewState] = useState(DEFAULT_VIEW_STATE)
  const [i3sReady, setI3sReady] = useState(false)
  const [i3sFailed, setI3sFailed] = useState(false)
  const [buildingMods, setBuildingMods] = useState(new Map())
  const [selectedBuildingKey, setSelectedBuildingKey] = useState(null)
  const [selectedBuildingAttrs, setSelectedBuildingAttrs] = useState(null)
  const [moveMode, setMoveMode] = useState(false)
  const [moveSrcCoord, setMoveSrcCoord] = useState(null)

  const mountRef = useRef(null)
  const rendererRef = useRef(null)
  const sceneRef = useRef(null)
  const cameraRef = useRef(null)
  const controlsRef = useRef(null)
  const basemapGroupRef = useRef(null)
  const i3sGroupRef = useRef(null)
  const featureGroupRef = useRef(null)
  const highlightGroupRef = useRef(null)
  const basemapTilesRef = useRef(new Map())

  const raycasterRef = useRef(new THREE.Raycaster())
  const pointerRef = useRef(new THREE.Vector2())
  raycasterRef.current.params.Line.threshold = 8
  raycasterRef.current.firstHitOnly = false

  const tilesetRef = useRef(null)
  const tileRecordsRef = useRef(new Map())
  const enuFrameRef = useRef(buildEnuFrame(DEFAULT_VIEW_STATE.longitude, DEFAULT_VIEW_STATE.latitude, 0))
  const mapViewStateRef = useRef(DEFAULT_VIEW_STATE)
  const renderRadiusMetersRef = useRef(DEFAULT_FETCH_RADIUS_METERS)
  const radiusClipUniformRef = useRef({ value: DEFAULT_FETCH_RADIUS_METERS })
  const pendingSyncRef = useRef(false)
  const syncQueuedRef = useRef(false)
  const syncTimerRef = useRef(0)
  const syncTickRef = useRef(0)
  const basemapAnchorRef = useRef('')
  const animationRef = useRef(0)
  const attrsRequestRef = useRef(0)

  const buildingModsRef = useRef(buildingMods)
  buildingModsRef.current = buildingMods
  const selectedBuildingKeyRef = useRef(selectedBuildingKey)
  selectedBuildingKeyRef.current = selectedBuildingKey
  const i3sReadyRef = useRef(i3sReady)
  i3sReadyRef.current = i3sReady

  const clearBasemapTiles = useCallback(() => {
    const basemapGroup = basemapGroupRef.current
    const records = basemapTilesRef.current

    for (const record of records.values()) {
      if (basemapGroup) {
        basemapGroup.remove(record.mesh)
      }
      disposeObject(record.mesh)
      record.texture?.dispose?.()
    }
    records.clear()
    basemapAnchorRef.current = ''
  }, [])

  const updateBasemapTiles = useCallback((view) => {
    const basemapGroup = basemapGroupRef.current
    const renderer = rendererRef.current
    const frame = enuFrameRef.current
    if (!basemapGroup || !renderer || !frame || !view) {
      return
    }

    const zoom = clamp(Math.round(view.zoom), 0, 16)
    const tileCount = 2 ** zoom
    const centerX = lonToTileX(view.longitude, zoom)
    const centerY = latToTileY(view.latitude, zoom)
    const radius = BASEMAP_TILE_RADIUS
    const tileRecords = basemapTilesRef.current
    const anchorKey = `${zoom}/${centerX}/${centerY}`
    if (anchorKey === basemapAnchorRef.current && tileRecords.size > 0) {
      return
    }
    basemapAnchorRef.current = anchorKey
    const desired = new Set()
    const seenTick = syncTickRef.current

    for (let dy = -radius; dy <= radius; dy += 1) {
      const y = centerY + dy
      if (y < 0 || y >= tileCount) {
        continue
      }
      for (let dx = -radius; dx <= radius; dx += 1) {
        const x = ((centerX + dx) % tileCount + tileCount) % tileCount
        const key = `${zoom}/${x}/${y}`
        desired.add(key)
        if (tileRecords.has(key)) {
          const cached = tileRecords.get(key)
          cached.mesh.visible = true
          cached.lastSeen = seenTick
          continue
        }

        const bounds = getTileBounds(x, y, zoom)
        const sw = ecefToEnu(lonLatToECEF(bounds.west, bounds.south, 0), frame)
        const se = ecefToEnu(lonLatToECEF(bounds.east, bounds.south, 0), frame)
        const ne = ecefToEnu(lonLatToECEF(bounds.east, bounds.north, 0), frame)
        const nw = ecefToEnu(lonLatToECEF(bounds.west, bounds.north, 0), frame)

        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute(
          'position',
          new THREE.BufferAttribute(
            new Float32Array([
              sw[0], sw[1], sw[2],
              se[0], se[1], se[2],
              ne[0], ne[1], ne[2],
              nw[0], nw[1], nw[2],
            ]),
            3,
          ),
        )
        geometry.setAttribute(
          'uv',
          new THREE.BufferAttribute(new Float32Array([
            0, 1,
            1, 1,
            1, 0,
            0, 0,
          ]), 2),
        )
        geometry.setIndex([0, 1, 2, 0, 2, 3])

        const material = new THREE.MeshBasicMaterial({
          color: 0x334155,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.95,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        })
        const mesh = new THREE.Mesh(geometry, material)
        mesh.renderOrder = -10
        mesh.position.z -= 1.2
        mesh.receiveShadow = false
        basemapGroup.add(mesh)

        const record = { mesh, texture: null, lastSeen: seenTick }
        tileRecords.set(key, record)

        const textureLoader = new THREE.TextureLoader()
        textureLoader.setCrossOrigin('anonymous')
        textureLoader.load(
          WORLD_MAP_TILE_URL
            .replace('{z}', String(zoom))
            .replace('{y}', String(y))
            .replace('{x}', String(x)),
          (texture) => {
            const current = tileRecords.get(key)
            if (!current || current.mesh !== mesh) {
              texture.dispose()
              return
            }
            texture.flipY = false
            texture.colorSpace = THREE.SRGBColorSpace
            texture.minFilter = THREE.LinearMipmapLinearFilter
            texture.magFilter = THREE.LinearFilter
            texture.generateMipmaps = true
            texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
            current.texture = texture
            mesh.material.map = texture
            mesh.material.color.setHex(0xffffff)
            mesh.material.needsUpdate = true
          },
          undefined,
          () => {
            const current = tileRecords.get(key)
            if (!current || current.mesh !== mesh) {
              return
            }
            mesh.material.color.setHex(0x475569)
            mesh.material.needsUpdate = true
          },
        )
      }
    }

    for (const [key, record] of tileRecords.entries()) {
      if (!desired.has(key)) {
        record.mesh.visible = false
      }
    }

    if (tileRecords.size > BASEMAP_CACHE_LIMIT) {
      const hiddenByAge = [...tileRecords.entries()]
        .filter(([, record]) => !record.mesh.visible)
        .sort((a, b) => a[1].lastSeen - b[1].lastSeen)

      let overflow = tileRecords.size - BASEMAP_CACHE_LIMIT
      for (const [key, record] of hiddenByAge) {
        if (overflow <= 0) {
          break
        }
        basemapGroup.remove(record.mesh)
        disposeObject(record.mesh)
        record.texture?.dispose?.()
        tileRecords.delete(key)
        overflow -= 1
      }
    }
  }, [])

  const clearTileRecords = useCallback(() => {
    const records = tileRecordsRef.current
    const i3sGroup = i3sGroupRef.current
    if (!i3sGroup) {
      records.clear()
      return
    }
    for (const record of records.values()) {
      i3sGroup.remove(record.mesh)
      disposeObject(record.mesh)
    }
    records.clear()
  }, [])

  const updateHighlightMesh = useCallback((buildingKey) => {
    const highlightGroup = highlightGroupRef.current
    if (!highlightGroup) {
      return
    }

    while (highlightGroup.children.length) {
      const child = highlightGroup.children.pop()
      disposeObject(child)
    }

    if (!buildingKey) {
      return
    }

    const { tileId } = parseBuildingKey(buildingKey)
    const record = tileRecordsRef.current.get(tileId)
    if (!record) {
      return
    }

    const triangles = record.buildingToTriangles.get(buildingKey)
    if (!triangles?.length) {
      return
    }

    const srcPositions = record.positions
    const highlightPositions = new Float32Array(triangles.length * 3)
    for (let i = 0; i < triangles.length; i++) {
      const vertexIndex = triangles[i] * 3
      const out = i * 3
      highlightPositions[out] = srcPositions[vertexIndex]
      highlightPositions[out + 1] = srcPositions[vertexIndex + 1]
      highlightPositions[out + 2] = srcPositions[vertexIndex + 2]
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(highlightPositions, 3))
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(COLORS.roadSelected[0] / 255, COLORS.roadSelected[1] / 255, COLORS.roadSelected[2] / 255),
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      side: THREE.DoubleSide,
    })

    const mesh = new THREE.Mesh(geometry, material)
    highlightGroup.add(mesh)
  }, [])

  const applyModsToAllTiles = useCallback((mods) => {
    for (const record of tileRecordsRef.current.values()) {
      applyModsToTileGeometry(record, mods)
      record.positionAttribute.needsUpdate = true
      record.geometry.computeBoundingSphere()
      record.geometry.computeBoundingBox()
      record.geometry.boundsTree?.refit?.()
    }
    updateHighlightMesh(selectedBuildingKeyRef.current)
  }, [updateHighlightMesh])

  const getBuildingCentroid = useCallback((buildingKey) => {
    if (!buildingKey) {
      return null
    }
    const { tileId } = parseBuildingKey(buildingKey)
    const record = tileRecordsRef.current.get(tileId)
    if (!record) {
      return null
    }
    const vertices = record.buildingToVertices.get(buildingKey)
    if (!vertices?.length) {
      return null
    }

    let x = 0
    let y = 0
    let z = 0
    for (let i = 0; i < vertices.length; i++) {
      const offset = vertices[i] * 3
      x += record.positions[offset]
      y += record.positions[offset + 1]
      z += record.positions[offset + 2]
    }
    const inv = 1 / vertices.length
    return [x * inv, y * inv, z * inv]
  }, [])

  const deriveMapViewState = useCallback(() => {
    const renderer = rendererRef.current
    const camera = cameraRef.current
    const controls = controlsRef.current
    const frame = enuFrameRef.current
    if (!renderer || !camera || !controls || !frame) {
      return mapViewStateRef.current
    }

    const target = controls.target
    const [longitude, latitude] = enuToLonLatAlt([target.x, target.y, target.z], frame)
    const offsetX = camera.position.x - target.x
    const offsetY = camera.position.y - target.y
    const offsetZ = camera.position.z - target.z
    const distance = Math.hypot(offsetX, offsetY, offsetZ)
    const horizontal = Math.hypot(offsetX, offsetY)
    const pitch = Math.min(85, Math.max(0, (Math.atan2(horizontal, Math.max(1e-6, offsetZ)) * 180) / Math.PI))
    const bearing = (Math.atan2(offsetX, offsetY) * 180 / Math.PI + 360) % 360
    const zoom = CAMERA_REFERENCE_ZOOM - Math.log2(Math.max(1e-6, distance / CAMERA_REFERENCE_DISTANCE))

    return {
      longitude,
      latitude,
      zoom: Number.isFinite(zoom) ? zoom : DEFAULT_VIEW_STATE.zoom,
      pitch,
      bearing,
    }
  }, [])

  const placeCameraFromView = useCallback((viewState, targetEnu = [0, 0, 0]) => {
    const renderer = rendererRef.current
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!renderer || !camera || !controls) {
      return
    }

    const distance = CAMERA_REFERENCE_DISTANCE * 2 ** (CAMERA_REFERENCE_ZOOM - viewState.zoom)
    const pitchRad = (viewState.pitch * Math.PI) / 180
    const bearingRad = (viewState.bearing * Math.PI) / 180
    const horizontal = distance * Math.sin(pitchRad)
    const dz = distance * Math.cos(pitchRad)
    const dx = Math.sin(bearingRad) * horizontal
    const dy = Math.cos(bearingRad) * horizontal

    controls.target.set(targetEnu[0], targetEnu[1], targetEnu[2])
    camera.position.set(targetEnu[0] + dx, targetEnu[1] + dy, targetEnu[2] + dz)
    camera.lookAt(controls.target)
    controls.update()
  }, [])

  const createTileRecord = useCallback((tile) => {
    const frame = enuFrameRef.current
    const content = tile?.content
    const positionsRaw = content?.attributes?.positions?.value || content?.attributes?.positions
    if (!frame || !positionsRaw?.length) {
      return null
    }

    const vertexCount = Math.floor(positionsRaw.length / 3)
    const basePositions = new Float32Array(vertexCount * 3)
    for (let i = 0; i < positionsRaw.length; i += 3) {
      const enu = ecefToEnu([positionsRaw[i], positionsRaw[i + 1], positionsRaw[i + 2]], frame)
      basePositions[i] = enu[0]
      basePositions[i + 1] = enu[1]
      basePositions[i + 2] = enu[2]
    }

    const geometry = new THREE.BufferGeometry()
    const positionAttribute = new THREE.BufferAttribute(new Float32Array(basePositions), 3)
    geometry.setAttribute('position', positionAttribute)

    const rawIndices = content?.indices?.value || content?.indices
    if (rawIndices?.length) {
      geometry.setIndex(Array.from(rawIndices))
    }

    const rawNormals = content?.attributes?.normals?.value || content?.attributes?.normals
    if (rawNormals?.length >= vertexCount * 3) {
      const normals = new Float32Array(vertexCount * 3)
      for (let i = 0; i < rawNormals.length; i += 3) {
        const [x, y, z] = vectorEcefToEnu([rawNormals[i], rawNormals[i + 1], rawNormals[i + 2]], frame)
        const norm = Math.hypot(x, y, z) || 1
        normals[i] = x / norm
        normals[i + 1] = y / norm
        normals[i + 2] = z / norm
      }
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    } else {
      geometry.computeVertexNormals()
    }

    const colorAttribute = normalizeColorAttribute(content?.attributes?.colors, vertexCount)
    if (colorAttribute) {
      geometry.setAttribute('color', colorAttribute)
    }

    const material = new THREE.MeshStandardMaterial({
      color: colorAttribute ? 0xffffff : 0xbec5ce,
      vertexColors: Boolean(colorAttribute),
      metalness: 0.02,
      roughness: 0.9,
      flatShading: true,
    })
    applyRadiusClipShader(material, radiusClipUniformRef.current, 'planner-radius-clip-i3s-v2')

    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.userData = { tileId: tile.id }

    geometry.computeBoundsTree?.({ maxLeafTris: 24 })

    const featureIndex = buildTileFeatureIndex(
      tile.id,
      rawIndices,
      content?.featureIds,
      vertexCount,
    )

    const record = {
      tileId: tile.id,
      tile,
      geometry,
      mesh,
      positionAttribute,
      positions: positionAttribute.array,
      basePositions,
      buildingToVertices: featureIndex.buildingToVertices,
      buildingToTriangles: featureIndex.buildingToTriangles,
      vertexToBuildingKey: featureIndex.vertexToBuildingKey,
      edgeLines: null,
    }

    applyModsToTileGeometry(record, buildingModsRef.current)
    positionAttribute.needsUpdate = true
    geometry.computeBoundingSphere()
    return record
  }, [])

  const findVisibleBuildingKeyByFeatureId = useCallback((featureId) => {
    if (!Number.isFinite(featureId) || featureId < 0) {
      return null
    }

    for (const record of tileRecordsRef.current.values()) {
      if (!record?.mesh?.visible || !record?.buildingToVertices) {
        continue
      }

      for (const key of record.buildingToVertices.keys()) {
        const parsed = parseBuildingKey(key)
        if (parsed.featureId === featureId) {
          return key
        }
      }
    }

    return null
  }, [])

  const syncTilesWithView = useCallback(async () => {
    if (pendingSyncRef.current) {
      return
    }
    const renderer = rendererRef.current
    const tileset = tilesetRef.current
    const i3sGroup = i3sGroupRef.current
    if (!renderer || !tileset || !i3sGroup) {
      return
    }

    pendingSyncRef.current = true
    try {
      syncTickRef.current += 1
      const seenTick = syncTickRef.current
      const view = deriveMapViewState()
      mapViewStateRef.current = view
      updateBasemapTiles(view)

      const viewport = new I3SViewportAdapter({
        id: 'main',
        width: Math.max(1, renderer.domElement.clientWidth),
        height: Math.max(1, renderer.domElement.clientHeight),
        longitude: view.longitude,
        latitude: view.latitude,
        zoom: view.zoom,
        pitch: view.pitch,
        bearing: view.bearing,
      })

      await tileset.selectTiles([viewport])
      const selectedTiles = (tileset.selectedTiles || []).filter((tile) => {
        const positions = tile?.content?.attributes?.positions?.value || tile?.content?.attributes?.positions
        const isMesh = !tile?.type || tile.type === 'mesh'
        return isMesh && positions?.length
      })
      const selectedIds = new Set(selectedTiles.map((tile) => tile.id))
      const records = tileRecordsRef.current

      for (const tile of selectedTiles) {
        if (!records.has(tile.id)) {
          const record = createTileRecord(tile)
          if (!record) {
            continue
          }
          record.lastSeen = seenTick
          record.mesh.visible = true
          records.set(tile.id, record)
          i3sGroup.add(record.mesh)
        } else {
          const record = records.get(tile.id)
          record.tile = tile
          record.lastSeen = seenTick
          record.mesh.visible = true
        }
      }

      for (const [tileId, record] of records.entries()) {
        record.mesh.visible = selectedIds.has(tileId)
      }

      if (records.size > TILE_CACHE_LIMIT) {
        const selectedTileId = selectedBuildingKeyRef.current
          ? parseBuildingKey(selectedBuildingKeyRef.current).tileId
          : null
        const oldestByAge = [...records.entries()]
          .sort((a, b) => a[1].lastSeen - b[1].lastSeen)

        let overflow = records.size - TILE_CACHE_LIMIT
        for (const [tileId, record] of oldestByAge) {
          if (overflow <= 0) {
            break
          }
          if (selectedTileId && tileId === selectedTileId) {
            continue
          }
          i3sGroup.remove(record.mesh)
          disposeObject(record.mesh)
          records.delete(tileId)
          overflow -= 1
        }
      }

      if (!i3sReadyRef.current && records.size > 0) {
        setI3sReady(true)
        setStatus('ArcGIS 3D buildings loaded.')
      }

      const selectedKey = selectedBuildingKeyRef.current
      if (selectedKey) {
        const parsed = parseBuildingKey(selectedKey)
        const selectedRecord = records.get(parsed.tileId)
        const selectedStillVisible = Boolean(
          selectedRecord?.mesh?.visible
          && selectedRecord?.buildingToVertices?.has(selectedKey),
        )

        if (!selectedStillVisible) {
          const fallbackKey = findVisibleBuildingKeyByFeatureId(parsed.featureId)
          if (fallbackKey) {
            selectedBuildingKeyRef.current = fallbackKey
            setSelectedBuildingKey(fallbackKey)
            setSelectedFeatureId(`i3s_${fallbackKey}`)
            setSelectedSourceType('i3s')
          } else {
            setSelectedBuildingKey(null)
            setSelectedFeatureId(null)
            setSelectedSourceType(null)
            setSelectedBuildingAttrs(null)
            selectedBuildingKeyRef.current = null
          }
        }
      }

      updateHighlightMesh(selectedBuildingKeyRef.current)
    } catch (error) {
      setI3sFailed(true)
      setStatus(error?.message || 'Failed to sync I3S tiles.')
    } finally {
      pendingSyncRef.current = false
    }
  }, [createTileRecord, deriveMapViewState, findVisibleBuildingKeyByFeatureId, updateBasemapTiles, updateHighlightMesh])

  const queueTileSync = useCallback(() => {
    if (syncQueuedRef.current) {
      return
    }
    syncQueuedRef.current = true
    syncTimerRef.current = window.setTimeout(() => {
      syncTimerRef.current = 0
      requestAnimationFrame(() => {
        syncQueuedRef.current = false
        syncTilesWithView()
      })
    }, TILE_SYNC_DEBOUNCE_MS)
  }, [syncTilesWithView])

  const loadFeaturesIntoState = useCallback((loadedFeatures, center) => {
    setI3sFailed(false)
    setI3sReady(false)

    setFeatures(loadedFeatures)
    setIsDirty(false)
    setSelectedFeatureId(null)
    setSelectedSourceType(null)
    setSelectedBuildingKey(null)
    setSelectedBuildingAttrs(null)
    setMoveMode(false)
    setMoveSrcCoord(null)
    setBuildingMods(new Map())
    clearTileRecords()
    clearBasemapTiles()
    updateHighlightMesh(null)

    if (Array.isArray(center) && center.length >= 2) {
      const lon = Number(center[0])
      const lat = Number(center[1])
      if (Number.isFinite(lon) && Number.isFinite(lat)) {
        enuFrameRef.current = buildEnuFrame(lon, lat, 0)
        mapViewStateRef.current = {
          ...DEFAULT_VIEW_STATE,
          longitude: lon,
          latitude: lat,
        }
        placeCameraFromView(mapViewStateRef.current, [0, 0, 0])
      }
    }
    queueTileSync()
  }, [clearBasemapTiles, clearTileRecords, placeCameraFromView, queueTileSync, updateHighlightMesh])

  const handleSearchAndLoad = useCallback(async (query, radiusInput = DEFAULT_FETCH_RADIUS_METERS) => {
    const trimmed = query.trim()
    if (!trimmed) {
      setStatus('Enter a location first.')
      return
    }

    const radiusMeters = normalizeFetchRadius(radiusInput)
    renderRadiusMetersRef.current = radiusMeters
    radiusClipUniformRef.current.value = radiusMeters
    setActiveRadiusMeters(radiusMeters)
    setSearchRadiusInput(String(radiusMeters))

    setIsLoading(true)
    setStatus(`Searching ${trimmed} (${radiusMeters}m radius)...`)

    try {
      const cityData = await fetchCityData(trimmed, {
        radiusMeters,
        preferredCenter: [mapViewStateRef.current.longitude, mapViewStateRef.current.latitude],
      })
      setActiveLocation(cityData.location)
      setLocationInput(cityData.location)

      setStatus(`Found ${cityData.features.length} features. Loading saved data...`)

      let mergedFeatures = cityData.features
      let savedMapUnavailable = false

      try {
        const savedData = await fetchPlannerMap(cityData.location)
        const savedFeatures = Array.isArray(savedData.features) ? savedData.features : []

        mergedFeatures = [...cityData.features, ...savedFeatures.filter(sf =>
          !cityData.features.some(cf =>
            cf.center && sf.center &&
            Math.abs(cf.center[0] - sf.center[0]) < 0.0001 &&
            Math.abs(cf.center[1] - sf.center[1]) < 0.0001
          )
        )]
      } catch {
        savedMapUnavailable = true
      }

      loadFeaturesIntoState(mergedFeatures, cityData.center)
      setStatus(
        savedMapUnavailable
          ? `Loaded ${mergedFeatures.length} features for ${cityData.location} (saved-map sync unavailable).`
          : `Loaded ${mergedFeatures.length} features for ${cityData.location}.`,
      )
    } catch (error) {
      setStatus(error.message || 'Failed to search location.')
    } finally {
      setIsLoading(false)
    }
  }, [loadFeaturesIntoState])

  useEffect(() => {
    setStatus('Loading Montreal...')
    handleSearchAndLoad(DEFAULT_LOCATION, DEFAULT_FETCH_RADIUS_METERS)
  }, [handleSearchAndLoad])

  useEffect(() => {
    applyModsToAllTiles(buildingMods)
  }, [applyModsToAllTiles, buildingMods])

  useEffect(() => {
    let cancelled = false

    async function initializeTileset() {
      try {
        const tilesetJson = await load(I3S_SCENE_LAYER_URL, I3SLoader, {
          i3s: { decodeTextures: false },
        })
        if (cancelled) {
          return
        }
        tilesetRef.current = new Tileset3D(tilesetJson, {
          maximumScreenSpaceError: 10,
          loadOptions: {
            i3s: { decodeTextures: false },
          },
          onTileLoad: () => {
            queueTileSync()
          },
          onTileError: (_, message) => {
            setI3sFailed(true)
            setStatus(`I3S load issue: ${message || 'unknown error'}.`)
          },
        })
        setStatus('Loading ArcGIS 3D buildings...')
        queueTileSync()
      } catch (error) {
        if (cancelled) {
          return
        }
        setI3sFailed(true)
        setStatus(error?.message || 'Failed to load ArcGIS 3D buildings.')
      }
    }

    initializeTileset()

    return () => {
      cancelled = true
      tilesetRef.current?.destroy?.()
      tilesetRef.current = null
    }
  }, [queueTileSync])

  useEffect(() => {
    const interval = setInterval(() => {
      queueTileSync()
    }, 4500)
    return () => clearInterval(interval)
  }, [queueTileSync])

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
  }, [clearBasemapTiles, clearTileRecords, deriveMapViewState, placeCameraFromView, queueTileSync])

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

      const isSelected = selectedFeatureId && feature.id === selectedFeatureId
      const color = lineColorForFeature(feature.entityType, isSelected)
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
  }, [features, selectedFeatureId])

  const resetSelection = useCallback(() => {
    attrsRequestRef.current += 1
    setSelectedFeatureId(null)
    setSelectedSourceType(null)
    setSelectedBuildingKey(null)
    selectedBuildingKeyRef.current = null
    setSelectedBuildingAttrs(null)
    updateHighlightMesh(null)
  }, [updateHighlightMesh])

  const handleSave = useCallback(async () => {
    if (!activeLocation) {
      setStatus('Search a location first.')
      return
    }

    setIsSaving(true)
    setStatus(`Saving map for ${activeLocation}...`)

    try {
      await savePlannerMap({
        location: activeLocation,
        features,
      })

      setIsDirty(false)
      setStatus(`Saved ${features.length} features for ${activeLocation}.`)
    } catch (error) {
      setStatus(error.message || 'Save failed.')
    } finally {
      setIsSaving(false)
    }
  }, [activeLocation, features])

  const handleCreate = useCallback(() => {
    setStatus(`Create ${entityType} is not implemented yet.`)
  }, [entityType])

  const handleEdit = useCallback(() => {
    if (!selectedFeatureId) {
      setStatus('Select a feature first.')
      return
    }
    if (selectedSourceType === 'i3s' && selectedBuildingKey) {
      const centroid = getBuildingCentroid(selectedBuildingKey)
      if (!centroid) {
        setStatus('Unable to move this building.')
        return
      }
      setMoveMode(true)
      setMoveSrcCoord(centroid)
      setStatus('Move mode: click a destination on the map.')
      return
    }
    setStatus(`Edit ${selectedFeatureId} is not implemented yet.`)
  }, [getBuildingCentroid, selectedBuildingKey, selectedFeatureId, selectedSourceType])

  const handleDelete = useCallback(() => {
    if (!selectedFeatureId) {
      setStatus('Select a feature to delete.')
      return
    }

    if (selectedSourceType === 'i3s') {
      if (!selectedBuildingKey) {
        setStatus('No I3S building selected.')
        return
      }
      setBuildingMods((prev) => {
        const next = new Map(prev)
        next.set(selectedBuildingKey, { action: 'delete' })
        return next
      })
      resetSelection()
      setIsDirty(true)
      setStatus('I3S building deleted.')
      return
    }

    setFeatures((previous) => previous.filter((feature) => feature.id !== selectedFeatureId))
    resetSelection()
    setIsDirty(true)
    setStatus('Feature deleted.')
  }, [resetSelection, selectedBuildingKey, selectedFeatureId, selectedSourceType])

  const pickBuildingKeyFromIntersection = useCallback((intersection) => {
    const tileId = intersection?.object?.userData?.tileId
    if (!tileId) {
      return null
    }
    const record = tileRecordsRef.current.get(tileId)
    if (!record) {
      return null
    }

    const face = intersection.face
    if (!face) {
      return null
    }

    const keyA = record.vertexToBuildingKey[face.a]
    const keyB = record.vertexToBuildingKey[face.b]
    const keyC = record.vertexToBuildingKey[face.c]

    const candidates = [...new Set([keyA, keyB, keyC].filter(Boolean))]
    let bestKey = null
    let bestScore = -1
    for (const candidate of candidates) {
      const triangleCount = record.buildingToTriangles?.get(candidate)?.length || 0
      if (!triangleCount) {
        continue
      }
      const parsed = parseBuildingKey(candidate)
      const hasFeatureId = Number.isFinite(parsed.featureId) && parsed.featureId >= 0
      const score = (hasFeatureId ? 1_000_000 : 0) + triangleCount
      if (score > bestScore) {
        bestScore = score
        bestKey = candidate
      }
    }

    if (bestKey) {
      return { key: bestKey, record }
    }

    if (keyA === keyB || keyA === keyC) return { key: keyA, record }
    if (keyB === keyC) return { key: keyB, record }
    return { key: keyA, record }
  }, [])

  const pickSelectableBuildingHit = useCallback((intersections) => {
    for (const intersection of intersections) {
      const point = intersection?.point
      if (!point || Math.hypot(point.x, point.y) > renderRadiusMetersRef.current) {
        continue
      }

      const hit = pickBuildingKeyFromIntersection(intersection)
      if (!hit?.key) {
        continue
      }

      const parsed = parseBuildingKey(hit.key)
      const triangles = hit.record?.buildingToTriangles?.get(hit.key)
      if (!triangles?.length) {
        continue
      }

      return { ...hit, parsed }
    }

    return null
  }, [pickBuildingKeyFromIntersection])

  const handleSceneClick = useCallback((event) => {
    const renderer = rendererRef.current
    const camera = cameraRef.current
    const i3sGroup = i3sGroupRef.current
    const featureGroup = featureGroupRef.current
    if (!renderer || !camera || !i3sGroup || !featureGroup) {
      return
    }

    const rect = renderer.domElement.getBoundingClientRect()
    pointerRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointerRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    raycasterRef.current.setFromCamera(pointerRef.current, camera)

    if (moveMode) {
      const target = new THREE.Vector3()
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
      if (!raycasterRef.current.ray.intersectPlane(plane, target)) {
        setStatus('Move mode: click on the ground to choose destination.')
        return
      }

      if (selectedBuildingKeyRef.current && moveSrcCoord) {
        const destination = [target.x, target.y, target.z]
        const delta = computeMoveDelta(moveSrcCoord, destination)
        setBuildingMods((previous) => {
          const next = new Map(previous)
          const current = next.get(selectedBuildingKeyRef.current)
          const previousDelta = current?.action === 'move' ? current.delta : [0, 0, 0]
          next.set(selectedBuildingKeyRef.current, {
            action: 'move',
            delta: [
              previousDelta[0] + delta[0],
              previousDelta[1] + delta[1],
              previousDelta[2] + delta[2],
            ],
          })
          return next
        })
        setIsDirty(true)
        setStatus('Building moved.')
      }

      setMoveMode(false)
      setMoveSrcCoord(null)
      return
    }

    const visibleI3sMeshes = i3sGroup.children.filter((node) => node.visible)
    const buildingHits = raycasterRef.current.intersectObjects(visibleI3sMeshes, false)
    if (buildingHits.length > 0) {
      const hit = pickSelectableBuildingHit(buildingHits)
      if (hit?.key) {
        attrsRequestRef.current += 1
        const requestId = attrsRequestRef.current
        const parsed = hit.parsed
        selectedBuildingKeyRef.current = hit.key
        setSelectedBuildingKey(hit.key)
        setSelectedFeatureId(`i3s_${hit.key}`)
        setSelectedSourceType('i3s')
        setSelectedBuildingAttrs(null)
        updateHighlightMesh(hit.key)

        if (!Number.isFinite(parsed.featureId) || parsed.featureId < 0) {
          setStatus('Selected I3S building (attributes unavailable for this geometry).')
          return
        }

        setStatus(`Selected I3S building (ID: ${parsed.featureId}). Loading attributes...`)

        loadFeatureAttributes(hit.record.tile, parsed.featureId)
          .then((attrs) => {
            if (requestId !== attrsRequestRef.current) {
              return
            }
            if (attrs) {
              setSelectedBuildingAttrs(attrs)
              const name = attrs.name || 'unnamed'
              const height = attrs.height || '?'
              setStatus(`I3S: ${name} | Height: ${height}m | ID: ${parsed.featureId}`)
            } else {
              setStatus(`Selected I3S building (ID: ${parsed.featureId}).`)
            }
          })
          .catch(() => {
            if (requestId === attrsRequestRef.current) {
              setStatus(`Selected I3S building (ID: ${parsed.featureId}).`)
            }
          })
        return
      }
    }

    const lineHits = raycasterRef.current.intersectObjects(featureGroup.children, false)
    if (lineHits.length > 0) {
      const lineHit = lineHits.find((hit) => {
        const point = hit?.point
        return point && Math.hypot(point.x, point.y) <= renderRadiusMetersRef.current
      })
      if (!lineHit) {
        resetSelection()
        setStatus(SELECT_HINT)
        return
      }

      const lineObject = lineHit.object
      const sourceId = lineObject.userData?.sourceId
      if (sourceId) {
        attrsRequestRef.current += 1
        selectedBuildingKeyRef.current = null
        setSelectedBuildingKey(null)
        setSelectedBuildingAttrs(null)
        setSelectedFeatureId(sourceId)
        setSelectedSourceType('feature')
        setStatus(`Selected ${lineObject.userData?.entityType || 'feature'}: ${lineObject.userData?.name || 'unnamed'}`)
        updateHighlightMesh(null)
        return
      }
    }

    resetSelection()
    setStatus(SELECT_HINT)
  }, [moveMode, moveSrcCoord, pickSelectableBuildingHit, resetSelection, updateHighlightMesh])

  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer) {
      return
    }

    const onClick = (event) => handleSceneClick(event)
    renderer.domElement.addEventListener('click', onClick)
    return () => renderer.domElement.removeEventListener('click', onClick)
  }, [handleSceneClick])

  useEffect(() => {
    updateHighlightMesh(selectedBuildingKey)
  }, [selectedBuildingKey, updateHighlightMesh])

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && moveMode) {
        setMoveMode(false)
        setMoveSrcCoord(null)
        setStatus(SELECT_HINT)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [moveMode])

  const handleSearchSubmit = (event) => {
    event.preventDefault()
    handleSearchAndLoad(locationInput, searchRadiusInput)
  }

  return (
    <div className="fixed top-16 left-0 right-0 bottom-0 bg-zinc-950 text-zinc-100">
      <div className="absolute top-0 left-0 right-0 h-14 z-20 border-b border-zinc-800 bg-zinc-900/95 backdrop-blur px-4 flex items-center gap-2">
        <form className="flex items-center gap-2 w-full" onSubmit={handleSearchSubmit}>
          <input
            value={locationInput}
            onChange={(event) => setLocationInput(event.target.value)}
            placeholder="Search location (e.g., Montreal)"
            className="flex-1 h-9 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm outline-none focus:border-zinc-500"
          />
          <input
            type="number"
            min={MIN_FETCH_RADIUS_METERS}
            max={MAX_FETCH_RADIUS_METERS}
            step={100}
            value={searchRadiusInput}
            onChange={(event) => setSearchRadiusInput(event.target.value)}
            placeholder="Radius (m)"
            title="Fetch/render radius (meters)"
            className="w-28 h-9 rounded-md border border-zinc-700 bg-zinc-950 px-2 text-sm outline-none focus:border-zinc-500"
          />
          <button
            type="submit"
            disabled={isLoading}
            className="h-9 px-3 rounded-md bg-zinc-700 hover:bg-zinc-600 disabled:opacity-60 text-sm"
          >
            Search
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={() => handleSearchAndLoad(DEFAULT_LOCATION, searchRadiusInput)}
            className="h-9 px-3 rounded-md bg-zinc-800 hover:bg-zinc-700 disabled:opacity-60 text-sm"
          >
            Montreal
          </button>
          <button
            type="button"
            disabled={isSaving || isLoading}
            onClick={handleSave}
            className="h-9 px-3 rounded-md bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 text-sm"
          >
            Save
          </button>
        </form>
      </div>

      <div className="absolute top-14 left-0 bottom-0 w-72 z-10 border-r border-zinc-800 bg-zinc-900/95 backdrop-blur p-4 space-y-4 overflow-y-auto">
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-400">Active location</p>
          <p className="text-sm mt-1 break-words">{activeLocation}</p>
        </div>

        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wide text-zinc-400 block" htmlFor="entityType">
            Entity type
          </label>
          <select
            id="entityType"
            value={entityType}
            onChange={(event) => setEntityType(event.target.value)}
            className="w-full h-9 rounded-md border border-zinc-700 bg-zinc-950 px-2 text-sm"
          >
            {ENTITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 gap-2">
          <button
            type="button"
            onClick={handleCreate}
            className="h-9 rounded-md bg-indigo-700 hover:bg-indigo-600 text-sm"
          >
            Create
          </button>
          <button
            type="button"
            onClick={handleEdit}
            className="h-9 rounded-md bg-zinc-700 hover:bg-zinc-600 text-sm"
          >
            Edit / Move
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="h-9 rounded-md bg-rose-700 hover:bg-rose-600 text-sm"
          >
            Delete
          </button>
        </div>

        {moveMode && (
          <div className="rounded-md border border-amber-700 bg-amber-950/50 p-3 text-xs text-amber-300 leading-relaxed">
            <p>Move mode active. Click a destination on the map or press Escape to cancel.</p>
            <button
              type="button"
              onClick={() => { setMoveMode(false); setMoveSrcCoord(null); setStatus(SELECT_HINT) }}
              className="mt-2 h-7 px-2 rounded bg-amber-800 hover:bg-amber-700 text-xs"
            >
              Cancel Move
            </button>
          </div>
        )}

        <div className="space-y-1 text-sm text-zinc-300">
          <p>Features: {features.length}</p>
          <p>Radius: {activeRadiusMeters}m</p>
          <p>Selected: {selectedFeatureId ? String(selectedFeatureId).slice(0, 22) : 'none'}</p>
          <p>Status: {isDirty ? 'Unsaved changes' : 'Saved'}</p>
          <p>I3S: {i3sFailed ? 'failed' : i3sReady ? 'mesh loaded' : 'loading'}</p>
          <p>I3S mods: {buildingMods.size}</p>
        </div>

        {selectedBuildingAttrs && (
          <div className="rounded-md border border-zinc-800 bg-zinc-950/70 p-3 text-xs text-zinc-300 leading-relaxed space-y-1">
            <p className="text-zinc-400 uppercase tracking-wide">Building attributes</p>
            {Object.entries(selectedBuildingAttrs).map(([key, val]) =>
              val ? <p key={key}><span className="text-zinc-500">{key}:</span> {val}</p> : null
            )}
          </div>
        )}

        <div className="rounded-md border border-zinc-800 bg-zinc-950/70 p-3 text-xs text-zinc-300 leading-relaxed">
          <p>{status}</p>
        </div>
      </div>

      <div className="absolute top-14 left-72 right-0 bottom-0">
        <div
          ref={mountRef}
          className="absolute inset-0"
          style={{ cursor: moveMode ? 'crosshair' : 'grab' }}
        />
      </div>
    </div>
  )
}
