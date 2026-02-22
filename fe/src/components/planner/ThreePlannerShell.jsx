import { useEffect, useMemo, useState, useCallback } from 'react'
import DeckGL from '@deck.gl/react'
import { BitmapLayer, GeoJsonLayer } from '@deck.gl/layers'
import { MVTLayer, Tile3DLayer, TileLayer } from '@deck.gl/geo-layers'
import { I3SLoader } from '@loaders.gl/i3s'
import { fetchCityData } from '../../lib/planner/arcgisDataService'
import { fetchPlannerMap, savePlannerMap } from '../../lib/planner/api'

const DEFAULT_LOCATION = 'Montreal, Quebec, Canada'
const I3S_SCENE_LAYER_URL =
  'https://basemaps3d.arcgis.com/arcgis/rest/services/Esri3D_Buildings_v1/SceneServer/layers/0'
const WORLD_MAP_TILE_URL =
  'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
const WORLD_ROADS_TILE_URL =
  'https://basemaps.arcgis.com/arcgis/rest/services/World_Basemap_v2/VectorTileServer/tile/{z}/{y}/{x}.pbf'
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
  park: [94, 224, 139, 180],
  parkSelected: [96, 165, 250, 220],
}

const ENTITY_OPTIONS = [
  { value: 'building', label: 'Building' },
  { value: 'road', label: 'Road' },
  { value: 'river', label: 'River' },
  { value: 'park', label: 'Park' },
]
const SELECT_HINT = 'Click a feature to select.'

function isWorldRoadFeature(feature) {
  const geometryType = feature?.geometry?.type
  if (geometryType !== 'LineString' && geometryType !== 'MultiLineString') {
    return false
  }

  const properties = feature?.properties || {}
  const layerName = String(
    properties.layerName || properties.layer || properties.vt_layer || properties._layer || '',
  ).toLowerCase()
  const roadClass = String(properties.class || properties.kind || properties.type || '').toLowerCase()

  return (
    layerName.includes('road') ||
    layerName.includes('highway') ||
    layerName.includes('transport') ||
    layerName.includes('street') ||
    layerName.includes('bridge') ||
    ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'service'].includes(
      roadClass,
    )
  )
}

function buildFeatureCollection(features, entityType) {
  const collection = []

  for (const feature of features) {
    if (feature.entityType !== entityType) {
      continue
    }

    if (entityType === 'building' || entityType === 'park') {
      const ring = feature.geometry?.rings?.[0]
      if (!Array.isArray(ring) || ring.length < 3) {
        continue
      }

      collection.push({
        type: 'Feature',
        properties: {
          sourceId: feature.id,
          entityType: feature.entityType,
          name: feature.attributes?.name || entityType,
          height: Number(feature.attributes?.height || 10),
        },
        geometry: {
          type: 'Polygon',
          coordinates: [ring],
        },
      })
      continue
    }

    const paths = feature.geometry?.paths
    if (!Array.isArray(paths) || paths.length === 0) {
      continue
    }

    collection.push({
      type: 'Feature',
      properties: {
        sourceId: feature.id,
        entityType: feature.entityType,
        name: feature.attributes?.name || entityType,
      },
      geometry: {
        type: paths.length === 1 ? 'LineString' : 'MultiLineString',
        coordinates: paths.length === 1 ? paths[0] : paths,
      },
    })
  }

  return {
    type: 'FeatureCollection',
    features: collection,
  }
}

