import { useEffect, useRef, useState } from 'react'
import Map from '@arcgis/core/Map.js'
import SceneView from '@arcgis/core/views/SceneView.js'
import SceneLayer from '@arcgis/core/layers/SceneLayer.js'
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer.js'
import Graphic from '@arcgis/core/Graphic.js'
import SketchViewModel from '@arcgis/core/widgets/Sketch/SketchViewModel.js'
import * as locator from '@arcgis/core/rest/locator.js'
import * as geometryJsonUtils from '@arcgis/core/geometry/support/jsonUtils.js'
import '@arcgis/core/assets/esri/themes/dark/main.css'
import { fetchPlannerMap, savePlannerMap } from '../../lib/planner/api'

const GEOCODER_URL =
  'https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer'
const DEFAULT_LOCATION = 'Montreal, Quebec, Canada'
const BUILDINGS_LAYER_PRIMARY_ID = 'b8fec5af7dfe4866b1b8ac2d2800f282'

const ENTITY_OPTIONS = [
  { value: 'building', label: 'Building' },
  { value: 'road', label: 'Road' },
  { value: 'river', label: 'River' },
  { value: 'park', label: 'Park' },
]

const GEOMETRY_BY_ENTITY = {
  building: 'polygon',
  road: 'polyline',
  river: 'polyline',
  park: 'polygon',
}

function createCityBuildingsLayer(portalItemId) {
  return new SceneLayer({
    portalItem: { id: portalItemId },
    title: 'City Buildings',
    opacity: 1,
  })
}

function getEntitySymbol(entityType, attributes = {}) {
  if (entityType === 'building') {
    return {
      type: 'polygon-3d',
      symbolLayers: [
        {
          type: 'extrude',
          size: Number(attributes.height ?? 30),
          material: { color: '#b0b6bd' },
          edges: {
            type: 'solid',
            color: '#1f2937',
            size: 1,
          },
        },
      ],
    }
  }

  if (entityType === 'road') {
    return {
      type: 'simple-line',
      color: '#e4a11b',
      width: 3,
    }
  }

  if (entityType === 'river') {
    return {
      type: 'simple-line',
      color: '#4ea8de',
      width: 3,
    }
  }

  return {
    type: 'simple-fill',
    color: [94, 224, 139, 0.35],
    outline: {
      color: '#2a7f44',
      width: 1.5,
    },
  }
}

function graphicToFeature(graphic) {
  const attributes = { ...(graphic.attributes ?? {}) }
  const featureId = String(attributes.id ?? crypto.randomUUID())
  const entityType = attributes.entityType

  delete attributes.id
  delete attributes.entityType

  return {
    id: featureId,
    entityType,
    geometry: graphic.geometry.toJSON(),
    attributes,
  }
}

function featureToGraphic(feature) {
  const geometry = geometryJsonUtils.fromJSON(feature.geometry)
  if (!geometry) {
    return null
  }

  const attributes = {
    ...(feature.attributes ?? {}),
    id: feature.id,
    entityType: feature.entityType,
  }

  return new Graphic({
    geometry,
    attributes,
    symbol: getEntitySymbol(feature.entityType, attributes),
  })
}

