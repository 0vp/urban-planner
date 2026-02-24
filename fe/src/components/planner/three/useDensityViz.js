import { useCallback, useRef } from 'react'
import * as THREE from 'three'

const GRID_SIZE = 34
const MAX_POINTS = 4500

function toPoint(feature) {
  if (Array.isArray(feature?.center) && feature.center.length >= 2) {
    const lon = Number(feature.center[0])
    const lat = Number(feature.center[1])
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      return [lon, lat]
    }
  }

  const geom = feature?.geometry || {}
  const source = geom.paths || geom.rings
  const ring = Array.isArray(source) && Array.isArray(source[0]) ? source[0] : null
  if (!ring || ring.length === 0) return null

  let sumLon = 0
  let sumLat = 0
  let count = 0
  for (const p of ring) {
    if (!Array.isArray(p) || p.length < 2) continue
    const lon = Number(p[0])
    const lat = Number(p[1])
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
    sumLon += lon
    sumLat += lat
    count += 1
  }
  return count > 0 ? [sumLon / count, sumLat / count] : null
}

function heatColor(t) {
  const clamped = Math.max(0, Math.min(1, t))
  if (clamped < 0.33) {
    const u = clamped / 0.33
    return new THREE.Color(0x1d4ed8).lerp(new THREE.Color(0x22d3ee), u)
  }
  if (clamped < 0.66) {
    const u = (clamped - 0.33) / 0.33
    return new THREE.Color(0x22d3ee).lerp(new THREE.Color(0x86efac), u)
  }
  const u = (clamped - 0.66) / 0.34
  return new THREE.Color(0x86efac).lerp(new THREE.Color(0xef4444), u)
}

export function useDensityViz({ basemapGroupRef, enuFrameRef }) {
  const groupRef = useRef(null)

  const clearDensity = useCallback(() => {
    const group = groupRef.current
    const basemapGroup = basemapGroupRef?.current
    if (!group || !basemapGroup) return
    group.traverse((child) => {
      if (child.geometry) child.geometry.dispose()
      if (child.material) child.material.dispose()
    })
    basemapGroup.remove(group)
    groupRef.current = null
  }, [basemapGroupRef])

  const showDensity = useCallback((payload) => {
    const basemapGroup = basemapGroupRef?.current
    const frame = enuFrameRef?.current
    if (!basemapGroup || !frame) return { cellCount: 0 }

    clearDensity()

    const features = Array.isArray(payload?.features) ? payload.features : []
    const center = Array.isArray(payload?.center) ? payload.center : [frame.originLon, frame.originLat]
    const radiusMeters = Math.max(100, Number(payload?.radiusMeters || 1200))
    if (features.length === 0) {
      return { cellCount: 0 }
    }

    const pointsLonLat = []
    for (const feature of features) {
      if (pointsLonLat.length >= MAX_POINTS) break
      const point = toPoint(feature)
      if (point) pointsLonLat.push(point)
    }
    if (pointsLonLat.length === 0) {
      return { cellCount: 0 }
    }

    const metersPerDegLat = 111320
    const metersPerDegLon = 111320 * Math.cos((frame.originLat * Math.PI) / 180)
    const centerX = (center[0] - frame.originLon) * metersPerDegLon
    const centerY = (center[1] - frame.originLat) * metersPerDegLat
    const minX = centerX - radiusMeters
    const maxX = centerX + radiusMeters
    const minY = centerY - radiusMeters
    const maxY = centerY + radiusMeters

    const points = pointsLonLat.map(([lon, lat]) => [
      (lon - frame.originLon) * metersPerDegLon,
      (lat - frame.originLat) * metersPerDegLat,
    ])

    const sigma = Math.max(80, radiusMeters / 8)
    const sigma2 = sigma * sigma
    const cellSizeX = (maxX - minX) / GRID_SIZE
    const cellSizeY = (maxY - minY) / GRID_SIZE

    const values = []
    let maxValue = 0
    for (let gy = 0; gy < GRID_SIZE; gy += 1) {
      for (let gx = 0; gx < GRID_SIZE; gx += 1) {
        const x = minX + (gx + 0.5) * cellSizeX
        const y = minY + (gy + 0.5) * cellSizeY

        const dxCenter = x - centerX
        const dyCenter = y - centerY
        if (dxCenter * dxCenter + dyCenter * dyCenter > radiusMeters * radiusMeters) {
          values.push(0)
          continue
        }

        let value = 0
        for (const point of points) {
          const dx = point[0] - x
          const dy = point[1] - y
          const d2 = dx * dx + dy * dy
          if (d2 > sigma2 * 9) continue
          value += Math.exp(-d2 / (2 * sigma2))
        }
        values.push(value)
        maxValue = Math.max(maxValue, value)
      }
    }

    if (maxValue <= 1e-6) {
      return { cellCount: 0 }
    }

    const positions = []
    const colors = []
    const indices = []
    let quadCount = 0

    for (let gy = 0; gy < GRID_SIZE; gy += 1) {
      for (let gx = 0; gx < GRID_SIZE; gx += 1) {
        const value = values[gy * GRID_SIZE + gx]
        if (value <= maxValue * 0.08) continue

        const t = Math.pow(value / maxValue, 0.75)
        const color = heatColor(t)
        const cx = minX + (gx + 0.5) * cellSizeX
        const cy = minY + (gy + 0.5) * cellSizeY
        const halfX = cellSizeX * 0.48
        const halfY = cellSizeY * 0.48
        const z = 0.35

        const base = positions.length / 3
        positions.push(
          cx - halfX, cy - halfY, z,
          cx + halfX, cy - halfY, z,
          cx + halfX, cy + halfY, z,
          cx - halfX, cy + halfY, z,
        )
        for (let i = 0; i < 4; i += 1) {
          colors.push(color.r, color.g, color.b)
        }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
        quadCount += 1
      }
    }

    if (quadCount === 0) {
      return { cellCount: 0 }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3))
    geometry.setIndex(indices)

    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    })

    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false
    mesh.renderOrder = 120

    const group = new THREE.Group()
    group.name = 'densityHeatmapOverlay'
    group.add(mesh)

    const ringGeom = new THREE.RingGeometry(Math.max(radiusMeters - 1, 1), radiusMeters, 96)
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x4ade80,
      transparent: true,
      opacity: 0.14,
      depthTest: false,
      side: THREE.DoubleSide,
    })
    const ring = new THREE.Mesh(ringGeom, ringMat)
    ring.position.set(centerX, centerY, 0.22)
    ring.frustumCulled = false
    ring.renderOrder = 119
    group.add(ring)

    basemapGroup.add(group)
    groupRef.current = group

    return { cellCount: quadCount }
  }, [basemapGroupRef, enuFrameRef, clearDensity])

  return { showDensity, clearDensity }
}