export function ThreePlannerShell() {
  const [entityType, setEntityType] = useState('building')
  const [locationInput, setLocationInput] = useState(DEFAULT_LOCATION)
  const [activeLocation, setActiveLocation] = useState(DEFAULT_LOCATION)
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

  const roadData = useMemo(() => buildFeatureCollection(features, 'road'), [features])
  const riverData = useMemo(() => buildFeatureCollection(features, 'river'), [features])
  const parkData = useMemo(() => buildFeatureCollection(features, 'park'), [features])

  const loadFeaturesIntoState = useCallback((loadedFeatures, center) => {
    setI3sReady(false)
    setI3sFailed(false)

    setFeatures(loadedFeatures)
    setIsDirty(false)
    setSelectedFeatureId(null)
    setSelectedSourceType(null)

    if (Array.isArray(center) && center.length >= 2) {
      setViewState((previous) => ({
        ...previous,
        longitude: Number(center[0]) || previous.longitude,
        latitude: Number(center[1]) || previous.latitude,
        zoom: 15,
        pitch: 60,
        bearing: 20,
      }))
    }
  }, [])

  const handleSearchAndLoad = useCallback(async (query) => {
    const trimmed = query.trim()
    if (!trimmed) {
      setStatus('Enter a location first.')
      return
    }

    setIsLoading(true)
    setStatus(`Searching ${trimmed}...`)

    try {
      const cityData = await fetchCityData(trimmed)
      setActiveLocation(cityData.location)
      setLocationInput(cityData.location)

      setStatus(`Found ${cityData.features.length} features. Loading saved data...`)

      let mergedFeatures = cityData.features

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
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('(404)')) {
          throw error
        }
      }

      loadFeaturesIntoState(mergedFeatures, cityData.center)
      setStatus(`Loaded ${mergedFeatures.length} features for ${cityData.location}.`)
    } catch (error) {
      setStatus(error.message || 'Failed to search location.')
    } finally {
      setIsLoading(false)
    }
  }, [loadFeaturesIntoState])

  useEffect(() => {
    setStatus('Loading Montreal...')
    handleSearchAndLoad(DEFAULT_LOCATION)
  }, [handleSearchAndLoad])

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
    setStatus(`Edit ${selectedFeatureId} is not implemented yet.`)
  }, [selectedFeatureId])

  const handleDelete = useCallback(() => {
    if (!selectedFeatureId) {
      setStatus('Select a feature to delete.')
      return
    }

    if (selectedSourceType === 'i3s') {
      setStatus('I3S building meshes are read-only and cannot be deleted.')
      return
    }

    setFeatures((previous) => previous.filter((feature) => feature.id !== selectedFeatureId))
    setSelectedFeatureId(null)
    setSelectedSourceType(null)
    setIsDirty(true)
    setStatus('Feature deleted.')
  }, [selectedFeatureId, selectedSourceType])

  const handleDeckClick = useCallback((info) => {
    if (!info?.object) {
      setSelectedFeatureId(null)
      setSelectedSourceType(null)
      setStatus(SELECT_HINT)
      return
    }

    if (info.layer?.id === 'i3s-buildings') {
      const id = `i3s_${info.index ?? 'mesh'}`
      setSelectedFeatureId(id)
      setSelectedSourceType('i3s')
      setStatus('Selected I3S building mesh (read-only)')
      return
    }

    const sourceId = info.object?.properties?.sourceId
    const sourceType = info.object?.properties?.entityType
    const name = info.object?.properties?.name || 'unnamed'

    if (!sourceId) {
      setSelectedFeatureId(null)
      setSelectedSourceType(null)
      setStatus(SELECT_HINT)
      return
    }

    setSelectedFeatureId(sourceId)
    setSelectedSourceType('feature')
    setStatus(`Selected ${sourceType}: ${name}`)
  }, [])

  const layers = useMemo(() => {
    const layerList = [
      new TileLayer({
        id: 'world-map-layer',
        data: WORLD_MAP_TILE_URL,
        minZoom: 0,
        maxZoom: 16,
        tileSize: 256,
        pickable: false,
        renderSubLayers: (props) => {
          if (!props.data) {
            return null
          }

          const {
            tile: { bbox },
          } = props

          return new BitmapLayer(props, {
            data: null,
            image: props.data,
            bounds: [bbox.west, bbox.south, bbox.east, bbox.north],
          })
        },
      }),
      new Tile3DLayer({
        id: 'i3s-buildings',
        data: I3S_SCENE_LAYER_URL,
        loader: I3SLoader,
        pickable: true,
        loadOptions: {
          i3s: {
            decodeTextures: false,
          },
        },
        onTileLoad: () => {
          setI3sReady((ready) => {
            if (ready) {
              return ready
            }

            setStatus('ArcGIS 3D buildings loaded.')
            return true
          })
        },
        onTileError: (_, message) => {
          setI3sFailed((failed) => {
            if (failed) {
              return failed
            }

            setStatus(`I3S load issue: ${message || 'unknown error'}.`)
            return true
          })
        },
      }),
      new MVTLayer({
        id: 'world-roads-layer',
        data: WORLD_ROADS_TILE_URL,
        minZoom: 0,
        maxZoom: 20,
        pickable: false,
        filled: false,
        stroked: true,
        loadOptions: {
          mvt: {
            coordinates: 'wgs84',
          },
        },
        getLineColor: (feature) => (isWorldRoadFeature(feature) ? COLORS.road : [0, 0, 0, 0]),
        getLineWidth: (feature) => (isWorldRoadFeature(feature) ? 2 : 0),
        lineWidthUnits: 'pixels',
        lineWidthMinPixels: 1,
      }),
      new GeoJsonLayer({
        id: 'roads-layer',
        data: roadData,
        pickable: true,
        stroked: true,
        filled: false,
        lineWidthUnits: 'meters',
        getLineWidth: 4,
        getLineColor: (feature) =>
          selectedFeatureId && feature.properties.sourceId === selectedFeatureId
            ? COLORS.roadSelected
            : COLORS.road,
      }),
      new GeoJsonLayer({
        id: 'rivers-layer',
        data: riverData,
        pickable: true,
        stroked: true,
        filled: false,
        lineWidthUnits: 'meters',
        getLineWidth: 6,
        getLineColor: (feature) =>
          selectedFeatureId && feature.properties.sourceId === selectedFeatureId
            ? COLORS.riverSelected
            : COLORS.river,
      }),
      new GeoJsonLayer({
        id: 'parks-layer',
        data: parkData,
        pickable: true,
        stroked: false,
        filled: true,
        getFillColor: (feature) =>
          selectedFeatureId && feature.properties.sourceId === selectedFeatureId
            ? COLORS.parkSelected
            : COLORS.park,
      }),
    ]

    return layerList
  }, [parkData, riverData, roadData, selectedFeatureId])

  const handleSearchSubmit = (event) => {
    event.preventDefault()
    handleSearchAndLoad(locationInput)
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
            onClick={() => handleSearchAndLoad(DEFAULT_LOCATION)}
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

        <div className="space-y-1 text-sm text-zinc-300">
          <p>Features: {features.length}</p>
          <p>Selected: {selectedFeatureId ? selectedFeatureId.slice(0, 14) : 'none'}</p>
          <p>Status: {isDirty ? 'Unsaved changes' : 'Saved'}</p>
          <p>I3S: {i3sFailed ? 'failed' : i3sReady ? 'mesh loaded' : 'loading'}</p>
        </div>

        <div className="rounded-md border border-zinc-800 bg-zinc-950/70 p-3 text-xs text-zinc-300 leading-relaxed">
          <p>{status}</p>
        </div>
      </div>

      <div className="absolute top-14 left-72 right-0 bottom-0">
        <DeckGL
          layers={layers}
          viewState={viewState}
          controller
          onViewStateChange={({ viewState: nextViewState }) => setViewState(nextViewState)}
          onClick={handleDeckClick}
          getCursor={({ isHovering }) => (isHovering ? 'pointer' : 'grab')}
          style={{ position: 'absolute', inset: 0, backgroundColor: '#0a0a0a' }}
        />
      </div>
    </div>
  )
}
