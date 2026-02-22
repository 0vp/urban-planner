import * as THREE from 'three'
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh'
import {
  COLORS,
  DEFAULT_FETCH_RADIUS_METERS,
  MAX_FETCH_RADIUS_METERS,
  MIN_FETCH_RADIUS_METERS,
} from './constants'

THREE.Mesh.prototype.raycast = acceleratedRaycast
if (!THREE.BufferGeometry.prototype.computeBoundsTree) {
  THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
}
if (!THREE.BufferGeometry.prototype.disposeBoundsTree) {
  THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree
}

export function normalizeColorAttribute(rawColors, vertexCount) {
  if (!rawColors?.value || !rawColors?.size) {
    return null
  }
  const size = rawColors.size
  if (size !== 3 && size !== 4) {
    return null
  }

  const source = rawColors.value
  if (size === 3) {
    if (source instanceof Uint8Array || source instanceof Uint8ClampedArray) {
      return new THREE.BufferAttribute(source, 3, true)
    }
    return new THREE.BufferAttribute(Uint8Array.from(source), 3, true)
  }

  const rgb = new Uint8Array(vertexCount * 3)
  for (let i = 0, j = 0; i < source.length && j < rgb.length; i += 4, j += 3) {
    rgb[j] = source[i]
    rgb[j + 1] = source[i + 1]
    rgb[j + 2] = source[i + 2]
  }
  return new THREE.BufferAttribute(rgb, 3, true)
}

export function getFeaturePaths(feature) {
  const paths = feature?.geometry?.paths
  if (!Array.isArray(paths) || !paths.length) {
    return []
  }
  return paths.filter((path) => Array.isArray(path) && path.length > 1)
}

export function lineColorForFeature(entityType, isSelected) {
  if (entityType === 'river') {
    return isSelected ? COLORS.riverSelected : COLORS.river
  }
  return isSelected ? COLORS.roadSelected : COLORS.road
}

export function buildPolylineRibbonGeometry(points, width, zOffset = 0.6) {
  if (!Array.isArray(points) || points.length < 2) {
    return null
  }

  const halfWidth = Math.max(0.5, width / 2)
  const positions = []
  const indices = []

  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i]
    const p1 = points[i + 1]
    const dx = p1[0] - p0[0]
    const dy = p1[1] - p0[1]
    const length = Math.hypot(dx, dy)
    if (length < 1e-3) {
      continue
    }

    const nx = -dy / length
    const ny = dx / length
    const ox = nx * halfWidth
    const oy = ny * halfWidth

    const z0 = (Number.isFinite(p0[2]) ? p0[2] : 0) + zOffset
    const z1 = (Number.isFinite(p1[2]) ? p1[2] : 0) + zOffset

    const base = positions.length / 3
    positions.push(
      p0[0] + ox, p0[1] + oy, z0,
      p0[0] - ox, p0[1] - oy, z0,
      p1[0] - ox, p1[1] - oy, z1,
      p1[0] + ox, p1[1] + oy, z1,
    )
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  if (!positions.length) {
    return null
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}

export function disposeObject(node) {
  if (node.children?.length) {
    for (const child of [...node.children]) {
      disposeObject(child)
      node.remove(child)
    }
  }
  if (node.geometry) {
    node.geometry.disposeBoundsTree?.()
    node.geometry.dispose()
  }
  if (node.material) {
    if (Array.isArray(node.material)) {
      node.material.forEach((material) => material.dispose())
    } else {
      node.material.dispose()
    }
  }
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function normalizeFetchRadius(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return DEFAULT_FETCH_RADIUS_METERS
  }
  return Math.round(clamp(parsed, MIN_FETCH_RADIUS_METERS, MAX_FETCH_RADIUS_METERS))
}

export function lonToTileX(lon, zoom) {
  return Math.floor(((lon + 180) / 360) * 2 ** zoom)
}

export function latToTileY(lat, zoom) {
  const latRad = (clamp(lat, -85.05112878, 85.05112878) * Math.PI) / 180
  const value = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2
  return Math.floor(value * 2 ** zoom)
}

export function tileXToLon(x, zoom) {
  return (x / 2 ** zoom) * 360 - 180
}

export function tileYToLat(y, zoom) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** zoom
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

export function getTileBounds(x, y, zoom) {
  return {
    west: tileXToLon(x, zoom),
    east: tileXToLon(x + 1, zoom),
    north: tileYToLat(y, zoom),
    south: tileYToLat(y + 1, zoom),
  }
}

export function applyRadiusClipShader(material, radiusUniform, cacheKey) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.plannerRadius = radiusUniform
    shader.vertexShader = `varying vec3 vPlannerPosition;\n${shader.vertexShader}`
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vPlannerPosition = transformed;',
      )
    shader.fragmentShader = `uniform float plannerRadius;\nvarying vec3 vPlannerPosition;\n${shader.fragmentShader}`
      .replace(
        '#include <clipping_planes_fragment>',
        '#include <clipping_planes_fragment>\n  if (dot(vPlannerPosition.xy, vPlannerPosition.xy) > plannerRadius * plannerRadius) discard;',
      )
  }
  material.customProgramCacheKey = () => cacheKey
}
