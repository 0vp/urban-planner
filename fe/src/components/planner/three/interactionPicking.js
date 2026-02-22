import { parseBuildingKey } from '../../../lib/planner/i3sGeometryUtils'

export function pickBuildingKeyFromIntersection(intersection, tileRecordsRef) {
  const tileId = intersection?.object?.userData?.tileId
  if (!tileId) {
    return null
  }
  const record = tileRecordsRef.current.get(tileId)
  if (!record) {
    return null
  }

  const face = intersection.face
  if (!face) {
    return null
  }

  const keyA = record.vertexToBuildingKey[face.a]
  const keyB = record.vertexToBuildingKey[face.b]
  const keyC = record.vertexToBuildingKey[face.c]

  const candidates = [...new Set([keyA, keyB, keyC].filter(Boolean))]
  let bestKey = null
  let bestScore = -1
  for (const candidate of candidates) {
    const triangleCount = record.buildingToTriangles?.get(candidate)?.length || 0
    if (!triangleCount) {
      continue
    }
    const parsed = parseBuildingKey(candidate)
    const hasFeatureId = Number.isFinite(parsed.featureId) && parsed.featureId >= 0
    const score = (hasFeatureId ? 1_000_000 : 0) + triangleCount
    if (score > bestScore) {
      bestScore = score
      bestKey = candidate
    }
  }

  if (bestKey) {
    return { key: bestKey, record }
  }

  if (keyA === keyB || keyA === keyC) return { key: keyA, record }
  if (keyB === keyC) return { key: keyB, record }
  return { key: keyA, record }
}

export function pickSelectableBuildingHit(intersections, tileRecordsRef, renderRadiusMetersRef) {
  for (const intersection of intersections) {
    const point = intersection?.point
    if (!point || Math.hypot(point.x, point.y) > renderRadiusMetersRef.current) {
      continue
    }

    const hit = pickBuildingKeyFromIntersection(intersection, tileRecordsRef)
    if (!hit?.key) {
      continue
    }

    const parsed = parseBuildingKey(hit.key)
    const triangles = hit.record?.buildingToTriangles?.get(hit.key)
    if (!triangles?.length) {
      continue
    }

    return { ...hit, parsed }
  }

  return null
}
