import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import DeckGL from '@deck.gl/react'
import { BitmapLayer, GeoJsonLayer } from '@deck.gl/layers'
import { MVTLayer, Tile3DLayer, TileLayer } from '@deck.gl/geo-layers'
import { I3SLoader, loadFeatureAttributes } from '@loaders.gl/i3s'
import { fetchCityData } from '../../lib/planner/arcgisDataService'
import { fetchPlannerMap, savePlannerMap } from '../../lib/planner/api'
import {
  applyModificationsToTile,
  computeMoveDelta,
  pickingIndexToFeatureId,
} from '../../lib/planner/i3sGeometryUtils'

const DEFAULT_LOCATION = 'Montreal, Quebec, Canada'
const I3S_SCENE_LAYER_URL =
  'https://basemaps3d.arcgis.com/arcgis/rest/services/Esri3D_Buildings_v1/SceneServer/layers/0'
const WORLD_MAP_TILE_URL =
  'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
const WORLD_ROADS_TILE_URL =
  'https://basemaps.arcgis.com/arcgis/rest/services/OpenStreetMap_v2/VectorTileServer/tile/{z}/{y}/{x}.pbf'
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

function isWorldRoadFeature(feature) {
  const geometryType = feature?.geometry?.type
  if (geometryType !== 'LineString' && geometryType !== 'MultiLineString') {
    return false
  }

  const properties = feature?.properties || {}
  const layerName = String(
    properties.layerName || properties.layer || properties.vt_layer || properties._layer || properties.sourceLayer || '',
  ).toLowerCase()
  const roadClass = String(
    properties.class || properties.kind || properties.type || properties.fclass || properties._class || '',
  ).toLowerCase()
  const roadName = String(properties._name_local || properties._name_global || properties.name || '').toLowerCase()

  const nonRoadHints = ['water', 'river', 'stream', 'canal', 'ferry', 'rail', 'railroad', 'boundary', 'admin', 'coast']
  if (nonRoadHints.some((hint) => layerName.includes(hint) || roadClass.includes(hint))) {
    return false
  }

  return (
    layerName.includes('road') ||
    layerName.includes('highway') ||
    layerName.includes('transport') ||
    layerName.includes('street') ||
    layerName.includes('trail') ||
    layerName.includes('path') ||
    layerName.includes('lane') ||
    layerName.includes('route') ||
    layerName.includes('bridge') ||
    layerName.includes('tunnel') ||
    layerName.includes('traffic') ||
    layerName.includes('drive') ||
    layerName.includes('boulevard') ||
    layerName.includes('avenue') ||
    [
      'motorway',
      'motorway_link',
      'trunk',
      'trunk_link',
      'primary',
      'primary_link',
      'secondary',
      'secondary_link',
      'tertiary',
      'tertiary_link',
      'residential',
      'service',
      'road',
      'street',
      'unclassified',
      'living_street',
      'track',
      'path',
      'trail',
      'pedestrian',
      'footway',
      'cycleway',
      'steps',
      'minor',
      'local',
    ].includes(roadClass) ||
    (!!roadName && !nonRoadHints.some((hint) => roadName.includes(hint)))
  )
}

