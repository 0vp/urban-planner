import { useCallback, useRef } from 'react'
import * as THREE from 'three'

const MAX_STREAMLINES = 900
const MAX_TRACE_STEPS = 90
const MIN_STEP_METERS = 6
const MAX_STEP_METERS = 18

export function useWindViz({ sceneRef, enuFrameRef }) {
  const groupRef = useRef(null)

  const clearWind = useCallback(() => {
    const scene = sceneRef?.current
    const group = groupRef.current
    if (scene && group) {
      group.traverse((child) => {
        if (child.geometry) child.geometry.dispose()
        if (child.material) child.material.dispose()
      })
      scene.remove(group)
    }
    groupRef.current = null
  }, [sceneRef])

  const showWind = useCallback((windData) => {
    const scene = sceneRef?.current
    const frame = enuFrameRef?.current
    if (!scene || !frame) return { streamlineCount: 0, tunnelCount: 0 }

    clearWind()

    const grid = Array.isArray(windData?.grid) ? windData.grid : []
    if (grid.length === 0) {
      return { streamlineCount: 0, tunnelCount: 0 }
    }

    const group = new THREE.Group()
    group.name = 'windOverlay'
    groupRef.current = group

    const gridSize = Number(windData.grid_size) || 24
    const metersPerDegLat = 111320
    const metersPerDegLon = 111320 * Math.cos((frame.originLat * Math.PI) / 180)

    const bounds = {
      minX: Infinity,
      maxX: -Infinity,
      minY: Infinity,
      maxY: -Infinity,
    }

    for (const p of grid) {
      const x = (Number(p.lon) - frame.originLon) * metersPerDegLon
      const y = (Number(p.lat) - frame.originLat) * metersPerDegLat
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      bounds.minX = Math.min(bounds.minX, x)
      bounds.maxX = Math.max(bounds.maxX, x)
      bounds.minY = Math.min(bounds.minY, y)
      bounds.maxY = Math.max(bounds.maxY, y)
    }

    if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.maxX) || !Number.isFinite(bounds.minY) || !Number.isFinite(bounds.maxY)) {
      return { streamlineCount: 0, tunnelCount: 0 }
    }

    const centerLon = Array.isArray(windData?.center) ? Number(windData.center[0]) : frame.originLon
    const centerLat = Array.isArray(windData?.center) ? Number(windData.center[1]) : frame.originLat
    const centerX = (centerLon - frame.originLon) * metersPerDegLon
    const centerY = (centerLat - frame.originLat) * metersPerDegLat
    const autoRadius = Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.5
    const radiusMeters = Math.max(100, Number(windData?.radius_meters) || autoRadius)

    const flow = _buildFlowField(grid, gridSize)
    const maxSpeed = Math.max(...grid.map((p) => Number(p.speed) || 0), 1)

    const targetSpacing = Math.max(24, radiusMeters / 14)
    const seeds = _buildCircularSeeds({
      centerX,
      centerY,
      radiusMeters,
      spacing: targetSpacing,
    })

    let streamlineCount = 0
    for (const seed of seeds) {
      if (streamlineCount >= MAX_STREAMLINES) break
      const line = _buildStreamlineBidirectional({
        seed,
        bounds,
        flow,
        gridSize,
        maxSpeed,
        centerX,
        centerY,
        radiusMeters,
      })
      if (!line) continue
      line.frustumCulled = false
      line.renderOrder = 950
      group.add(line)
      streamlineCount += 1
    }

    const tunnelZones = Array.isArray(windData?.tunnel_zones) ? windData.tunnel_zones : []
    for (const tz of tunnelZones) {
      const x = (Number(tz.lon) - frame.originLon) * metersPerDegLon
      const y = (Number(tz.lat) - frame.originLat) * metersPerDegLat
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      const ringGeom = new THREE.RingGeometry(8, 12, 16)
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xff4444,
        opacity: 0.25,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false,
      })
      const ring = new THREE.Mesh(ringGeom, ringMat)
      ring.position.set(x, y, 2)
      ring.frustumCulled = false
      ring.renderOrder = 940
      group.add(ring)
    }

    scene.add(group)
    return { streamlineCount, tunnelCount: tunnelZones.length }
  }, [sceneRef, enuFrameRef, clearWind])

  return { showWind, clearWind }
}

function _buildFlowField(grid, gridSize) {
  const flow = new Array(gridSize * gridSize)
  for (let gy = 0; gy < gridSize; gy += 1) {
    for (let gx = 0; gx < gridSize; gx += 1) {
      const point = grid[gy * gridSize + gx]
      flow[gy * gridSize + gx] = {
        dx: Number(point?.dx) || 0,
        dy: Number(point?.dy) || 0,
        speed: Number(point?.speed) || 0,
        valid: point?.in_domain !== false,
      }
    }
  }
  return flow
}

