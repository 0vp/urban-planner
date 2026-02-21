import { createMontrealSeed } from './sampleData'
import { zoneFromTags } from './theme'

const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search'
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

const ROAD_WIDTH_BY_TYPE = {
  motorway: 14,
  trunk: 12,
  primary: 11,
  secondary: 9,
  tertiary: 8,
  residential: 7,
  service: 5,
}

const RIVER_WIDTH_BY_TYPE = {
  river: 18,
  canal: 12,
  stream: 8,
}

function parseNumber(rawValue) {
  if (rawValue === undefined || rawValue === null) {
    return null
  }

  const matched = String(rawValue).match(/[-+]?\d*\.?\d+/)
  if (!matched) {
    return null
  }

  const value = Number(matched[0])
  return Number.isFinite(value) ? value : null
}

function seededHeight(seed) {
  let hash = 0
  const text = String(seed)
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i)
    hash |= 0
  }

  const normalized = Math.abs(hash % 100) / 100
  return 12 + normalized * 44
}

function toLocalMeters(lat, lon, center) {
  const metersPerLat = 111132
  const metersPerLon = 111320 * Math.cos((center.lat * Math.PI) / 180)

  return {
    x: (lon - center.lon) * metersPerLon,
    z: -((lat - center.lat) * metersPerLat),
  }
}

function polygonArea(points) {
  if (!points || points.length < 3) {
    return 0
  }

  let sum = 0
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i]
    const next = points[(i + 1) % points.length]
    sum += current.x * next.z - next.x * current.z
  }

  return Math.abs(sum / 2)
}

function centroid(points) {
  if (!points.length) {
    return { x: 0, z: 0 }
  }

  const totals = points.reduce(
    (accumulator, point) => {
      return {
        x: accumulator.x + point.x,
        z: accumulator.z + point.z,
      }
    },
    { x: 0, z: 0 },
  )

  return {
    x: totals.x / points.length,
    z: totals.z / points.length,
  }
}

function toRelative(points, center) {
  return points.map((point) => ({
    x: point.x - center.x,
    z: point.z - center.z,
  }))
}

function cleanPolygon(points) {
  if (!points || points.length < 4) {
    return null
  }

  const deduped = []
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i]
    const previous = deduped[deduped.length - 1]
    if (!previous || previous.x !== current.x || previous.z !== current.z) {
      deduped.push(current)
    }
  }

  if (deduped.length > 2) {
    const first = deduped[0]
    const last = deduped[deduped.length - 1]
    if (first.x === last.x && first.z === last.z) {
      deduped.pop()
    }
  }

  return deduped.length >= 3 ? deduped : null
}

function simplifyPath(points, stride = 2) {
  if (!points || points.length <= 3) {
    return points
  }

  const simplified = [points[0]]
  for (let i = 1; i < points.length - 1; i += 1) {
    if (i % stride === 0) {
      simplified.push(points[i])
    }
  }
  simplified.push(points[points.length - 1])
  return simplified
}

function buildEntityId(prefix, id) {
  return `${prefix}-${id}`
}

function clampBboxToCenter(bbox, center) {
  const maxLatSpan = 0.05
  const maxLonSpan = 0.08
  const minLatSpan = 0.012
  const minLonSpan = 0.018

  const latSpan = Math.max(minLatSpan, Math.min(maxLatSpan, Math.abs(bbox.north - bbox.south)))
  const lonSpan = Math.max(minLonSpan, Math.min(maxLonSpan, Math.abs(bbox.east - bbox.west)))

  return {
    south: center.lat - latSpan / 2,
    north: center.lat + latSpan / 2,
    west: center.lon - lonSpan / 2,
    east: center.lon + lonSpan / 2,
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 18000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

export async function geocodeLocation(query) {
  const url = `${NOMINATIM_ENDPOINT}?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Geocoding failed with status ${response.status}`)
  }

  const results = await response.json()
  if (!results.length) {
    throw new Error('Location not found')
  }

  const top = results[0]
  const boundingBox = (top.boundingbox ?? []).map(Number)

  return {
    name: top.display_name,
    center: {
      lat: Number(top.lat),
      lon: Number(top.lon),
    },
    bbox: {
      south: boundingBox[0] ?? Number(top.lat) - 0.02,
      north: boundingBox[1] ?? Number(top.lat) + 0.02,
      west: boundingBox[2] ?? Number(top.lon) - 0.03,
      east: boundingBox[3] ?? Number(top.lon) + 0.03,
    },
  }
}

function buildOverpassQuery(bbox) {
  const { south, west, north, east } = bbox

  return `[out:json][timeout:30];
(
  way["building"](${south},${west},${north},${east});
  way["highway"]["highway"!~"footway|cycleway|path|steps|track"](${south},${west},${north},${east});
  way["waterway"~"river|canal|stream"](${south},${west},${north},${east});
  way["leisure"="park"](${south},${west},${north},${east});
);
(._;>;);
out body;
`
}

