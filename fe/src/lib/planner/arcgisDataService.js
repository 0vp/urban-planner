import { fetchFallbackRoads } from './api'

const GEOCODER_URL =
  'https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates'
const OSM_ARCGIS_SERVICE_ROOT = 'https://services6.arcgis.com/Do88DoK2xjTUCXd1/arcgis/rest/services'
const REGION_BY_COUNTRY = {
  USA: 'NA',
  CAN: 'NA',
  MEX: 'NA',
  BLZ: 'CA',
  CRI: 'CA',
  GTM: 'CA',
  HND: 'CA',
  NIC: 'CA',
  PAN: 'CA',
  SLV: 'CA',
  ARG: 'SA',
  BOL: 'SA',
  BRA: 'SA',
  CHL: 'SA',
  COL: 'SA',
  ECU: 'SA',
  GUY: 'SA',
  PRY: 'SA',
  PER: 'SA',
  SUR: 'SA',
  URY: 'SA',
  VEN: 'SA',
}

const MAX_BUILDINGS = 6000
const ROADS_PAGE_SIZE = 1800
const MAX_RIVERS = 600
const MAX_PARKS = 800
const DEFAULT_CITY_RADIUS_METERS = 1200
const MIN_CITY_RADIUS_METERS = 300
const MAX_CITY_RADIUS_METERS = 10000
const GEOCODE_TIMEOUT_MS = 8000
const FEATURE_QUERY_TIMEOUT_MS = 12000

function normalizeRadiusMeters(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return DEFAULT_CITY_RADIUS_METERS
  }
  return Math.round(Math.min(MAX_CITY_RADIUS_METERS, Math.max(MIN_CITY_RADIUS_METERS, parsed)))
}

function linkAbortSignal(sourceSignal, targetController) {
  if (!sourceSignal) {
    return () => {}
  }
  if (sourceSignal.aborted) {
    targetController.abort(sourceSignal.reason)
    return () => {}
  }
  const onAbort = () => targetController.abort(sourceSignal.reason)
  sourceSignal.addEventListener('abort', onAbort, { once: true })
  return () => sourceSignal.removeEventListener('abort', onAbort)
}

