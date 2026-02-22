import { useCallback } from 'react'
import { parseBuildingKey } from '../../../lib/planner/i3sGeometryUtils'
import { I3SViewportAdapter } from '../../../lib/planner/i3sViewportAdapter'
import { TILE_CACHE_LIMIT, TILE_SYNC_DEBOUNCE_MS } from './constants'
import { disposeObject } from './helpers'

export function usePlannerTileSync({
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
  deriveMapViewState,
  updateBasemapTiles,
  createTileRecord,
  findVisibleBuildingKeyByFeatureId,
  updateHighlightMesh,
}) {
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
  }, [
    createTileRecord,
    deriveMapViewState,
    findVisibleBuildingKeyByFeatureId,
    i3sGroupRef,
    i3sReadyRef,
    mapViewStateRef,
    pendingSyncRef,
    rendererRef,
    selectedBuildingKeyRef,
    setI3sFailed,
    setI3sReady,
    setSelectedBuildingAttrs,
    setSelectedBuildingKey,
    setSelectedFeatureId,
    setSelectedSourceType,
    setStatus,
    syncTickRef,
    tileRecordsRef,
    tilesetRef,
    updateBasemapTiles,
    updateHighlightMesh,
  ])

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
  }, [syncQueuedRef, syncTilesWithView, syncTimerRef])

  return {
    syncTilesWithView,
    queueTileSync,
  }
}
