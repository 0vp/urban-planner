import { usePlannerBasemapAndCamera } from './usePlannerBasemapAndCamera'
import { usePlannerI3sRecords } from './usePlannerI3sRecords'
import { usePlannerTileSync } from './usePlannerTileSync'

export function usePlannerTileSystem({
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
}) {
  const basemapAndCamera = usePlannerBasemapAndCamera({
    rendererRef,
    cameraRef,
    controlsRef,
    basemapGroupRef,
    basemapTilesRef,
    enuFrameRef,
    mapViewStateRef,
    syncTickRef,
    basemapAnchorRef,
  })

  const i3sRecords = usePlannerI3sRecords({
    i3sGroupRef,
    highlightGroupRef,
    tileRecordsRef,
    enuFrameRef,
    radiusClipUniformRef,
    buildingModsRef,
    selectedBuildingKeyRef,
  })

  const tileSync = usePlannerTileSync({
    rendererRef,
    tilesetRef,
    i3sGroupRef,
    tileRecordsRef,
    mapViewStateRef,
    pendingSyncRef,
    syncQueuedRef,
    syncTimerRef,
    syncTickRef,
    selectedBuildingKeyRef,
    i3sReadyRef,
    setI3sReady,
    setI3sFailed,
    setStatus,
    setSelectedBuildingKey,
    setSelectedFeatureId,
    setSelectedSourceType,
    setSelectedBuildingAttrs,
    deriveMapViewState: basemapAndCamera.deriveMapViewState,
    updateBasemapTiles: basemapAndCamera.updateBasemapTiles,
    createTileRecord: i3sRecords.createTileRecord,
    findVisibleBuildingKeyByFeatureId: i3sRecords.findVisibleBuildingKeyByFeatureId,
    updateHighlightMesh: i3sRecords.updateHighlightMesh,
  })

  return {
    ...basemapAndCamera,
    ...i3sRecords,
    ...tileSync,
  }
}