async function fetchOverpassFeatures(bbox) {
  const query = buildOverpassQuery(bbox)
  let lastError = null

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        body: `data=${encodeURIComponent(query)}`,
      })

      if (!response.ok) {
        throw new Error(`Map data request failed with status ${response.status}`)
      }

      const payload = await response.json()
      return {
        payload,
        endpoint,
      }
    } catch (error) {
      lastError = error
    }
  }

  throw lastError ?? new Error('Map data request failed')
}

function normalizeOverpassElements(elements, center) {
  const nodesById = new Map()
  for (const element of elements) {
    if (element.type === 'node') {
      nodesById.set(element.id, element)
    }
  }

  const entities = []
  let buildingCount = 0
  let roadCount = 0
  let riverCount = 0
  let parkCount = 0

  for (const way of elements) {
    if (way.type !== 'way' || !way.nodes || !way.tags) {
      continue
    }

    const coordinates = way.nodes
      .map((nodeId) => nodesById.get(nodeId))
      .filter(Boolean)
      .map((node) => toLocalMeters(node.lat, node.lon, center))

    if (way.tags.building && buildingCount < 500) {
      const polygon = cleanPolygon(coordinates)
      if (!polygon || polygonArea(polygon) < 28) {
        continue
      }

      const centerPoint = centroid(polygon)
      const relativeFootprint = toRelative(polygon, centerPoint)
      const explicitHeight = parseNumber(way.tags.height)
      const levelsHeight = parseNumber(way.tags['building:levels'])
      const height = explicitHeight ?? (levelsHeight ? levelsHeight * 3 : seededHeight(way.id))

      entities.push({
        id: buildEntityId('building', way.id),
        type: 'building',
        geometry: { footprint: relativeFootprint },
        transform: { position: [centerPoint.x, 0, centerPoint.z], rotation: [0, 0, 0], scale: [1, 1, 1] },
        style: {
          height: Math.max(8, Math.min(80, height)),
          zone: zoneFromTags(way.tags),
        },
        metadata: {
          tags: way.tags,
        },
      })

      buildingCount += 1
      continue
    }

    if (way.tags.highway && roadCount < 220) {
      const path = simplifyPath(coordinates, 3)
      if (!path || path.length < 2) {
        continue
      }

      entities.push({
        id: buildEntityId('road', way.id),
        type: 'road',
        geometry: { path },
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        style: {
          width: ROAD_WIDTH_BY_TYPE[way.tags.highway] ?? 7,
        },
        metadata: {
          tags: way.tags,
        },
      })

      roadCount += 1
      continue
    }

    if (way.tags.waterway && riverCount < 80) {
      const path = simplifyPath(coordinates, 2)
      if (!path || path.length < 2) {
        continue
      }

      entities.push({
        id: buildEntityId('river', way.id),
        type: 'river',
        geometry: { path },
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        style: {
          width: RIVER_WIDTH_BY_TYPE[way.tags.waterway] ?? 10,
        },
        metadata: {
          tags: way.tags,
        },
      })

      riverCount += 1
      continue
    }

    if (way.tags.leisure === 'park' && parkCount < 120) {
      const polygon = cleanPolygon(coordinates)
      if (!polygon || polygonArea(polygon) < 45) {
        continue
      }

      const centerPoint = centroid(polygon)
      const relativeFootprint = toRelative(polygon, centerPoint)

      entities.push({
        id: buildEntityId('park', way.id),
        type: 'park',
        geometry: { footprint: relativeFootprint },
        transform: { position: [centerPoint.x, 0, centerPoint.z], rotation: [0, 0, 0], scale: [1, 1, 1] },
        style: { height: 0.4 },
        metadata: {
          tags: way.tags,
        },
      })

      parkCount += 1
    }
  }

  return entities
}

export async function fetchLocationEntities(query) {
  const geocoded = await geocodeLocation(query)
  const dataBbox = clampBboxToCenter(geocoded.bbox, geocoded.center)
  const overpass = await fetchOverpassFeatures(dataBbox)
  const entities = normalizeOverpassElements(overpass.payload.elements ?? [], geocoded.center)

  return {
    entities,
    isFallback: false,
    locationMeta: {
      query,
      center: geocoded.center,
      bbox: dataBbox,
      source: `osm-overpass:${new URL(overpass.endpoint).host}`,
      label: geocoded.name,
    },
  }
}

export async function safeFetchLocationEntities(query) {
  try {
    const result = await fetchLocationEntities(query)
    if (!result.entities.length) {
      const fallback = createMontrealSeed()
      return {
        ...fallback,
        isFallback: true,
        locationMeta: {
          ...fallback.locationMeta,
          query,
          source: 'fallback-seed',
        },
      }
    }
    return result
  } catch {
    const fallback = createMontrealSeed()
    return {
      ...fallback,
      isFallback: true,
      locationMeta: {
        ...fallback.locationMeta,
        query,
        source: 'fallback-seed',
      },
    }
  }
}
