const WGS84_A = 6378137.0
const WGS84_F = 1 / 298.257223563
const WGS84_E2 = 2 * WGS84_F - WGS84_F * WGS84_F

export function lonLatToECEF(lon, lat, alt = 0) {
  const lonRad = (lon * Math.PI) / 180
  const latRad = (lat * Math.PI) / 180
  const sinLat = Math.sin(latRad)
  const cosLat = Math.cos(latRad)
  const sinLon = Math.sin(lonRad)
  const cosLon = Math.cos(lonRad)
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat)
  return [
    (N + alt) * cosLat * cosLon,
    (N + alt) * cosLat * sinLon,
    (N * (1 - WGS84_E2) + alt) * sinLat,
  ]
}

export function ecefToLonLatAlt([x, y, z]) {
  const b = WGS84_A * (1 - WGS84_F)
  const ep = Math.sqrt((WGS84_A * WGS84_A - b * b) / (b * b))
  const p = Math.hypot(x, y)
  const th = Math.atan2(WGS84_A * z, b * p)
  const lon = Math.atan2(y, x)
  const lat = Math.atan2(
    z + ep * ep * b * Math.sin(th) ** 3,
    p - WGS84_E2 * WGS84_A * Math.cos(th) ** 3,
  )
  const sinLat = Math.sin(lat)
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat)
  const alt = p / Math.cos(lat) - N
  return [lon * 180 / Math.PI, lat * 180 / Math.PI, alt]
}

export function buildEnuFrame(originLon, originLat, originAlt = 0) {
  const lonRad = (originLon * Math.PI) / 180
  const latRad = (originLat * Math.PI) / 180
  const sinLon = Math.sin(lonRad)
  const cosLon = Math.cos(lonRad)
  const sinLat = Math.sin(latRad)
  const cosLat = Math.cos(latRad)

  return {
    originLon,
    originLat,
    originAlt,
    originEcef: lonLatToECEF(originLon, originLat, originAlt),
    east: [-sinLon, cosLon, 0],
    north: [-sinLat * cosLon, -sinLat * sinLon, cosLat],
    up: [cosLat * cosLon, cosLat * sinLon, sinLat],
  }
}

export function ecefToEnu([x, y, z], frame) {
  const dx = x - frame.originEcef[0]
  const dy = y - frame.originEcef[1]
  const dz = z - frame.originEcef[2]
  return [
    dx * frame.east[0] + dy * frame.east[1] + dz * frame.east[2],
    dx * frame.north[0] + dy * frame.north[1] + dz * frame.north[2],
    dx * frame.up[0] + dy * frame.up[1] + dz * frame.up[2],
  ]
}

export function vectorEcefToEnu([x, y, z], frame) {
  return [
    x * frame.east[0] + y * frame.east[1] + z * frame.east[2],
    x * frame.north[0] + y * frame.north[1] + z * frame.north[2],
    x * frame.up[0] + y * frame.up[1] + z * frame.up[2],
  ]
}

export function enuToEcef([east, north, up], frame) {
  return [
    frame.originEcef[0] + east * frame.east[0] + north * frame.north[0] + up * frame.up[0],
    frame.originEcef[1] + east * frame.east[1] + north * frame.north[1] + up * frame.up[1],
    frame.originEcef[2] + east * frame.east[2] + north * frame.north[2] + up * frame.up[2],
  ]
}

export function enuToLonLatAlt(enu, frame) {
  return ecefToLonLatAlt(enuToEcef(enu, frame))
}

export function computeMoveDelta(fromEnu, toEnu) {
  return [toEnu[0] - fromEnu[0], toEnu[1] - fromEnu[1], toEnu[2] - fromEnu[2]]
}

function majorityKey(a, b, c) {
  if (a === b || a === c) return a
  if (b === c) return b
  return a
}

export function makeBuildingKey(tileId, featureId, componentIndex) {
  return `${tileId}::${featureId}::${componentIndex}`
}

export function parseBuildingKey(key) {
  const [tileId = '', featureIdRaw = '0', componentRaw = '0'] = String(key).split('::')
  return {
    tileId,
    featureId: Number(featureIdRaw),
    componentIndex: Number(componentRaw),
  }
}

function createUnionFind(size) {
  const parent = new Int32Array(size)
  const rank = new Int8Array(size)
  for (let i = 0; i < size; i++) {
    parent[i] = i
  }

  const find = (x) => {
    let root = x
    while (parent[root] !== root) {
      root = parent[root]
    }
    while (parent[x] !== x) {
      const p = parent[x]
      parent[x] = root
      x = p
    }
    return root
  }

  const union = (a, b) => {
    const ra = find(a)
    const rb = find(b)
    if (ra === rb) return
    if (rank[ra] < rank[rb]) {
      parent[ra] = rb
    } else if (rank[ra] > rank[rb]) {
      parent[rb] = ra
    } else {
      parent[rb] = ra
      rank[ra]++
    }
  }

  return { find, union }
}