async function fetchJsonWithTimeout(url, {
  signal,
  timeoutMs,
  errorMessage,
}) {
  const timeoutController = new AbortController()
  const timeoutId = setTimeout(() => {
    timeoutController.abort()
  }, timeoutMs)

  const requestController = new AbortController()
  const detachExternalAbort = linkAbortSignal(signal, requestController)
  const detachTimeoutAbort = linkAbortSignal(timeoutController.signal, requestController)

  try {
    const response = await fetch(url, { signal: requestController.signal })
    if (!response.ok) {
      throw new Error(errorMessage || `Request failed (${response.status})`)
    }
    return await response.json()
  } catch (error) {
    if (timeoutController.signal.aborted && !signal?.aborted) {
      throw new Error(errorMessage ? `${errorMessage} (timeout)` : 'Request timed out')
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
    detachExternalAbort()
    detachTimeoutAbort()
  }
}

function getGeometryDetailParams(serviceSuffix, radiusMeters) {
  if (radiusMeters < 2500) {
    return {}
  }

  if (serviceSuffix === 'Buildings') {
    if (radiusMeters >= 5000) {
      return { geometryPrecision: '4', maxAllowableOffset: '0.00003' }
    }
    return { geometryPrecision: '5', maxAllowableOffset: '0.00002' }
  }

  if (radiusMeters >= 5000) {
    return { geometryPrecision: '5', maxAllowableOffset: '0.00002' }
  }

  return { geometryPrecision: '6', maxAllowableOffset: '0.00001' }
}

function getBoundsFromCenter(center, radiusMeters = 2000) {
  const lat = center[1]
  const lon = center[0]

  const latDelta = radiusMeters / 111320
  const lonDelta = radiusMeters / (111320 * Math.cos((lat * Math.PI) / 180))

  return {
    xmin: lon - lonDelta,
    ymin: lat - latDelta,
    xmax: lon + lonDelta,
    ymax: lat + latDelta,
  }
}

function haversineDistanceMeters(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) {
    return Number.POSITIVE_INFINITY
  }

  const lon1 = (Number(a[0]) * Math.PI) / 180
  const lat1 = (Number(a[1]) * Math.PI) / 180
  const lon2 = (Number(b[0]) * Math.PI) / 180
  const lat2 = (Number(b[1]) * Math.PI) / 180
  if (![lon1, lat1, lon2, lat2].every(Number.isFinite)) {
    return Number.POSITIVE_INFINITY
  }

  const dLat = lat2 - lat1
  const dLon = lon2 - lon1
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function scoreCandidate(candidate, preferredCenter) {
  const baseScore = Number(candidate?.score) || 0
  if (!preferredCenter) {
    return baseScore
  }

  const x = Number(candidate?.location?.x)
  const y = Number(candidate?.location?.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return baseScore
  }

  const distanceMeters = haversineDistanceMeters(preferredCenter, [x, y])
  if (!Number.isFinite(distanceMeters)) {
    return baseScore
  }

  const distancePenalty = Math.min(20, distanceMeters / 1500)
  return baseScore - distancePenalty
}

export async function geocodeLocation(query, options = {}) {
  const preferredCenter = Array.isArray(options.preferredCenter) && options.preferredCenter.length >= 2
    ? [Number(options.preferredCenter[0]), Number(options.preferredCenter[1])]
    : null

  const queryParams = new URLSearchParams({
    f: 'json',
    singleLine: query,
    outFields: '*',
    maxLocations: '8',
  })
  if (preferredCenter && preferredCenter.every(Number.isFinite)) {
    queryParams.set('location', `${preferredCenter[0]},${preferredCenter[1]}`)
    queryParams.set('distance', '50000')
  }

  const url = `${GEOCODER_URL}?${queryParams.toString()}`

  const data = await fetchJsonWithTimeout(url, {
    signal: options.signal,
    timeoutMs: GEOCODE_TIMEOUT_MS,
    errorMessage: 'Geocoding failed',
  })
  if (!data.candidates || data.candidates.length === 0) {
    throw new Error('Location not found')
  }

  const candidate = [...data.candidates]
    .sort((a, b) => scoreCandidate(b, preferredCenter) - scoreCandidate(a, preferredCenter))[0]

  return {
    location: candidate.location,
    address: candidate.address,
    extent: candidate.extent,
    countryCode: candidate.attributes?.Country,
  }
}

function getRegionSearchOrder(countryCode) {
  const preferred = REGION_BY_COUNTRY[countryCode] ?? 'NA'
  if (preferred === 'NA') return ['NA', 'CA', 'SA']
  if (preferred === 'CA') return ['CA', 'NA', 'SA']
  return ['SA', 'CA', 'NA']
}

function getServiceUrl(region, suffix) {
  return `${OSM_ARCGIS_SERVICE_ROOT}/OSM_${region}_${suffix}/FeatureServer/0/query`
}

function parseNumericOrNull(value) {
  if (value == null) {
    return null
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(/[^0-9.-]/g, ''))
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function estimateHeightMeters(attributes = {}) {
  const directHeight = parseNumericOrNull(attributes.height)
  if (directHeight && directHeight > 2) {
    return directHeight
  }

  const levels = parseNumericOrNull(attributes.building_levels)
  if (levels && levels > 0) {
    return Math.max(levels * 3.2, 6)
  }

  return 10
}

function appendUniqueFeatures(target, features, seenObjectIds) {
  for (const feature of features) {
    const objectId = Number(feature?.attributes?.OBJECTID)
    if (Number.isFinite(objectId)) {
      if (seenObjectIds.has(objectId)) {
        continue
      }
      seenObjectIds.add(objectId)
    }
    target.push(feature)
  }
}

async function paginateRegionalFeatures({
  region,
  bounds,
  serviceSuffix,
  where,
  outFields,
  limit,
  orderByFields,
  geometryDetailParams,
  signal,
  initialFeatures,
  initialExceededTransferLimit,
}) {
  if (!initialExceededTransferLimit) {
    return initialFeatures
  }

  const allFeatures = []
  const seenObjectIds = new Set()
  appendUniqueFeatures(allFeatures, initialFeatures, seenObjectIds)

  let offset = initialFeatures.length
  let exceededTransferLimit = initialExceededTransferLimit

  while (exceededTransferLimit && !signal?.aborted) {
    const pageController = new AbortController()
    const detachParentAbort = linkAbortSignal(signal, pageController)

    try {
      const pageParams = new URLSearchParams({
        f: 'json',
        where,
        outFields,
        returnGeometry: 'true',
        geometry: JSON.stringify({ ...bounds, spatialReference: { wkid: 4326 } }),
        geometryType: 'esriGeometryEnvelope',
        spatialRel: 'esriSpatialRelIntersects',
        inSR: '4326',
        outSR: '4326',
        resultRecordCount: String(limit),
        resultOffset: String(offset),
        ...(orderByFields ? { orderByFields } : {}),
        ...geometryDetailParams,
      })

      const page = await fetchJsonWithTimeout(
        `${getServiceUrl(region, serviceSuffix)}?${pageParams.toString()}`,
        {
          signal: pageController.signal,
          timeoutMs: FEATURE_QUERY_TIMEOUT_MS,
          errorMessage: `${serviceSuffix} query failed`,
        },
      )

      const pageFeatures = Array.isArray(page?.features) ? page.features : []
      if (!pageFeatures.length) {
        break
      }

      appendUniqueFeatures(allFeatures, pageFeatures, seenObjectIds)
      offset += pageFeatures.length
      exceededTransferLimit = Boolean(page?.exceededTransferLimit)
    } catch {
      break
    } finally {
      detachParentAbort()
    }
  }

  return allFeatures
}

async function queryRegionalFeatures({
  center,
  radiusMeters,
  countryCode,
  serviceSuffix,
  where,
  outFields = '*',
  limit = 2000,
  signal,
  paginate = false,
  orderByFields,
}) {
  const bounds = getBoundsFromCenter(center, radiusMeters)
  const regions = getRegionSearchOrder(countryCode)
  const geometryDetailParams = getGeometryDetailParams(serviceSuffix, radiusMeters)

  const requests = regions.map((region, index) => {
    const requestController = new AbortController()
    const detachParentAbort = linkAbortSignal(signal, requestController)

    const queryParams = new URLSearchParams({
      f: 'json',
      where,
      outFields,
      returnGeometry: 'true',
      geometry: JSON.stringify({ ...bounds, spatialReference: { wkid: 4326 } }),
      geometryType: 'esriGeometryEnvelope',
      spatialRel: 'esriSpatialRelIntersects',
      inSR: '4326',
      outSR: '4326',
      resultRecordCount: String(limit),
      ...(paginate && orderByFields ? { orderByFields } : {}),
      ...geometryDetailParams,
    })

    const promise = fetchJsonWithTimeout(`${getServiceUrl(region, serviceSuffix)}?${queryParams.toString()}`, {
      signal: requestController.signal,
      timeoutMs: FEATURE_QUERY_TIMEOUT_MS,
      errorMessage: `${serviceSuffix} query failed`,
    })
      .then((data) => ({
        index,
        region,
        features: Array.isArray(data?.features) ? data.features : [],
        exceededTransferLimit: Boolean(data?.exceededTransferLimit),
      }))
      .catch(() => ({
        index,
        region,
        features: [],
        exceededTransferLimit: false,
      }))
      .finally(() => {
        detachParentAbort()
      })

    return {
      index,
      controller: requestController,
      promise,
    }
  })

  try {
    const winner = await Promise.any(
      requests.map(({ promise }) => promise.then((result) => {
        if (result.features.length > 0) {
          return result
        }
        throw new Error('empty')
      })),
    )

    requests.forEach(({ index, controller }) => {
      if (index !== winner.index) {
        controller.abort()
      }
    })

    if (!paginate || !winner.region) {
      return winner.features
    }

    return paginateRegionalFeatures({
      region: winner.region,
      bounds,
      serviceSuffix,
      where,
      outFields,
      limit,
      orderByFields,
      geometryDetailParams,
      signal,
      initialFeatures: winner.features,
      initialExceededTransferLimit: winner.exceededTransferLimit,
    })
  } catch {
    const settled = await Promise.all(requests.map(({ promise }) => promise))
    const firstNonEmpty = settled.find((result) => result.features.length > 0)
    if (!firstNonEmpty) {
      return []
    }

    if (!paginate || !firstNonEmpty.region) {
      return firstNonEmpty.features
    }

    return paginateRegionalFeatures({
      region: firstNonEmpty.region,
      bounds,
      serviceSuffix,
      where,
      outFields,
      limit,
      orderByFields,
      geometryDetailParams,
      signal,
      initialFeatures: firstNonEmpty.features,
      initialExceededTransferLimit: firstNonEmpty.exceededTransferLimit,
    })
  }
}

export async function fetchBuildings(center, countryCode, radiusMeters = 1200, options = {}) {
  const rows = await queryRegionalFeatures({
    center,
    radiusMeters,
    countryCode,
    serviceSuffix: 'Buildings',
    where: "building IS NOT NULL AND building <> ''",
    outFields: 'OBJECTID,osm_id,name,building,height,building_levels,Shape__Area',
    limit: MAX_BUILDINGS,
    signal: options.signal,
  })

  return rows.map((feature) => {
    const attrs = feature.attributes || {}
    const geom = feature.geometry || {}

    return {
      entityType: 'building',
      id: `bldg_${attrs.OBJECTID || attrs.osm_id || crypto.randomUUID()}`,
      geometry: {
        type: 'polygon',
        rings: geom.rings || [],
      },
      attributes: {
        name: attrs.name || attrs.addr_full || 'Building',
        height: estimateHeightMeters(attrs),
        floors: Math.max(1, Math.round(estimateHeightMeters(attrs) / 3.2)),
        type: attrs.building || 'building',
      },
      center: computePolygonCenter(geom.rings?.[0] || []),
    }
  })
}

export async function fetchRoads(center, countryCode, radiusMeters = 1200, options = {}) {
  let rows = await queryRegionalFeatures({
    center,
    radiusMeters,
    countryCode,
    serviceSuffix: 'Highways',
    where: "highway IN ('motorway','trunk','primary','secondary','tertiary','residential','service')",
    outFields: 'OBJECTID,name,highway,lanes,width,maxspeed',
    limit: ROADS_PAGE_SIZE,
    signal: options.signal,
    paginate: true,
    orderByFields: 'OBJECTID ASC',
  })

  if (!rows.length) {
    try {
      const fallbackRows = await fetchFallbackRoads({
        center,
        radiusMeters,
        signal: options.signal,
      })
      if (fallbackRows.length) {
        rows = fallbackRows.map((feature) => ({
          attributes: feature.attributes || {},
          geometry: feature.geometry || {},
          __fallbackId: feature.id,
        }))
      }
    } catch {
    }
  }

  return rows.map((feature) => {
    const attrs = feature.attributes || {}
    const geom = feature.geometry || {}
    const lanes = parseNumericOrNull(attrs.lanes)
    const width = parseNumericOrNull(attrs.width)
    const maxspeed = parseNumericOrNull(attrs.maxspeed)

    return {
      entityType: 'road',
      id: feature.__fallbackId || `road_${attrs.OBJECTID || crypto.randomUUID()}`,
      geometry: {
        type: 'polyline',
        paths: geom.paths || [],
      },
      attributes: {
        name: attrs.name || 'Road',
        type: attrs.highway || 'road',
        width: width ?? (lanes ? Math.max(4, lanes * 3.2) : 6),
        lanes: lanes ?? 1,
        maxspeed: maxspeed,
        oneway: attrs.oneway || 'no',
      },
    }
  })
}

export async function fetchParks(center, countryCode, radiusMeters = 1200, options = {}) {
  const [landuseRows, leisureRows] = await Promise.all([
    queryRegionalFeatures({
      center,
      radiusMeters,
      countryCode,
      serviceSuffix: 'Landuse',
      where: "landuse IN ('park','grass','forest','recreation_ground','village_green','cemetery')",
      outFields: 'OBJECTID,name,landuse,nat',
      limit: MAX_PARKS,
      signal: options.signal,
    }),
    queryRegionalFeatures({
      center,
      radiusMeters,
      countryCode,
      serviceSuffix: 'Leisure',
      where: "leisure IN ('park','garden','playground','recreation_ground','nature_reserve')",
      outFields: 'OBJECTID,name,leisure,landuse',
      limit: MAX_PARKS,
      signal: options.signal,
    }),
  ])

  const rows = [...landuseRows, ...leisureRows]

  return rows.map((feature) => {
    const attrs = feature.attributes || {}
    const geom = feature.geometry || {}

    return {
      entityType: 'park',
      id: `park_${attrs.OBJECTID || crypto.randomUUID()}`,
      geometry: {
        type: 'polygon',
        rings: geom.rings || [],
      },
      attributes: {
        name: attrs.name || 'Park',
        type: attrs.leisure || attrs.landuse || attrs.nat || 'park',
      },
    }
  })
}

export async function fetchRivers(center, countryCode, radiusMeters = 1200, options = {}) {
  const rows = await queryRegionalFeatures({
    center,
    radiusMeters,
    countryCode,
    serviceSuffix: 'Waterways',
    where: "waterway IN ('river','stream','canal','drain','ditch')",
    outFields: 'OBJECTID,name,waterway,width',
    limit: MAX_RIVERS,
    signal: options.signal,
  })

  return rows.map((feature) => {
    const attrs = feature.attributes || {}
    const geom = feature.geometry || {}

    return {
      entityType: 'river',
      id: `river_${attrs.OBJECTID || attrs.osm_id2 || crypto.randomUUID()}`,
      geometry: {
        type: 'polyline',
        paths: geom.paths || [],
      },
      attributes: {
        name: attrs.name || 'Waterway',
        type: attrs.waterway || 'river',
        width: parseNumericOrNull(attrs.width) ?? 8,
      },
    }
  })
}

function computePolygonCenter(ring) {
  if (!ring || ring.length === 0) {
    return [0, 0]
  }

  let sumX = 0
  let sumY = 0

  for (const point of ring) {
    sumX += point[0]
    sumY += point[1]
  }

  return [sumX / ring.length, sumY / ring.length]
}

export async function fetchCityData(locationQuery, options = {}) {
  const searchStartedAt = performance.now()
  const radiusMeters = normalizeRadiusMeters(options.radiusMeters)
  const includeRoads = options.includeRoads !== false
  const includeRivers = options.includeRivers !== false
  const includeBuildings = options.includeBuildings !== false
  const includeParks = options.includeParks !== false
  const geocodeStartedAt = performance.now()
  const geocodeResult = await geocodeLocation(locationQuery, {
    preferredCenter: options.preferredCenter,
    signal: options.signal,
  })
  const geocodeMs = performance.now() - geocodeStartedAt
  const center = [geocodeResult.location.x, geocodeResult.location.y]
  const countryCode = geocodeResult.countryCode

  const roadsPromise = includeRoads
    ? fetchRoads(center, countryCode, radiusMeters, { signal: options.signal })
    : Promise.resolve([])
  const riversPromise = includeRivers
    ? fetchRivers(center, countryCode, radiusMeters, { signal: options.signal })
    : Promise.resolve([])
  const buildingsPromise = includeBuildings
    ? fetchBuildings(center, countryCode, radiusMeters, { signal: options.signal })
    : Promise.resolve([])
  const parksPromise = includeParks
    ? fetchParks(center, countryCode, radiusMeters, { signal: options.signal })
    : Promise.resolve([])

  const [roadsFast, riversFast] = await Promise.allSettled([roadsPromise, riversPromise])
  const fastFeatures = [
    ...(roadsFast.status === 'fulfilled' ? roadsFast.value : []),
    ...(riversFast.status === 'fulfilled' ? riversFast.value : []),
  ]
  const firstRenderableMs = performance.now() - searchStartedAt

  try {
    if (fastFeatures.length > 0) {
      options.onPartialResult?.({
        location: geocodeResult.address,
        center,
        extent: geocodeResult.extent,
        radiusMeters,
        features: fastFeatures,
      })
    }
  } catch {
  }

  const [roads, rivers, buildings, parks] = await Promise.allSettled([
    roadsPromise,
    riversPromise,
    buildingsPromise,
    parksPromise,
  ])

  const features = [
    ...(roads.status === 'fulfilled' ? roads.value : []),
    ...(rivers.status === 'fulfilled' ? rivers.value : []),
    ...(buildings.status === 'fulfilled' ? buildings.value : []),
    ...(parks.status === 'fulfilled' ? parks.value : []),
  ]

  const timings = {
    geocodeMs: Math.round(geocodeMs * 10) / 10,
    firstRenderableMs: Math.round(firstRenderableMs * 10) / 10,
    fullDataMs: Math.round((performance.now() - searchStartedAt) * 10) / 10,
  }

  return {
    location: geocodeResult.address,
    center,
    extent: geocodeResult.extent,
    countryCode,
    radiusMeters,
    features,
    timings,
  }
}
