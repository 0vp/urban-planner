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
  const { showWind, clearWind } = useWindViz({ sceneRef, enuFrameRef, rendererRef })
  const { showSunShadows, clearSunShadows } = useSunShadow({ sceneRef, rendererRef, cameraRef, enuFrameRef })

  const handleTrafficResult = useCallback((result) => {
    if (result?.segments) showTraffic(result.segments)
  }, [showTraffic])

  const handleWindResult = useCallback((result) => {
    if (result) showWind(result)
  }, [showWind])

  const handleSunResult = useCallback(({ date, hour }) => {
    const vs = mapViewStateRef.current
    showSunShadows({ date, hour, lat: vs.latitude, lon: vs.longitude })
  }, [showSunShadows, mapViewStateRef])

  const handleClearOverlays = useCallback(() => {
    clearTraffic()
    clearWind()
    clearSunShadows()
  }, [clearTraffic, clearWind, clearSunShadows])

  useEffect(() => {
    if (features.length > 0 && activeLocation) {
      const vs = mapViewStateRef.current
      setCenter([vs.longitude, vs.latitude])
      postRegionData({
        location: activeLocation,
        center: [vs.longitude, vs.latitude],
        radiusMeters: activeRadiusMeters,
        features,
      }).catch(() => {})
    }
  }, [features, activeLocation, activeRadiusMeters, mapViewStateRef])

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
