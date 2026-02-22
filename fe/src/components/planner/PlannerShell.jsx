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
import { ThreeBatchPreview } from './ThreeBatchPreview'

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

function getSceneObjectId(attributes = {}) {
  const value = attributes.ObjectID ?? attributes.OBJECTID ?? attributes.objectid ?? null
  if (value === null || value === undefined) {
    return null
  }

  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
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
  const supportDebugEnabledRef = useRef(false)
  const supportDebugNodesRef = useRef(new Map())

  const [entityType, setEntityType] = useState('building')
  const [locationInput, setLocationInput] = useState(DEFAULT_LOCATION)
  const [activeLocation, setActiveLocation] = useState(DEFAULT_LOCATION)
  const [features, setFeatures] = useState([])
  const [selectedFeatureId, setSelectedFeatureId] = useState(null)
  const [status, setStatus] = useState('Initializing planner...')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [supportDebugEnabled, setSupportDebugEnabled] = useState(false)
  const [supportDebugStats, setSupportDebugStats] = useState({
    fetched: 0,
    extents: 0,
    grounded: 0,
    connected: 0,
    unsupported: 0,
    supports: 0,
    lastSync: null,
    lastError: null,
  })
  const [selectedSupportDebug, setSelectedSupportDebug] = useState(null)

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
    supportDebugEnabledRef.current = supportDebugEnabled
  }, [supportDebugEnabled])

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
    const cityBuildingsSupportLayer = new GraphicsLayer({
      title: 'City Buildings (Support Fill)',
      id: 'city-buildings-support-fill',
      elevationInfo: { mode: 'on-the-ground' },
      visible: supportDebugEnabledRef.current,
    })
    const cityBuildingsDebugLayer = new GraphicsLayer({
      title: 'City Buildings (Support Debug)',
      id: 'city-buildings-support-debug',
      elevationInfo: { mode: 'on-the-ground' },
      visible: supportDebugEnabledRef.current,
    })

    let supportBuildingsRequestToken = 0

    const map = new Map({
      basemap: 'dark-gray-vector',
      ground: 'world-elevation',
      layers: [
        cityBuildingsDebugLayer,
        cityBuildingsSupportLayer,
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

    const extentsTouch = (a, b, xyTolerance = 0.5, zTolerance = 1.5) => {
      const xyOverlap =
        a.xmin <= b.xmax + xyTolerance &&
        a.xmax >= b.xmin - xyTolerance &&
        a.ymin <= b.ymax + xyTolerance &&
        a.ymax >= b.ymin - xyTolerance

      if (!xyOverlap) {
        return false
      }

      return a.zmin <= b.zmax + zTolerance && b.zmin <= a.zmax + zTolerance
    }

    const extentToFootprint = (extent) => ({
      type: 'polygon',
      spatialReference: extent.spatialReference,
      rings: [
        [
          [extent.xmin, extent.ymin],
          [extent.xmin, extent.ymax],
          [extent.xmax, extent.ymax],
          [extent.xmax, extent.ymin],
          [extent.xmin, extent.ymin],
        ],
      ],
    })

    const syncSupportCityBuildings = async () => {
      if (!view.ready || view.scale > 18000) {
        cityBuildingsSupportLayer.removeAll()
        cityBuildingsDebugLayer.removeAll()
        supportDebugNodesRef.current = new Map()
        setSupportDebugStats((prev) => ({
          ...prev,
          fetched: 0,
          extents: 0,
          grounded: 0,
          connected: 0,
          unsupported: 0,
          supports: 0,
          lastSync: new Date().toISOString(),
          lastError: null,
        }))
        return
      }

      const requestToken = ++supportBuildingsRequestToken

      try {
        const layerView = await view.whenLayerView(cityBuildingsLayer)

        const idQuery = layerView.createQuery()
        idQuery.where = '1=1'
        idQuery.geometry = view.extent
        idQuery.spatialRelationship = 'intersects'
        idQuery.num = 400

        const objectIds = await layerView.queryObjectIds(idQuery)
        if (requestToken !== supportBuildingsRequestToken) {
          return
        }

        if (!objectIds || objectIds.length === 0) {
          cityBuildingsSupportLayer.removeAll()
          cityBuildingsDebugLayer.removeAll()
          supportDebugNodesRef.current = new Map()
          setSupportDebugStats((prev) => ({
            ...prev,
            fetched: 0,
            extents: 0,
            grounded: 0,
            connected: 0,
            unsupported: 0,
            supports: 0,
            lastSync: new Date().toISOString(),
            lastError: null,
          }))
          return
        }

        const sampledObjectIds = objectIds.slice(0, 400)
        const extentNodes = []

        for (let index = 0; index < sampledObjectIds.length; index += 20) {
          const chunk = sampledObjectIds.slice(index, index + 20)

          const chunkExtents = await Promise.all(
            chunk.map(async (objectId) => {
              const extentQuery = layerView.createQuery()
              extentQuery.objectIds = [objectId]
              const extentResult = await layerView.queryExtent(extentQuery)
              const extent = extentResult?.extent

              if (!extent) {
                return null
              }

              const zmin = Number.isFinite(extent.zmin) ? extent.zmin : 0
              const zmax = Number.isFinite(extent.zmax) ? extent.zmax : zmin + 3

              return {
                objectId,
                extent,
                xmin: extent.xmin,
                ymin: extent.ymin,
                xmax: extent.xmax,
                ymax: extent.ymax,
                zmin,
                zmax,
              }
            }),
          )

          if (requestToken !== supportBuildingsRequestToken) {
            return
          }

          for (const node of chunkExtents) {
            if (node) {
              extentNodes.push(node)
            }
          }
        }

        if (extentNodes.length === 0) {
          cityBuildingsSupportLayer.removeAll()
          cityBuildingsDebugLayer.removeAll()
          supportDebugNodesRef.current = new Map()
          setSupportDebugStats((prev) => ({
            ...prev,
            fetched: sampledObjectIds.length,
            extents: 0,
            grounded: 0,
            connected: 0,
            unsupported: 0,
            supports: 0,
            lastSync: new Date().toISOString(),
            lastError: null,
          }))
          return
        }

        const groundedThreshold = 2.5
        const connectedObjectIds = new Set(
          extentNodes
            .filter((node) => node.zmin <= groundedThreshold)
            .map((node) => node.objectId),
        )
        const queue = [...connectedObjectIds]

        while (queue.length > 0) {
          const currentObjectId = queue.shift()
          const current = extentNodes.find((node) => node.objectId === currentObjectId)

          if (!current) {
            continue
          }

          for (const candidate of extentNodes) {
            if (connectedObjectIds.has(candidate.objectId)) {
              continue
            }

            if (extentsTouch(current, candidate)) {
              connectedObjectIds.add(candidate.objectId)
              queue.push(candidate.objectId)
            }
          }
        }

        const graphics = []
        const debugGraphics = []
        const debugNodes = new Map()

        const groundedCount = extentNodes.filter((node) => node.zmin <= groundedThreshold).length

        for (const node of extentNodes) {
          let classification = 'grounded'
          let supportHeight = 0

          if (node.zmin > groundedThreshold && !connectedObjectIds.has(node.objectId)) {
            classification = 'unsupported'
            supportHeight = Math.min(Math.max(node.zmin - 0.5, 1.5), 180)

            graphics.push(
              new Graphic({
                geometry: extentToFootprint(node.extent),
                attributes: { objectId: node.objectId },
                elevationInfo: { mode: 'on-the-ground' },
                symbol: {
                  type: 'polygon-3d',
                  symbolLayers: [
                    {
                      type: 'extrude',
                      size: supportHeight,
                      material: { color: [228, 231, 236, 0.92] },
                      edges: {
                        type: 'solid',
                        color: [180, 186, 195, 0.55],
                        size: 0.25,
                      },
                    },
                  ],
                },
              }),
            )
          } else if (node.zmin > groundedThreshold) {
            classification = 'connected'
          }

          debugNodes.set(String(node.objectId), {
            objectId: node.objectId,
            zmin: Number(node.zmin.toFixed(2)),
            zmax: Number(node.zmax.toFixed(2)),
            supportHeight: Number(supportHeight.toFixed(2)),
            classification,
          })

          if (supportDebugEnabledRef.current) {
            const outlineColor =
              classification === 'unsupported'
                ? [248, 113, 113, 0.95]
                : classification === 'connected'
                  ? [96, 165, 250, 0.95]
                  : [74, 222, 128, 0.95]

            debugGraphics.push(
              new Graphic({
                geometry: extentToFootprint(node.extent),
                attributes: {
                  objectId: node.objectId,
                  classification,
                  zmin: Number(node.zmin.toFixed(2)),
                  zmax: Number(node.zmax.toFixed(2)),
                },
                symbol: {
                  type: 'simple-fill',
                  color: [0, 0, 0, 0],
                  outline: {
                    color: outlineColor,
                    width: 1,
                  },
                },
              }),
            )
          }
        }

        supportDebugNodesRef.current = debugNodes

        cityBuildingsSupportLayer.visible = supportDebugEnabledRef.current
        cityBuildingsSupportLayer.removeAll()
        if (supportDebugEnabledRef.current && graphics.length > 0) {
          cityBuildingsSupportLayer.addMany(graphics)
        }

        cityBuildingsDebugLayer.removeAll()
        cityBuildingsDebugLayer.visible = supportDebugEnabledRef.current
        if (supportDebugEnabledRef.current && debugGraphics.length > 0) {
          cityBuildingsDebugLayer.addMany(debugGraphics)
        }

        setSupportDebugStats({
          fetched: sampledObjectIds.length,
          extents: extentNodes.length,
          grounded: groundedCount,
          connected: connectedObjectIds.size - groundedCount,
          unsupported: graphics.length,
          supports: graphics.length,
          lastSync: new Date().toISOString(),
          lastError: null,
        })
      } catch (error) {
        if (requestToken !== supportBuildingsRequestToken) {
          return
        }

        cityBuildingsSupportLayer.removeAll()
        cityBuildingsDebugLayer.removeAll()
        supportDebugNodesRef.current = new Map()
        setSupportDebugStats((prev) => ({
          ...prev,
          lastSync: new Date().toISOString(),
          lastError: error?.message || 'sync_failed',
        }))
        setStatus(`Support sync failed: ${error?.message || 'unknown error'}`)
      }
    }

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
        const sceneHit = hit.results.find((item) => {
          const layer = item.graphic?.layer
          return (
            layer === cityBuildingsLayer ||
            layer === cityBuildingsSupportLayer ||
            layer === cityBuildingsDebugLayer
          )
        })

        if (sceneHit?.graphic?.attributes) {
          const objectId =
            getSceneObjectId(sceneHit.graphic.attributes) ??
            getSceneObjectId({ ObjectID: sceneHit.graphic.attributes.objectId })

          if (objectId !== null) {
            const debugNode = supportDebugNodesRef.current.get(String(objectId))
            setSelectedSupportDebug(
              debugNode ?? {
                objectId,
                classification: 'not-sampled',
                zmin: null,
                zmax: null,
                supportHeight: null,
              },
            )
            setStatus(`Scene object ${objectId} (${debugNode?.classification ?? 'not-sampled'}).`)
          }
        }

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

      toggleSupportDebug: () => {
        const next = !supportDebugEnabledRef.current
        supportDebugEnabledRef.current = next
        setSupportDebugEnabled(next)
        cityBuildingsSupportLayer.visible = next
        cityBuildingsDebugLayer.visible = next

        if (!next) {
          cityBuildingsSupportLayer.removeAll()
          cityBuildingsDebugLayer.removeAll()
        } else {
          void syncSupportCityBuildings()
        }
      },

      refreshSupportDebug: async () => {
        await syncSupportCityBuildings()
      },
    }

    view
      .when(async () => {
        await cityBuildingsLayer.load()
        await syncSupportCityBuildings()
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
          <button
            type="button"
            onClick={() => actionsRef.current.toggleSupportDebug?.()}
            className="h-9 rounded-md bg-sky-700 hover:bg-sky-600 text-sm"
          >
            {supportDebugEnabled ? 'Debug overlay: ON' : 'Debug overlay: OFF'}
          </button>
          <button
            type="button"
            onClick={() => actionsRef.current.refreshSupportDebug?.()}
            className="h-9 rounded-md bg-zinc-700 hover:bg-zinc-600 text-sm"
          >
            Refresh support debug
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

        <div className="rounded-md border border-zinc-800 bg-zinc-950/70 p-3 text-xs text-zinc-300 space-y-1">
          <p className="uppercase tracking-wide text-zinc-400">Support debug</p>
          <p>Fetched IDs: {supportDebugStats.fetched}</p>
          <p>Extents loaded: {supportDebugStats.extents}</p>
          <p>Grounded: {supportDebugStats.grounded}</p>
          <p>Connected: {supportDebugStats.connected}</p>
          <p>Unsupported: {supportDebugStats.unsupported}</p>
          <p>Supports rendered: {supportDebugStats.supports}</p>
          <p>Error: {supportDebugStats.lastError ?? 'none'}</p>
          <p>
            Last sync:{' '}
            {supportDebugStats.lastSync
              ? new Date(supportDebugStats.lastSync).toLocaleTimeString()
              : 'never'}
          </p>
        </div>

        {selectedSupportDebug ? (
          <div className="rounded-md border border-zinc-800 bg-zinc-950/70 p-3 text-xs text-zinc-300 space-y-1">
            <p className="uppercase tracking-wide text-zinc-400">Selected scene object</p>
            <p>ID: {selectedSupportDebug.objectId}</p>
            <p>Class: {selectedSupportDebug.classification}</p>
            <p>zMin: {selectedSupportDebug.zmin ?? 'n/a'}</p>
            <p>zMax: {selectedSupportDebug.zmax ?? 'n/a'}</p>
            <p>Support height: {selectedSupportDebug.supportHeight ?? 'n/a'}</p>
          </div>
        ) : null}

        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-400 mb-2">
            Three.js batch preview
          </p>
          <ThreeBatchPreview features={features} />
        </div>
      </div>

      <div className="absolute top-14 left-72 right-0 bottom-0">
        <div ref={mapContainerRef} className="h-full w-full" />
      </div>
    </div>
  )
}
