import { useCallback, useEffect } from 'react'
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
} from './constants'
import { normalizeFetchRadius } from './helpers'

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
    setStatus('Loading Montreal...')
    handleSearchAndLoad(DEFAULT_LOCATION, DEFAULT_FETCH_RADIUS_METERS)
  }, [handleSearchAndLoad, setStatus])

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
  }, [queueTileSync, setI3sFailed, setStatus, tilesetRef])

  useEffect(() => {
    const interval = setInterval(() => {
      queueTileSync()
    }, 4500)
    return () => clearInterval(interval)
  }, [queueTileSync])

  return {
    handleSearchAndLoad,
    handleSave,
  }
}
