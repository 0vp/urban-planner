export function deleteFeatureFromTile(tile, featureId) {
  const content = tile.content
  if (!content || !content.featureIds || !content.attributes?.positions) {
    return false
  }

  const featureIds = content.featureIds
  const posValues = content.attributes.positions.value
  const stride = content.attributes.positions.size || 3

  const collapseX = posValues[0]
  const collapseY = posValues[1]
  const collapseZ = posValues[2]

  let modified = false
  for (let i = 0; i < featureIds.length; i++) {
    if (Number(featureIds[i]) === Number(featureId)) {
      posValues[i * stride] = collapseX
      posValues[i * stride + 1] = collapseY
      posValues[i * stride + 2] = collapseZ
      modified = true
    }
  }
  return modified
}

export function moveFeatureInTile(tile, featureId, delta) {
  const content = tile.content
  if (!content || !content.featureIds || !content.attributes?.positions) {
    return false
  }

  const featureIds = content.featureIds
  const posValues = content.attributes.positions.value
  const stride = content.attributes.positions.size || 3

  let modified = false
  for (let i = 0; i < featureIds.length; i++) {
    if (Number(featureIds[i]) === Number(featureId)) {
      posValues[i * stride] += delta[0]
      posValues[i * stride + 1] += delta[1]
      posValues[i * stride + 2] += delta[2]
      modified = true
    }
  }
  return modified
}

export function tileContainsFeatures(tile, featureIdSet) {
  const content = tile.content
  if (!content || !content.featureIds) {
    return []
  }

  const found = new Set()
  const featureIds = content.featureIds
  for (let i = 0; i < featureIds.length; i++) {
    const fid = Number(featureIds[i])
    if (featureIdSet.has(fid)) {
      found.add(fid)
    }
  }
  return [...found]
}

export function applyModificationsToTile(tile, buildingMods) {
  if (!buildingMods.size) return

  const featureIdSet = new Set(buildingMods.keys())
  const matches = tileContainsFeatures(tile, featureIdSet)

  for (const featureId of matches) {
    const mod = buildingMods.get(featureId)
    if (!mod) continue

    if (mod.action === 'delete') {
      deleteFeatureFromTile(tile, featureId)
    } else if (mod.action === 'move' && mod.delta) {
      moveFeatureInTile(tile, featureId, mod.delta)
    }
  }
}

export function lonLatToECEF(lon, lat, alt = 0) {
  const a = 6378137.0
  const f = 1 / 298.257223563
  const e2 = 2 * f - f * f
  const lonRad = (lon * Math.PI) / 180
  const latRad = (lat * Math.PI) / 180
  const sinLat = Math.sin(latRad)
  const cosLat = Math.cos(latRad)
  const sinLon = Math.sin(lonRad)
  const cosLon = Math.cos(lonRad)
  const N = a / Math.sqrt(1 - e2 * sinLat * sinLat)
  return [
    (N + alt) * cosLat * cosLon,
    (N + alt) * cosLat * sinLon,
    (N * (1 - e2) + alt) * sinLat,
  ]
}

export function pickingIndexToFeatureId(tile, pickingIndex) {
  const content = tile?.content
  if (!content?.featureIds) return pickingIndex

  const fids = content.featureIds
  for (let i = 0; i < fids.length; i++) {
    const fid = Number(fids[i])
    const truncated = ((fid + 1) & 0xFFFFFF) - 1
    if (truncated === pickingIndex) return fid
  }
  return pickingIndex
}

export function computeMoveDelta(fromLon, fromLat, toLon, toLat) {
  const from = lonLatToECEF(fromLon, fromLat)
  const to = lonLatToECEF(toLon, toLat)
  return [to[0] - from[0], to[1] - from[1], to[2] - from[2]]
}
