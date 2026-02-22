import { useCallback, useEffect, useRef } from 'react'
import { load } from '@loaders.gl/core'
import { I3SLoader } from '@loaders.gl/i3s'
import { Tileset3D } from '@loaders.gl/tiles'
import { fetchCityData } from '../../../lib/planner/arcgisDataService'
import { fetchPlannerMap, savePlannerMap } from '../../../lib/planner/api'
import { buildEnuFrame } from '../../../lib/planner/i3sGeometryUtils'
import {
  DEFAULT_FETCH_RADIUS_METERS,
  DEFAULT_LOCATION,
  DEFAULT_VIEW_STATE,
  I3S_SCENE_LAYER_URL,
  TILE_SYNC_HEARTBEAT_MS,
  TILE_SYNC_WARMUP_DELAYS_MS,
} from './constants'
import { normalizeFetchRadius } from './helpers'

function centerToDedupeKey(center) {
  if (!Array.isArray(center) || center.length < 2) {
    return null
  }

  const x = Number(center[0])
  const y = Number(center[1])
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null
  }

  return `${Math.round(x * 10000)}:${Math.round(y * 10000)}`
}

function mergeFeaturesWithSavedMap(liveFeatures, savedFeatures) {
  const merged = [...liveFeatures]
  const seenIds = new Set()
  const seenCenters = new Set()

  for (const feature of liveFeatures) {
    if (feature?.id != null) {
      seenIds.add(String(feature.id))
    }
    const centerKey = centerToDedupeKey(feature?.center)
    if (centerKey) {
      seenCenters.add(centerKey)
    }
  }

  for (const feature of savedFeatures) {
    const featureId = feature?.id != null ? String(feature.id) : ''
    if (featureId && seenIds.has(featureId)) {
      continue
    }

    const centerKey = centerToDedupeKey(feature?.center)
    if (centerKey && seenCenters.has(centerKey)) {
      continue
    }

    merged.push(feature)

    if (featureId) {
      seenIds.add(featureId)
    }
    if (centerKey) {
      seenCenters.add(centerKey)
    }
  }

  return merged
}

export function usePlannerDataFlow({
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
}) {
  const searchRequestIdRef = useRef(0)
  const searchAbortRef = useRef(null)

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
  }, [
    clearBasemapTiles,
    clearTileRecords,
    enuFrameRef,
    mapViewStateRef,
    placeCameraFromView,
    queueTileSync,
    setBuildingMods,
    setFeatures,
    setI3sFailed,
    setI3sReady,
    setIsDirty,
    setMoveMode,
    setMoveSrcCoord,
    setSelectedBuildingAttrs,
    setSelectedBuildingKey,
    setSelectedFeatureId,
    setSelectedSourceType,
    updateHighlightMesh,
  ])

  const handleSearchAndLoad = useCallback(async (query, radiusInput = DEFAULT_FETCH_RADIUS_METERS) => {
    const trimmed = query.trim()
    if (!trimmed) {
      setStatus('Enter a location first.')
      return
    }

    const radiusMeters = normalizeFetchRadius(radiusInput)
    const requestId = searchRequestIdRef.current + 1
    searchRequestIdRef.current = requestId

    searchAbortRef.current?.abort()
    const searchController = new AbortController()
    searchAbortRef.current = searchController

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
        signal: searchController.signal,
        onPartialResult: (partialData) => {
          if (requestId !== searchRequestIdRef.current || searchController.signal.aborted) {
            return
          }

          if (!Array.isArray(partialData?.features) || partialData.features.length === 0) {
            return
          }

          setActiveLocation(partialData.location)
          setLocationInput(partialData.location)
          loadFeaturesIntoState(partialData.features, partialData.center)
          setIsLoading(false)
          setStatus(
            `Loaded ${partialData.features.length} roads/rivers for ${partialData.location}. Enriching...`,
          )
        },
      })

      if (requestId !== searchRequestIdRef.current || searchController.signal.aborted) {
        return
      }

      setActiveLocation(cityData.location)
      setLocationInput(cityData.location)

      setStatus(`Found ${cityData.features.length} features. Loading saved data...`)

      let mergedFeatures = cityData.features
      let savedMapUnavailable = false

      try {
        const savedData = await fetchPlannerMap(cityData.location, {
          signal: searchController.signal,
          timeoutMs: 3500,
        })

        if (requestId !== searchRequestIdRef.current || searchController.signal.aborted) {
          return
        }

        const savedFeatures = Array.isArray(savedData.features) ? savedData.features : []

        mergedFeatures = mergeFeaturesWithSavedMap(cityData.features, savedFeatures)
      } catch (error) {
        if (error?.name === 'AbortError' || searchController.signal.aborted) {
          return
        }
        savedMapUnavailable = true
      }

      if (requestId !== searchRequestIdRef.current || searchController.signal.aborted) {
        return
      }

      loadFeaturesIntoState(mergedFeatures, cityData.center)
      const timingSummary = cityData?.timings
        ? ` (fast ${Math.round(cityData.timings.firstRenderableMs)}ms, full ${Math.round(cityData.timings.fullDataMs)}ms)`
        : ''
      setStatus(
        savedMapUnavailable
          ? `Loaded ${mergedFeatures.length} features for ${cityData.location} (saved-map sync unavailable).${timingSummary}`
          : `Loaded ${mergedFeatures.length} features for ${cityData.location}.${timingSummary}`,
      )
    } catch (error) {
      if (error?.name === 'AbortError' || searchController.signal.aborted) {
        return
      }
      setStatus(error.message || 'Failed to search location.')
    } finally {
      if (requestId === searchRequestIdRef.current) {
        searchAbortRef.current = null
        setIsLoading(false)
      }
    }
  }, [
    loadFeaturesIntoState,
    mapViewStateRef,
    radiusClipUniformRef,
    renderRadiusMetersRef,
    setActiveLocation,
    setActiveRadiusMeters,
    setIsLoading,
    setLocationInput,
    setSearchRadiusInput,
    setStatus,
  ])

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
  }, [activeLocation, features, setIsDirty, setIsSaving, setStatus])

  useEffect(() => {
    return () => {
      searchAbortRef.current?.abort()
      searchAbortRef.current = null
    }
  }, [])

  useEffect(() => {
    setStatus('Loading Montreal...')
    handleSearchAndLoad(DEFAULT_LOCATION, DEFAULT_FETCH_RADIUS_METERS)
  }, [handleSearchAndLoad, setStatus])

  useEffect(() => {
    applyModsToAllTiles(buildingMods)
  }, [applyModsToAllTiles, buildingMods])

  useEffect(() => {
    let cancelled = false
    const warmupTimerIds = []

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
        for (const delayMs of TILE_SYNC_WARMUP_DELAYS_MS) {
          const timerId = window.setTimeout(() => {
            if (!cancelled) {
              queueTileSync()
            }
          }, delayMs)
          warmupTimerIds.push(timerId)
        }
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
      for (const timerId of warmupTimerIds) {
        clearTimeout(timerId)
      }
      tilesetRef.current?.destroy?.()
      tilesetRef.current = null
    }
  }, [queueTileSync, setI3sFailed, setStatus, tilesetRef])

  useEffect(() => {
    const interval = setInterval(() => {
      queueTileSync()
    }, TILE_SYNC_HEARTBEAT_MS)
    return () => clearInterval(interval)
  }, [queueTileSync])

  return {
    handleSearchAndLoad,
    handleSave,
  }
}
