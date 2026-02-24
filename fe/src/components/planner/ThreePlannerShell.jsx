import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { buildEnuFrame } from '../../lib/planner/i3sGeometryUtils'
import { postRegionData } from '../../lib/planner/api'
import {
  DEFAULT_FETCH_RADIUS_METERS,
  DEFAULT_LOCATION,
  DEFAULT_VIEW_STATE,
} from './three/constants'
import { ThreePlannerShellLayout } from './three/ThreePlannerShellLayout'
import { useLassoTool } from './three/useLassoTool'
import { usePlannerDataFlow } from './three/usePlannerDataFlow'
import { usePlannerInteraction } from './three/usePlannerInteraction'
import { usePlannerScene } from './three/usePlannerScene'
import { usePlannerTileSystem } from './three/usePlannerTileSystem'
import { useTrafficViz } from './three/useTrafficViz'
import { useWindViz } from './three/useWindViz'
import { useSunShadow } from './three/useSunShadow'

const REGION_SYNC_DEBOUNCE_MS = 1000

function deriveFeatureCenter(feature) {
  if (Array.isArray(feature?.center) && feature.center.length >= 2) {
    const lon = Number(feature.center[0])
    const lat = Number(feature.center[1])
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      return [lon, lat]
    }
  }

  const geom = feature?.geometry || {}
  const source = geom.paths || geom.rings
  if (!Array.isArray(source) || source.length === 0 || !Array.isArray(source[0]) || source[0].length === 0) {
    return null
  }

  let sumLon = 0
  let sumLat = 0
  let count = 0
  for (const p of source[0]) {
    if (!Array.isArray(p) || p.length < 2) {
      continue
    }
    const lon = Number(p[0])
    const lat = Number(p[1])
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      continue
    }
    sumLon += lon
    sumLat += lat
    count += 1
  }

  if (count === 0) {
    return null
  }

  return [sumLon / count, sumLat / count]
}

function simplifyFeatureForRegion(feature) {
  const attrs = feature?.attributes || {}
  return {
    id: feature?.id,
    entityType: feature?.entityType || 'unknown',
    center: deriveFeatureCenter(feature),
    attributes: {
      name: attrs.name || '',
      type: attrs.type || '',
      height: attrs.height ?? null,
      floors: attrs.floors ?? null,
      width: attrs.width ?? null,
    },
  }
}