function _sampleFlowAt(x, y, bounds, flow, gridSize) {
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  if (width <= 1 || height <= 1) return null

  const tx = ((x - bounds.minX) / width) * (gridSize - 1)
  const ty = ((y - bounds.minY) / height) * (gridSize - 1)
  if (tx < 0 || tx > gridSize - 1 || ty < 0 || ty > gridSize - 1) return null

  const x0 = Math.floor(tx)
  const y0 = Math.floor(ty)
  const x1 = Math.min(gridSize - 1, x0 + 1)
  const y1 = Math.min(gridSize - 1, y0 + 1)
  const fx = tx - x0
  const fy = ty - y0

  const p00 = flow[y0 * gridSize + x0]
  const p10 = flow[y0 * gridSize + x1]
  const p01 = flow[y1 * gridSize + x0]
  const p11 = flow[y1 * gridSize + x1]
  const sample = [
    [p00, (1 - fx) * (1 - fy)],
    [p10, fx * (1 - fy)],
    [p01, (1 - fx) * fy],
    [p11, fx * fy],
  ]

  let weight = 0
  let dx = 0
  let dy = 0
  let speed = 0
  for (const [point, w] of sample) {
    if (!point?.valid || point.speed <= 0) continue
    weight += w
    dx += point.dx * w
    dy += point.dy * w
    speed += point.speed * w
  }
  if (weight <= 0.18) return null

  return {
    dx: dx / weight,
    dy: dy / weight,
    speed: speed / weight,
  }
}

function _buildCircularSeeds({ centerX, centerY, radiusMeters, spacing }) {
  const seeds = []
  const rings = Math.max(10, Math.floor(radiusMeters / spacing))
  for (let r = 0; r <= rings; r += 1) {
    const radiusT = r / Math.max(rings, 1)
    const ringRadius = radiusMeters * radiusT
    const count = r === 0 ? 1 : Math.max(10, Math.round((2 * Math.PI * ringRadius) / spacing))
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2
      const jitter = r <= 1 ? 0 : (Math.random() - 0.5) * spacing * 0.3
      const rr = Math.max(0, Math.min(radiusMeters * 0.995, ringRadius + jitter))
      seeds.push({
        x: centerX + Math.cos(angle) * rr,
        y: centerY + Math.sin(angle) * rr,
      })
    }
  }
  return seeds
}

function _insideDomain(x, y, centerX, centerY, radiusMeters) {
  const dx = x - centerX
  const dy = y - centerY
  return dx * dx + dy * dy <= radiusMeters * radiusMeters * 1.01
}

function _traceDirection({
  seed,
  direction,
  bounds,
  flow,
  gridSize,
  maxSpeed,
  centerX,
  centerY,
  radiusMeters,
}) {
  const points = []
  let x = seed.x
  let y = seed.y

  for (let step = 0; step < MAX_TRACE_STEPS; step += 1) {
    if (!_insideDomain(x, y, centerX, centerY, radiusMeters)) break
    const field = _sampleFlowAt(x, y, bounds, flow, gridSize)
    if (!field) break

    const mag = Math.hypot(field.dx, field.dy)
    if (mag < 1e-4 || field.speed < 0.1) break

    const dirX = (field.dx / mag) * direction
    const dirY = (field.dy / mag) * direction
    const speedT = Math.min(1, field.speed / Math.max(maxSpeed, 1))
    const stepMeters = MIN_STEP_METERS + (MAX_STEP_METERS - MIN_STEP_METERS) * speedT
    const z = 2 + speedT * 8

    points.push({ x, y, z, speedT })

    x += dirX * stepMeters
    y += dirY * stepMeters
  }

  return points
}

function _streamlineColor(t) {
  const u = Math.max(0, Math.min(1, t))
  if (u < 0.45) {
    return new THREE.Color(0x1e40af).lerp(new THREE.Color(0x06b6d4), u / 0.45)
  }
  return new THREE.Color(0x06b6d4).lerp(new THREE.Color(0x84cc16), (u - 0.45) / 0.55)
}

function _buildStreamlineBidirectional({
  seed,
  bounds,
  flow,
  gridSize,
  maxSpeed,
  centerX,
  centerY,
  radiusMeters,
}) {
  const backward = _traceDirection({
    seed,
    direction: -1,
    bounds,
    flow,
    gridSize,
    maxSpeed,
    centerX,
    centerY,
    radiusMeters,
  })
  const forward = _traceDirection({
    seed,
    direction: 1,
    bounds,
    flow,
    gridSize,
    maxSpeed,
    centerX,
    centerY,
    radiusMeters,
  })

  if (backward.length + forward.length < 8) return null

  const merged = [...backward.reverse(), ...forward.slice(1)]
  if (merged.length < 6) return null

  const positions = []
  const colors = []
  for (const point of merged) {
    positions.push(point.x, point.y, point.z)
    const c = _streamlineColor(point.speedT)
    colors.push(c.r, c.g, c.b)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3))

  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.66,
    depthTest: false,
  })

  return new THREE.Line(geometry, material)
}
