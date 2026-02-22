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
const MAX_ROADS = 1800
const MAX_RIVERS = 600
const MAX_PARKS = 800
const DEFAULT_CITY_RADIUS_METERS = 1200
const MIN_CITY_RADIUS_METERS = 300
const MAX_CITY_RADIUS_METERS = 10000

function normalizeRadiusMeters(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return DEFAULT_CITY_RADIUS_METERS
  }
  return Math.round(Math.min(MAX_CITY_RADIUS_METERS, Math.max(MIN_CITY_RADIUS_METERS, parsed)))
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

export async function geocodeLocation(query) {
  const url = `${GEOCODER_URL}?f=json&singleLine=${encodeURIComponent(query)}&outFields=*&maxLocations=1`

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error('Geocoding failed')
  }

  const data = await response.json()
  if (!data.candidates || data.candidates.length === 0) {
    throw new Error('Location not found')
  }

  const candidate = data.candidates[0]
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

async function queryRegionalFeatures({
  center,
  radiusMeters,
  countryCode,
  serviceSuffix,
  where,
  outFields = '*',
  limit = 2000,
}) {
  const bounds = getBoundsFromCenter(center, radiusMeters)
  const regions = getRegionSearchOrder(countryCode)

  for (const region of regions) {
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
    })

    try {
      const response = await fetch(`${getServiceUrl(region, serviceSuffix)}?${queryParams.toString()}`)
      if (!response.ok) {
        continue
      }

      const data = await response.json()
      const features = Array.isArray(data.features) ? data.features : []
      if (features.length > 0) {
        return features
      }
    } catch {
      continue
    }
  }

  return []
}

export async function fetchBuildings(center, countryCode, radiusMeters = 1200) {
  const rows = await queryRegionalFeatures({
    center,
    radiusMeters,
    countryCode,
    serviceSuffix: 'Buildings',
    where: "building IS NOT NULL AND building <> ''",
    outFields: 'OBJECTID,osm_id,name,building,height,building_levels,Shape__Area',
    limit: MAX_BUILDINGS,
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

export async function fetchRoads(center, countryCode, radiusMeters = 1200) {
  const rows = await queryRegionalFeatures({
    center,
    radiusMeters,
    countryCode,
    serviceSuffix: 'Highways',
    where: "highway IN ('motorway','trunk','primary','secondary','tertiary','residential','service')",
    outFields: 'OBJECTID,name,highway,lanes,width,maxspeed',
    limit: MAX_ROADS,
  })

  return rows.map((feature) => {
    const attrs = feature.attributes || {}
    const geom = feature.geometry || {}
    const lanes = parseNumericOrNull(attrs.lanes)
    const width = parseNumericOrNull(attrs.width)

    return {
      entityType: 'road',
      id: `road_${attrs.OBJECTID || crypto.randomUUID()}`,
      geometry: {
        type: 'polyline',
        paths: geom.paths || [],
      },
      attributes: {
        name: attrs.name || 'Road',
        type: attrs.highway || 'road',
        width: width ?? (lanes ? Math.max(4, lanes * 3.2) : 6),
      },
    }
  })
}

export async function fetchParks(center, countryCode, radiusMeters = 1200) {
  const [landuseRows, leisureRows] = await Promise.all([
    queryRegionalFeatures({
      center,
      radiusMeters,
      countryCode,
      serviceSuffix: 'Landuse',
      where: "landuse IN ('park','grass','forest','recreation_ground','village_green','cemetery')",
      outFields: 'OBJECTID,name,landuse,nat',
      limit: MAX_PARKS,
    }),
    queryRegionalFeatures({
      center,
      radiusMeters,
      countryCode,
      serviceSuffix: 'Leisure',
      where: "leisure IN ('park','garden','playground','recreation_ground','nature_reserve')",
      outFields: 'OBJECTID,name,leisure,landuse',
      limit: MAX_PARKS,
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

export async function fetchRivers(center, countryCode, radiusMeters = 1200) {
  const rows = await queryRegionalFeatures({
    center,
    radiusMeters,
    countryCode,
    serviceSuffix: 'Waterways',
    where: "waterway IN ('river','stream','canal','drain','ditch')",
    outFields: 'OBJECTID,name,waterway,width',
    limit: MAX_RIVERS,
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
  const radiusMeters = normalizeRadiusMeters(options.radiusMeters)
  const geocodeResult = await geocodeLocation(locationQuery)
  const center = [geocodeResult.location.x, geocodeResult.location.y]
  const countryCode = geocodeResult.countryCode

  const [buildings, roads, parks, rivers] = await Promise.allSettled([
    fetchBuildings(center, countryCode, radiusMeters),
    fetchRoads(center, countryCode, radiusMeters),
    fetchParks(center, countryCode, radiusMeters),
    fetchRivers(center, countryCode, radiusMeters),
  ])

  const features = [
    ...(buildings.status === 'fulfilled' ? buildings.value : []),
    ...(roads.status === 'fulfilled' ? roads.value : []),
    ...(parks.status === 'fulfilled' ? parks.value : []),
    ...(rivers.status === 'fulfilled' ? rivers.value : []),
  ]

  return {
    location: geocodeResult.address,
    center,
    extent: geocodeResult.extent,
    radiusMeters,
    features,
  }
}