export function buildTileFeatureIndex(tileId, indices, featureIds, vertexCount) {
  const fidArray = featureIds && featureIds.length >= vertexCount
    ? featureIds
    : new Int32Array(vertexCount).fill(-1)

  const unionFind = createUnionFind(vertexCount)
  if (indices && indices.length >= 3) {
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i]
      const b = indices[i + 1]
      const c = indices[i + 2]
      const fa = Number(fidArray[a])
      const fb = Number(fidArray[b])
      const fc = Number(fidArray[c])
      if (fa === fb) unionFind.union(a, b)
      if (fb === fc) unionFind.union(b, c)
      if (fa === fc) unionFind.union(a, c)
    }
  }

  const vertexToBuildingKey = new Array(vertexCount)
  const fidRootToComponent = new Map()
  const buildingToVerticesMutable = new Map()

  for (let i = 0; i < vertexCount; i++) {
    const fid = Number(fidArray[i])
    const root = unionFind.find(i)
    const fidKey = Number.isFinite(fid) ? fid : -1
    let rootMap = fidRootToComponent.get(fidKey)
    if (!rootMap) {
      rootMap = new Map()
      fidRootToComponent.set(fidKey, rootMap)
    }
    let componentIndex = rootMap.get(root)
    if (componentIndex === undefined) {
      componentIndex = rootMap.size
      rootMap.set(root, componentIndex)
    }

    const buildingKey = makeBuildingKey(tileId, fidKey, componentIndex)
    vertexToBuildingKey[i] = buildingKey

    let vertices = buildingToVerticesMutable.get(buildingKey)
    if (!vertices) {
      vertices = []
      buildingToVerticesMutable.set(buildingKey, vertices)
    }
    vertices.push(i)
  }

  const buildingToTrianglesMutable = new Map()
  if (indices && indices.length >= 3) {
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i]
      const b = indices[i + 1]
      const c = indices[i + 2]
      const key = majorityKey(vertexToBuildingKey[a], vertexToBuildingKey[b], vertexToBuildingKey[c])
      let triangles = buildingToTrianglesMutable.get(key)
      if (!triangles) {
        triangles = []
        buildingToTrianglesMutable.set(key, triangles)
      }
      triangles.push(a, b, c)
    }
  }

  const buildingToVertices = new Map()
  for (const [key, value] of buildingToVerticesMutable.entries()) {
    buildingToVertices.set(key, new Uint32Array(value))
  }

  const buildingToTriangles = new Map()
  for (const [key, value] of buildingToTrianglesMutable.entries()) {
    buildingToTriangles.set(key, new Uint32Array(value))
  }

  return {
    vertexToBuildingKey,
    buildingToVertices,
    buildingToTriangles,
  }
}

export function applyModsToTileGeometry(tileRecord, buildingMods) {
  const { basePositions, positions, buildingToVertices, tileId } = tileRecord
  positions.set(basePositions)

  if (!buildingMods?.size) {
    return
  }

  for (const [buildingKey, mod] of buildingMods.entries()) {
    const { tileId: keyTileId } = parseBuildingKey(buildingKey)
    if (keyTileId !== tileId) {
      continue
    }

    const vertices = buildingToVertices.get(buildingKey)
    if (!vertices || !vertices.length) {
      continue
    }

    if (mod?.action === 'move' && Array.isArray(mod.delta) && mod.delta.length === 3) {
      const [dx, dy, dz] = mod.delta
      for (let i = 0; i < vertices.length; i++) {
        const offset = vertices[i] * 3
        positions[offset] += dx
        positions[offset + 1] += dy
        positions[offset + 2] += dz
      }
      continue
    }

    if (mod?.action === 'delete') {
      let cx = 0
      let cy = 0
      let cz = 0
      for (let i = 0; i < vertices.length; i++) {
        const offset = vertices[i] * 3
        cx += positions[offset]
        cy += positions[offset + 1]
        cz += positions[offset + 2]
      }
      const inv = 1 / vertices.length
      cx *= inv
      cy *= inv
      cz *= inv
      for (let i = 0; i < vertices.length; i++) {
        const offset = vertices[i] * 3
        positions[offset] = cx
        positions[offset + 1] = cy
        positions[offset + 2] = cz
      }
    }
  }
}