function isWorldWaterFeature(feature) {
  const geometryType = feature?.geometry?.type
  if (geometryType !== 'LineString' && geometryType !== 'MultiLineString') {
    return false
  }

  const properties = feature?.properties || {}
  const layerName = String(
    properties.layerName || properties.layer || properties.vt_layer || properties._layer || '',
  ).toLowerCase()
  const waterClass = String(properties.class || properties.kind || properties.type || '').toLowerCase()

  return (
    layerName.includes('water') ||
    layerName.includes('river') ||
    layerName.includes('stream') ||
    layerName.includes('canal') ||
    layerName.includes('waterway') ||
    ['river', 'stream', 'canal', 'ditch', 'drain', 'waterway'].includes(waterClass)
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
  const [buildingMods, setBuildingMods] = useState(new Map())
  const [highlightedI3sIndex, setHighlightedI3sIndex] = useState(-1)
  const [selectedI3sPickIndex, setSelectedI3sPickIndex] = useState(-1)
  const [selectedI3sTile, setSelectedI3sTile] = useState(null)
  const [selectedBuildingAttrs, setSelectedBuildingAttrs] = useState(null)
  const [moveMode, setMoveMode] = useState(false)
  const [moveSrcCoord, setMoveSrcCoord] = useState(null)
  const [pickCoord, setPickCoord] = useState(null)
  const [i3sModVersion, setI3sModVersion] = useState(0)
  const buildingModsRef = useRef(buildingMods)
  buildingModsRef.current = buildingMods

  const roadData = useMemo(() => buildFeatureCollection(features, 'road'), [features])
  const riverData = useMemo(() => buildFeatureCollection(features, 'river'), [features])

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
    if (selectedSourceType === 'i3s' && selectedI3sTile && highlightedI3sIndex >= 0) {
      setMoveMode(true)
      if (pickCoord) {
        setMoveSrcCoord([pickCoord[0], pickCoord[1]])
      } else {
        const mbs = selectedI3sTile.header?.mbs
        setMoveSrcCoord(mbs ? [mbs[0], mbs[1]] : null)
      }
      setStatus('Move mode: click a destination on the map.')
      return
    }
    setStatus(`Edit ${selectedFeatureId} is not implemented yet.`)
  }, [selectedFeatureId, selectedSourceType, selectedI3sTile, highlightedI3sIndex, pickCoord])

  const handleDelete = useCallback(() => {
    if (!selectedFeatureId) {
      setStatus('Select a feature to delete.')
      return
    }

    if (selectedSourceType === 'i3s') {
      const featureId = highlightedI3sIndex
      if (featureId < 0) {
        setStatus('No I3S building selected.')
        return
      }
      setBuildingMods((prev) => {
        const next = new Map(prev)
        next.set(featureId, { action: 'delete' })
        return next
      })
      setI3sModVersion((v) => v + 1)
      setSelectedFeatureId(null)
      setSelectedSourceType(null)
      setHighlightedI3sIndex(-1)
      setSelectedI3sPickIndex(-1)
      setSelectedI3sTile(null)
      setSelectedBuildingAttrs(null)
      setIsDirty(true)
      setStatus(`I3S building (ID: ${featureId}) deleted.`)
      return
    }

    setFeatures((previous) => previous.filter((feature) => feature.id !== selectedFeatureId))
    setSelectedFeatureId(null)
    setSelectedSourceType(null)
    setIsDirty(true)
    setStatus('Feature deleted.')
  }, [selectedFeatureId, selectedSourceType, highlightedI3sIndex, selectedI3sTile])

  const handleDeckClick = useCallback((info) => {
    if (moveMode && info.coordinate) {
      const [toLon, toLat] = info.coordinate
      const [fromLon, fromLat] = moveSrcCoord || [toLon, toLat]
      const featureId = highlightedI3sIndex

      if (featureId >= 0) {
        const delta = computeMoveDelta(fromLon, fromLat, toLon, toLat)
        setBuildingMods((prev) => {
          const next = new Map(prev)
          const existing = next.get(featureId)
          const prevDelta = existing?.delta || [0, 0, 0]
          next.set(featureId, {
            action: 'move',
            delta: [prevDelta[0] + delta[0], prevDelta[1] + delta[1], prevDelta[2] + delta[2]],
          })
          return next
        })
        setI3sModVersion((v) => v + 1)
        setIsDirty(true)
        setStatus(`Building (ID: ${featureId}) moved.`)
      }
      setMoveMode(false)
      setMoveSrcCoord(null)
      return
    }

    if (!info?.object) {
      setSelectedFeatureId(null)
      setSelectedSourceType(null)
      setHighlightedI3sIndex(-1)
      setSelectedI3sPickIndex(-1)
      setSelectedI3sTile(null)
      setSelectedBuildingAttrs(null)
      setStatus(SELECT_HINT)
      return
    }

    if (info.layer?.id?.startsWith('i3s-buildings')) {
      const pickingIndex = info.index
      const realFeatureId = pickingIndexToFeatureId(info.object, pickingIndex)
      setHighlightedI3sIndex(realFeatureId)
      setSelectedI3sPickIndex(pickingIndex)
      setSelectedI3sTile(info.object)
      setSelectedFeatureId(`i3s_${realFeatureId}`)
      setSelectedSourceType('i3s')
      setSelectedBuildingAttrs(null)
      setPickCoord(info.coordinate || null)
      setStatus(`Selected I3S building (ID: ${realFeatureId}). Loading attributes...`)
      loadFeatureAttributes(info.object, realFeatureId)
        .then((attrs) => {
          if (attrs) {
            setSelectedBuildingAttrs(attrs)
            const name = attrs.name || 'unnamed'
            const height = attrs.height || '?'
            setStatus(`I3S: ${name} | Height: ${height}m | ID: ${realFeatureId}`)
          } else {
            setStatus(`Selected I3S building (ID: ${realFeatureId})`)
          }
        })
        .catch(() => setStatus(`Selected I3S building (ID: ${realFeatureId})`))
      return
    }

    const sourceId = info.object?.properties?.sourceId
    const sourceType = info.object?.properties?.entityType
    const name = info.object?.properties?.name || 'unnamed'

    if (!sourceId) {
      setSelectedFeatureId(null)
      setSelectedSourceType(null)
      setHighlightedI3sIndex(-1)
      setSelectedI3sPickIndex(-1)
      setSelectedI3sTile(null)
      setSelectedBuildingAttrs(null)
      setStatus(SELECT_HINT)
      return
    }

    setSelectedFeatureId(sourceId)
    setSelectedSourceType('feature')
    setStatus(`Selected ${sourceType}: ${name}`)
  }, [moveMode, moveSrcCoord, highlightedI3sIndex, selectedI3sTile])

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
        id: `i3s-buildings-${i3sModVersion}`,
        data: I3S_SCENE_LAYER_URL,
        loader: I3SLoader,
        pickable: true,
        highlightedObjectIndex: selectedI3sPickIndex,
        loadOptions: {
          i3s: {
            decodeTextures: false,
          },
        },
        onTileLoad: (tile) => {
          applyModificationsToTile(tile, buildingModsRef.current)
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
        zoomOffset: -2,
        binary: false,
        pickable: false,
        filled: false,
        stroked: true,
        parameters: {
          depthTest: true,
        },
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
      new MVTLayer({
        id: 'world-waterways-layer',
        data: WORLD_ROADS_TILE_URL,
        minZoom: 0,
        maxZoom: 20,
        zoomOffset: -2,
        binary: false,
        pickable: false,
        filled: false,
        stroked: true,
        parameters: {
          depthTest: true,
        },
        loadOptions: {
          mvt: {
            coordinates: 'wgs84',
          },
        },
        getLineColor: (feature) => (isWorldWaterFeature(feature) ? COLORS.river : [0, 0, 0, 0]),
        getLineWidth: (feature) => (isWorldWaterFeature(feature) ? 2 : 0),
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
    ]

    return layerList
  }, [riverData, roadData, selectedFeatureId, selectedI3sPickIndex, i3sModVersion])

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
          <p>Selected: {selectedFeatureId ? String(selectedFeatureId).slice(0, 14) : 'none'}</p>
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
        <DeckGL
          layers={layers}
          viewState={viewState}
          controller
          onViewStateChange={({ viewState: nextViewState }) => setViewState(nextViewState)}
          onClick={handleDeckClick}
          getCursor={({ isHovering }) => (moveMode ? 'crosshair' : isHovering ? 'pointer' : 'grab')}
          style={{ position: 'absolute', inset: 0, backgroundColor: '#0a0a0a' }}
        />
      </div>
    </div>
  )
}
