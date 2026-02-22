const MIN_BUILDING_SIZE = 4
const MIN_BUILDING_HEIGHT = 6

function flattenGeometryPoints(features) {
  const points = []

  for (const feature of features ?? []) {
    const geometry = feature.geometry ?? {}

    for (const ring of geometry.rings ?? []) {
      for (const point of ring ?? []) {
        if (point?.length >= 2) {
          points.push(point)
        }
      }
    }

    for (const path of geometry.paths ?? []) {
      for (const point of path ?? []) {
        if (point?.length >= 2) {
          points.push(point)
        }
      }
    }
  }

  return points
}

function getOrigin(points) {
  if (!points.length) {
    return [0, 0, 0]
  }

  const total = points.reduce(
    (accumulator, point) => {
      accumulator[0] += point[0]
      accumulator[1] += point[1]
      accumulator[2] += point[2] ?? 0
      return accumulator
    },
    [0, 0, 0],
  )

  return [total[0] / points.length, total[1] / points.length, total[2] / points.length]
}

function normalizePoint(point, origin) {
  return [point[0] - origin[0], point[1] - origin[1], (point[2] ?? 0) - origin[2]]
}

function polygonBounds(rings = []) {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const ring of rings) {
    for (const point of ring ?? []) {
      if (!point || point.length < 2) {
        continue
      }

      minX = Math.min(minX, point[0])
      minY = Math.min(minY, point[1])
      maxX = Math.max(maxX, point[0])
      maxY = Math.max(maxY, point[1])
    }
  }

  if (!Number.isFinite(minX)) {
    return null
  }

  return { minX, minY, maxX, maxY }
}

function pushPathSegments(path, target, origin, z = 0) {
  for (let index = 1; index < path.length; index += 1) {
    const previous = normalizePoint(path[index - 1], origin)
    const current = normalizePoint(path[index], origin)
    target.push(previous[0], previous[1], z)
    target.push(current[0], current[1], z)
  }
}

export function buildThreeBatchData(features = []) {
  const points = flattenGeometryPoints(features)
  const origin = getOrigin(points)

  const buildings = []
  const roads = []
  const rivers = []
  const parks = []

  for (const feature of features) {
    if (feature.entityType === 'building') {
      const bounds = polygonBounds(feature.geometry?.rings)
      if (!bounds) {
        continue
      }

      const center = normalizePoint(
        [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, 0],
        origin,
      )
      const height = Math.max(
        Number(feature.attributes?.height ?? 20),
        MIN_BUILDING_HEIGHT,
      )

      buildings.push({
        position: [center[0], center[1], height / 2],
        scale: [
          Math.max(bounds.maxX - bounds.minX, MIN_BUILDING_SIZE),
          Math.max(bounds.maxY - bounds.minY, MIN_BUILDING_SIZE),
          height,
        ],
      })
      continue
    }

    if (feature.entityType === 'road') {
      for (const path of feature.geometry?.paths ?? []) {
        pushPathSegments(path, roads, origin, 0.2)
      }
      continue
    }

    if (feature.entityType === 'river') {
      for (const path of feature.geometry?.paths ?? []) {
        pushPathSegments(path, rivers, origin, 0.25)
      }
      continue
    }

    if (feature.entityType === 'park') {
      for (const ring of feature.geometry?.rings ?? []) {
        pushPathSegments(ring, parks, origin, 0.15)

        if (ring.length > 2) {
          const last = normalizePoint(ring[ring.length - 1], origin)
          const first = normalizePoint(ring[0], origin)
          parks.push(last[0], last[1], 0.15)
          parks.push(first[0], first[1], 0.15)
        }
      }
    }
  }

  return {
    origin,
    buildings,
    roads,
    rivers,
    parks,
  }
}