export function PlannerShell() {
  const mapContainerRef = useRef(null)
  const viewRef = useRef(null)
  const sketchVMRef = useRef(null)
  const selectedGraphicRef = useRef(null)
  const actionsRef = useRef({})
  const entityTypeRef = useRef('building')
  const currentCreateTypeRef = useRef('building')
  const featuresRef = useRef([])
  const activeLocationRef = useRef(DEFAULT_LOCATION)

  const [entityType, setEntityType] = useState('building')
  const [locationInput, setLocationInput] = useState(DEFAULT_LOCATION)
  const [activeLocation, setActiveLocation] = useState(DEFAULT_LOCATION)
  const [features, setFeatures] = useState([])
  const [selectedFeatureId, setSelectedFeatureId] = useState(null)
  const [status, setStatus] = useState('Initializing planner...')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  useEffect(() => {
    featuresRef.current = features
  }, [features])

  useEffect(() => {
    activeLocationRef.current = activeLocation
  }, [activeLocation])

  useEffect(() => {
    entityTypeRef.current = entityType
  }, [entityType])

  useEffect(() => {
    if (!mapContainerRef.current) {
      return undefined
    }

    const editableLayers = {
      building: new GraphicsLayer({ title: 'Buildings', id: 'planner-buildings' }),
      road: new GraphicsLayer({ title: 'Roads', id: 'planner-roads' }),
      river: new GraphicsLayer({ title: 'Rivers', id: 'planner-rivers' }),
      park: new GraphicsLayer({ title: 'Parks', id: 'planner-parks' }),
    }

    const editableLayerSet = new Set(Object.values(editableLayers))

    const cityBuildingsLayer = createCityBuildingsLayer(BUILDINGS_LAYER_PRIMARY_ID)
    const map = new Map({
      basemap: 'dark-gray-vector',
      ground: 'world-elevation',
      layers: [
        cityBuildingsLayer,
        ...Object.values(editableLayers),
      ],
    })

    const view = new SceneView({
      container: mapContainerRef.current,
      map,
      center: [-73.5673, 45.5017],
      zoom: 14,
      qualityProfile: 'high',
    })

    view.environment = {
      atmosphereEnabled: false,
      starsEnabled: false,
      lighting: {
        directShadowsEnabled: true,
        ambientOcclusionEnabled: true,
      },
    }

    viewRef.current = view

    const sketchVM = new SketchViewModel({
      view,
      updateOnGraphicClick: false,
      defaultCreateOptions: { hasZ: false },
      defaultUpdateOptions: {
        enableRotation: true,
        enableScaling: true,
        multipleSelectionEnabled: false,
      },
    })

    sketchVMRef.current = sketchVM

    const clearSelection = () => {
      selectedGraphicRef.current = null
      setSelectedFeatureId(null)
    }

    const syncFeaturesFromLayers = (markDirty = true) => {
      const nextFeatures = Object.values(editableLayers).flatMap((layer) =>
        layer.graphics
          .toArray()
          .map((graphic) => graphicToFeature(graphic))
          .filter((feature) => feature.entityType),
      )

      setFeatures(nextFeatures)
      if (markDirty) {
        setIsDirty(true)
      }
    }

    const loadFeaturesIntoLayers = (incomingFeatures) => {
      for (const layer of Object.values(editableLayers)) {
        layer.removeAll()
      }

      const sanitized = []

      for (const feature of incomingFeatures ?? []) {
        const layer = editableLayers[feature.entityType]
        if (!layer) {
          continue
        }

        const graphic = featureToGraphic(feature)
        if (!graphic) {
          continue
        }

        layer.add(graphic)
        sanitized.push(feature)
      }

      setFeatures(sanitized)
      setIsDirty(false)
      clearSelection()
    }

    const geocodeAndFocus = async (query) => {
      const candidates = await locator.addressToLocations(
        GEOCODER_URL,
        {
          address: { SingleLine: query },
          outFields: ['*'],
          maxLocations: 1,
        },
        {
          signal: AbortSignal.timeout(10000),
        },
      )

      if (!candidates || candidates.length === 0) {
        throw new Error('Location not found')
      }

      const candidate = candidates[0]
      await view.goTo({
        target: candidate.location,
        tilt: 68,
        heading: 20,
        scale: 8000,
      })

      return candidate.attributes?.LongLabel || candidate.address || query
    }

    const loadMapForLocation = async (location) => {
      setIsLoading(true)
      setStatus(`Loading saved map for ${location}...`)

      try {
        const payload = await fetchPlannerMap(location)
        const loadedFeatures = Array.isArray(payload.features) ? payload.features : []
        loadFeaturesIntoLayers(loadedFeatures)
        setStatus(
          `Loaded ${loadedFeatures.length} feature${loadedFeatures.length === 1 ? '' : 's'} for ${location}.`,
        )
      } catch {
        loadFeaturesIntoLayers([])
        setStatus(`No saved map found for ${location}. Start creating.`)
      } finally {
        setIsLoading(false)
      }
    }

    const handlers = [
      sketchVM.on('create', (event) => {
        if (event.state !== 'complete') {
          return
        }

        const createdType = currentCreateTypeRef.current
        const graphic = event.graphic
        const id = crypto.randomUUID()

        const attributes = {
          ...(graphic.attributes ?? {}),
          id,
          entityType: createdType,
        }

        if (createdType === 'building') {
          attributes.height = Number(attributes.height ?? 30)
        }

        graphic.attributes = attributes
        graphic.symbol = getEntitySymbol(createdType, attributes)

        selectedGraphicRef.current = graphic
        setSelectedFeatureId(id)
        syncFeaturesFromLayers(true)
        setStatus(`Created ${createdType}.`)
      }),

      sketchVM.on('update', (event) => {
        if (event.state !== 'complete') {
          return
        }

        for (const graphic of event.graphics ?? []) {
          const type = graphic.attributes?.entityType
          if (type === 'building' && !graphic.attributes?.height) {
            graphic.attributes = { ...graphic.attributes, height: 30 }
          }
          if (type) {
            graphic.symbol = getEntitySymbol(type, graphic.attributes)
          }
        }

        syncFeaturesFromLayers(true)
        setStatus('Updated selected feature.')
      }),

      view.on('click', async (event) => {
        if (sketchVM.state === 'active') {
          return
        }

        const hit = await view.hitTest(event)
        const result = hit.results.find(
          (item) => item.graphic && editableLayerSet.has(item.graphic.layer),
        )

        if (!result) {
          clearSelection()
          return
        }

        const graphic = result.graphic
        selectedGraphicRef.current = graphic
        setSelectedFeatureId(graphic.attributes?.id ?? null)

        if (graphic.attributes?.entityType) {
          setEntityType(graphic.attributes.entityType)
        }

        setStatus(`Selected ${graphic.attributes?.entityType ?? 'feature'}.`)
      }),

    ]

    actionsRef.current = {
      startCreate: () => {
        const nextType = entityTypeRef.current
        const targetLayer = editableLayers[nextType]

        if (!targetLayer) {
          return
        }

        currentCreateTypeRef.current = nextType
        sketchVM.cancel()
        sketchVM.layer = targetLayer
        sketchVM.create(GEOMETRY_BY_ENTITY[nextType])
        setStatus(`Drawing ${nextType}... click to place vertices.`)
      },

      startEdit: () => {
        const selected = selectedGraphicRef.current

        if (!selected) {
          setStatus('Select a feature first.')
          return
        }

        sketchVM.cancel()
        sketchVM.update(selected, {
          tool: 'transform',
          enableRotation: true,
          enableScaling: true,
        })
        setStatus('Editing selected feature...')
      },

      deleteSelected: () => {
        const selected = selectedGraphicRef.current

        if (!selected || !selected.layer) {
          setStatus('Select a feature to delete.')
          return
        }

        selected.layer.remove(selected)
        clearSelection()
        syncFeaturesFromLayers(true)
        setStatus('Feature deleted.')
      },

      searchAndLoad: async (query) => {
        const trimmed = query.trim()
        if (!trimmed) {
          setStatus('Enter a location first.')
          return
        }

        setIsLoading(true)
        setStatus(`Searching ${trimmed}...`)

        try {
          const resolvedLocation = await geocodeAndFocus(trimmed)
          setActiveLocation(resolvedLocation)
          setLocationInput(resolvedLocation)
          await loadMapForLocation(resolvedLocation)
        } catch (error) {
          setStatus(error.message || 'Failed to search location.')
          setIsLoading(false)
        }
      },

      saveCurrent: async () => {
        const location = activeLocationRef.current
        if (!location) {
          setStatus('Search a location first.')
          return
        }

        setIsSaving(true)
        setStatus(`Saving map for ${location}...`)

        try {
          await savePlannerMap({
            location,
            features: featuresRef.current,
          })

          setIsDirty(false)
          setStatus(`Saved ${featuresRef.current.length} features for ${location}.`)
        } catch (error) {
          setStatus(error.message || 'Save failed.')
        } finally {
          setIsSaving(false)
        }
      },

    }

    view
      .when(async () => {
        await cityBuildingsLayer.load()
        setStatus('Map ready. Loading Montreal...')
        await actionsRef.current.searchAndLoad(DEFAULT_LOCATION)
      })
      .catch((error) => {
        setStatus(`Failed to initialize 3D view: ${error.message}`)
      })

    return () => {
      actionsRef.current = {}
      handlers.forEach((handler) => handler.remove())
      sketchVM.cancel()
      sketchVM.destroy()
      view.destroy()
      viewRef.current = null
      sketchVMRef.current = null
    }
  }, [])

  const handleSearchSubmit = async (event) => {
    event.preventDefault()
    await actionsRef.current.searchAndLoad?.(locationInput)
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
            onClick={() => actionsRef.current.searchAndLoad?.(DEFAULT_LOCATION)}
            className="h-9 px-3 rounded-md bg-zinc-800 hover:bg-zinc-700 disabled:opacity-60 text-sm"
          >
            Montreal
          </button>
          <button
            type="button"
            disabled={isSaving || isLoading}
            onClick={() => actionsRef.current.saveCurrent?.()}
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
            onClick={() => actionsRef.current.startCreate?.()}
            className="h-9 rounded-md bg-indigo-700 hover:bg-indigo-600 text-sm"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => actionsRef.current.startEdit?.()}
            className="h-9 rounded-md bg-zinc-700 hover:bg-zinc-600 text-sm"
          >
            Edit / Move
          </button>
          <button
            type="button"
            onClick={() => actionsRef.current.deleteSelected?.()}
            className="h-9 rounded-md bg-rose-700 hover:bg-rose-600 text-sm"
          >
            Delete
          </button>
        </div>

        <div className="space-y-1 text-sm text-zinc-300">
          <p>Features: {features.length}</p>
          <p>Selected: {selectedFeatureId ? selectedFeatureId.slice(0, 8) : 'none'}</p>
          <p>Status: {isDirty ? 'Unsaved changes' : 'Saved'}</p>
        </div>

        <div className="rounded-md border border-zinc-800 bg-zinc-950/70 p-3 text-xs text-zinc-300 leading-relaxed">
          <p>{status}</p>
        </div>


      </div>

      <div className="absolute top-14 left-72 right-0 bottom-0">
        <div ref={mapContainerRef} className="h-full w-full" />
      </div>
    </div>
  )
}