function buildRegionSyncPayload({ location, center, radiusMeters, features }) {
  const simplifiedFeatures = Array.isArray(features)
    ? features.map(simplifyFeatureForRegion)
    : []

  const counts = simplifiedFeatures.reduce((acc, feature) => {
    const key = feature?.entityType || 'unknown'
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})

  return {
    location,
    center,
    radiusMeters,
    features: simplifiedFeatures,
    summary: {
      total: simplifiedFeatures.length,
      counts,
    },
  }
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
  const [i3sReady, setI3sReady] = useState(false)
  const [i3sFailed, setI3sFailed] = useState(false)
  const [buildingMods, setBuildingMods] = useState(new Map())
  const [selectedBuildingKey, setSelectedBuildingKey] = useState(null)
  const [selectedBuildingAttrs, setSelectedBuildingAttrs] = useState(null)
  const [moveMode, setMoveMode] = useState(false)
  const [moveSrcCoord, setMoveSrcCoord] = useState(null)
  const [lassoActive, setLassoActive] = useState(false)
  const [lassoPolygon, setLassoPolygon] = useState(null)
  const [simulationResults, setSimulationResults] = useState({})
  const [center, setCenter] = useState(null)

  const mountRef = useRef(null)
  const rendererRef = useRef(null)
  const sceneRef = useRef(null)
  const cameraRef = useRef(null)
  const controlsRef = useRef(null)
  const basemapGroupRef = useRef(null)
  const i3sGroupRef = useRef(null)
  const featureGroupRef = useRef(null)
  const highlightGroupRef = useRef(null)
  const transformAnchorRef = useRef(null)
  const moveTransformControlsRef = useRef(null)
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
  const regionSyncTimerRef = useRef(0)
  const regionSyncAbortRef = useRef(null)

  const buildingModsRef = useRef(buildingMods)
  buildingModsRef.current = buildingMods
  const selectedBuildingKeyRef = useRef(selectedBuildingKey)
  selectedBuildingKeyRef.current = selectedBuildingKey
  const i3sReadyRef = useRef(i3sReady)
  i3sReadyRef.current = i3sReady

  const {
    clearBasemapTiles,
    clearTileRecords,
    updateHighlightMesh,
    applyLiveBuildingMove,
    finalizeLiveBuildingMove,
    applyModsToAllTiles,
    getBuildingCentroid,
    deriveMapViewState,
    placeCameraFromView,
    queueTileSync,
  } = usePlannerTileSystem({
    rendererRef,
    cameraRef,
    controlsRef,
    basemapGroupRef,
    i3sGroupRef,
    highlightGroupRef,
    basemapTilesRef,
    tilesetRef,
    tileRecordsRef,
    enuFrameRef,
    mapViewStateRef,
    radiusClipUniformRef,
    pendingSyncRef,
    syncQueuedRef,
    syncTimerRef,
    syncTickRef,
    basemapAnchorRef,
    buildingModsRef,
    selectedBuildingKeyRef,
    i3sReadyRef,
    setI3sReady,
    setI3sFailed,
    setStatus,
    setSelectedBuildingKey,
    setSelectedFeatureId,
    setSelectedSourceType,
    setSelectedBuildingAttrs,
  })

  const { handleSearchAndLoad, handleSave } = usePlannerDataFlow({
    activeLocation,
    features,
    buildingMods,
    tilesetRef,
    enuFrameRef,
    mapViewStateRef,
    renderRadiusMetersRef,
    radiusClipUniformRef,
    setLocationInput,
    setSearchRadiusInput,
    setActiveLocation,
    setActiveRadiusMeters,
    setFeatures,
    setIsDirty,
    setSelectedFeatureId,
    setSelectedSourceType,
    setSelectedBuildingKey,
    setSelectedBuildingAttrs,
    setMoveMode,
    setMoveSrcCoord,
    setBuildingMods,
    setStatus,
    setIsLoading,
    setIsSaving,
    setI3sFailed,
    setI3sReady,
    clearTileRecords,
    clearBasemapTiles,
    updateHighlightMesh,
    placeCameraFromView,
    queueTileSync,
    applyModsToAllTiles,
  })

  usePlannerScene({
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
  })

  const { handleEdit, handleDelete } = usePlannerInteraction({
    rendererRef,
    cameraRef,
    i3sGroupRef,
    featureGroupRef,
    tileRecordsRef,
    pointerRef,
    raycasterRef,
    renderRadiusMetersRef,
    attrsRequestRef,
    selectedBuildingKeyRef,
    buildingModsRef,
    moveMode,
    selectedBuildingKey,
    selectedFeatureId,
    selectedSourceType,
    setStatus,
    setMoveMode,
    setMoveSrcCoord,
    setBuildingMods,
    setIsDirty,
    setSelectedFeatureId,
    setSelectedSourceType,
    setSelectedBuildingKey,
    setSelectedBuildingAttrs,
    setFeatures,
    updateHighlightMesh,
    getBuildingCentroid,
    applyLiveBuildingMove,
    finalizeLiveBuildingMove,
    transformAnchorRef,
    moveTransformControlsRef,
  })

  const { clearLasso } = useLassoTool({
    mountRef,
    rendererRef,
    cameraRef,
    sceneRef,
    enuFrameRef,
    mapViewStateRef,
    lassoActive,
    setLassoActive,
    setLassoPolygon,
  })

  const { showTraffic, clearTraffic } = useTrafficViz({ sceneRef, enuFrameRef })
  const { showWind, clearWind } = useWindViz({ sceneRef, enuFrameRef })
  const { showSunShadows, clearSunShadows } = useSunShadow({ sceneRef, rendererRef })

  const handleTrafficResult = useCallback((result) => {
    const segments = Array.isArray(result?.segments) ? result.segments : []
    if (segments.length === 0) {
      clearTraffic()
      setStatus('Traffic simulation returned no segments to render.')
      return
    }
    showTraffic(segments)
    setStatus(`Traffic overlay rendered (${segments.length} segments).`)
  }, [showTraffic, clearTraffic, setStatus])

  const handleWindResult = useCallback((result) => {
    const grid = Array.isArray(result?.grid) ? result.grid : []
    if (grid.length === 0) {
      clearWind()
      setStatus('Wind simulation returned no vectors to animate.')
      return
    }
    showWind(result)
    setStatus(`Wind overlay rendered (${grid.length} vectors).`)
  }, [showWind, clearWind, setStatus])

  const handleSunResult = useCallback(({ date, hour }) => {
    const vs = mapViewStateRef.current
    const sunResult = showSunShadows({ date, hour, lat: vs.latitude, lon: vs.longitude })
    if (sunResult?.sunAboveHorizon === false) {
      setStatus('Sun is below horizon for the selected time.')
      return
    }
    setStatus(`Sun shadows rendered (${date} ${String(hour).padStart(2, '0')}:00).`)
  }, [showSunShadows, mapViewStateRef, setStatus])

  const handleClearOverlays = useCallback(() => {
    clearTraffic()
    clearWind()
    clearSunShadows()
  }, [clearTraffic, clearWind, clearSunShadows])

  useEffect(() => {
    if (!activeLocation || features.length === 0) {
      return () => {}
    }

    const vs = mapViewStateRef.current
    const regionCenter = [vs.longitude, vs.latitude]
    setCenter(regionCenter)

    if (regionSyncTimerRef.current) {
      clearTimeout(regionSyncTimerRef.current)
      regionSyncTimerRef.current = 0
    }

    regionSyncAbortRef.current?.abort()
    regionSyncAbortRef.current = null

    regionSyncTimerRef.current = window.setTimeout(() => {
      const controller = new AbortController()
      regionSyncAbortRef.current = controller
      const payload = buildRegionSyncPayload({
        location: activeLocation,
        center: regionCenter,
        radiusMeters: activeRadiusMeters,
        features,
      })
      postRegionData(payload, {
        signal: controller.signal,
        timeoutMs: 20000,
      }).catch((error) => {
        if (error?.name === 'AbortError') {
          return
        }
        setStatus(error?.message || 'Failed to sync region context.')
      })
    }, REGION_SYNC_DEBOUNCE_MS)

    return () => {
      if (regionSyncTimerRef.current) {
        clearTimeout(regionSyncTimerRef.current)
        regionSyncTimerRef.current = 0
      }
      regionSyncAbortRef.current?.abort()
      regionSyncAbortRef.current = null
    }
  }, [features, activeLocation, activeRadiusMeters, mapViewStateRef, setStatus])

  useEffect(() => {
    return () => {
      if (regionSyncTimerRef.current) {
        clearTimeout(regionSyncTimerRef.current)
        regionSyncTimerRef.current = 0
      }
      regionSyncAbortRef.current?.abort()
      regionSyncAbortRef.current = null
    }
  }, [])

  const handleCreate = useCallback(() => {
    setStatus(`Create ${entityType} is not implemented yet.`)
  }, [entityType])

  const handleSearchSubmit = useCallback((event) => {
    event.preventDefault()
    handleSearchAndLoad(locationInput, searchRadiusInput)
  }, [handleSearchAndLoad, locationInput, searchRadiusInput])

  return (
    <ThreePlannerShellLayout
      mountRef={mountRef}
      locationInput={locationInput}
      setLocationInput={setLocationInput}
      searchRadiusInput={searchRadiusInput}
      setSearchRadiusInput={setSearchRadiusInput}
      isLoading={isLoading}
      handleSearchSubmit={handleSearchSubmit}
      handleSearchAndLoad={handleSearchAndLoad}
      isSaving={isSaving}
      handleSave={handleSave}
      activeLocation={activeLocation}
      entityType={entityType}
      setEntityType={setEntityType}
      handleCreate={handleCreate}
      handleEdit={handleEdit}
      handleDelete={handleDelete}
      moveMode={moveMode}
      setMoveMode={setMoveMode}
      setMoveSrcCoord={setMoveSrcCoord}
      setStatus={setStatus}
      features={features}
      activeRadiusMeters={activeRadiusMeters}
      selectedFeatureId={selectedFeatureId}
      isDirty={isDirty}
      i3sFailed={i3sFailed}
      i3sReady={i3sReady}
      buildingMods={buildingMods}
      selectedBuildingAttrs={selectedBuildingAttrs}
      status={status}
      defaultLocation={DEFAULT_LOCATION}
      lassoActive={lassoActive}
      setLassoActive={setLassoActive}
      lassoPolygon={lassoPolygon}
      clearLasso={clearLasso}
      center={center}
      simulationResults={simulationResults}
      setSimulationResults={setSimulationResults}
      onTrafficResult={handleTrafficResult}
      onWindResult={handleWindResult}
      onSunResult={handleSunResult}
      onClearOverlays={handleClearOverlays}
    />
  )
}
