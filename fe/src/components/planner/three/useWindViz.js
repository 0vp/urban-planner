import { useCallback, useRef } from 'react'
import * as THREE from 'three'

const PARTICLE_COUNT = 800
const PARTICLE_LIFE = 3.0

// Scene coordinate system: X=East, Y=North, Z=Up
export function useWindViz({ sceneRef, enuFrameRef }) {
  const groupRef = useRef(null)
  const animFrameRef = useRef(null)
  const particlesRef = useRef(null)
  const gridDataRef = useRef(null)

  const showWind = useCallback((windData) => {
    const scene = sceneRef?.current
    const frame = enuFrameRef?.current
    if (!scene || !frame) return

    clearWind()

    const group = new THREE.Group()
    group.name = 'windOverlay'
    groupRef.current = group

    const grid = Array.isArray(windData?.grid) ? windData.grid : []
    if (grid.length === 0) {
      return { particleCount: 0, tunnelCount: 0 }
    }
    const gridSize = windData.grid_size || 20
    gridDataRef.current = { grid, gridSize, frame }

    const metersPerDegLat = 111320
    const metersPerDegLon = 111320 * Math.cos((frame.originLat * Math.PI) / 180)

    const maxSpeed = Math.max(...grid.map((p) => p.speed), 1)

    const positions = new Float32Array(PARTICLE_COUNT * 3)
    const colors = new Float32Array(PARTICLE_COUNT * 3)
    const lifetimes = new Float32Array(PARTICLE_COUNT)
    const velocities = new Float32Array(PARTICLE_COUNT * 2)

    // Compute bounds in scene space (X=East, Y=North)
    const bounds = {
      minX: Infinity, maxX: -Infinity,
      minY: Infinity, maxY: -Infinity,
    }
    for (const p of grid) {
      const x = (p.lon - frame.originLon) * metersPerDegLon
      const y = (p.lat - frame.originLat) * metersPerDegLat
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        continue
      }
      bounds.minX = Math.min(bounds.minX, x)
      bounds.maxX = Math.max(bounds.maxX, x)
      bounds.minY = Math.min(bounds.minY, y)
      bounds.maxY = Math.max(bounds.maxY, y)
    }

    if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.maxX) || !Number.isFinite(bounds.minY) || !Number.isFinite(bounds.maxY)) {
      return { particleCount: 0, tunnelCount: 0 }
    }

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions[i * 3] = bounds.minX + Math.random() * (bounds.maxX - bounds.minX)     // X = East
      positions[i * 3 + 1] = bounds.minY + Math.random() * (bounds.maxY - bounds.minY) // Y = North
      positions[i * 3 + 2] = 5 + Math.random() * 20                                    // Z = Up
      lifetimes[i] = Math.random() * PARTICLE_LIFE

      const nearestPoint = _findNearest(positions[i * 3], positions[i * 3 + 1], grid, frame, metersPerDegLon, metersPerDegLat)
      const speed = nearestPoint ? nearestPoint.speed : 0
      const t = Math.min(1, speed / maxSpeed)
      colors[i * 3] = t
      colors[i * 3 + 1] = 0.5 * (1 - t)
      colors[i * 3 + 2] = 1 - t

      // dx maps to scene X (East), dy maps to scene Y (North)
      velocities[i * 2] = nearestPoint ? nearestPoint.dx * 2 : 0
      velocities[i * 2 + 1] = nearestPoint ? nearestPoint.dy * 2 : 0
    }

    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const mat = new THREE.PointsMaterial({
      size: 4,
      vertexColors: true,
      transparent: true,
      opacity: 0.7,
      depthTest: false,
      sizeAttenuation: true,
    })
    const points = new THREE.Points(geom, mat)
    points.frustumCulled = false
    points.renderOrder = 950
    group.add(points)
    particlesRef.current = { positions, colors, velocities, lifetimes, geom, bounds, maxSpeed, metersPerDegLon, metersPerDegLat }

    const tunnelZones = windData.tunnel_zones || []
    for (const tz of tunnelZones) {
      const x = (tz.lon - frame.originLon) * metersPerDegLon
      const y = (tz.lat - frame.originLat) * metersPerDegLat
      const ringGeom = new THREE.RingGeometry(8, 12, 16)
      // RingGeometry is on XY by default -- perfect for our ground plane
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xff4444, opacity: 0.3, transparent: true, side: THREE.DoubleSide, depthTest: false })
      const ring = new THREE.Mesh(ringGeom, ringMat)
      ring.position.set(x, y, 2)  // Z=2 slightly above ground
      ring.frustumCulled = false
      ring.renderOrder = 940
      group.add(ring)
    }

    scene.add(group)
    _startAnimation()
    return { particleCount: PARTICLE_COUNT, tunnelCount: tunnelZones.length }
  }, [sceneRef, enuFrameRef])

  const _startAnimation = useCallback(() => {
    const tick = () => {
      const p = particlesRef.current
      const gd = gridDataRef.current
      if (!p || !gd) return

      const { positions, lifetimes, velocities, geom, bounds, metersPerDegLon, metersPerDegLat } = p
      const { grid, frame } = gd
      const dt = 0.016

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        lifetimes[i] -= dt
        if (lifetimes[i] <= 0) {
          positions[i * 3] = bounds.minX + Math.random() * (bounds.maxX - bounds.minX)
          positions[i * 3 + 1] = bounds.minY + Math.random() * (bounds.maxY - bounds.minY)
          positions[i * 3 + 2] = 5 + Math.random() * 20
          lifetimes[i] = PARTICLE_LIFE

          const np = _findNearest(positions[i * 3], positions[i * 3 + 1], grid, frame, metersPerDegLon, metersPerDegLat)
          velocities[i * 2] = np ? np.dx * 2 : 0
          velocities[i * 2 + 1] = np ? np.dy * 2 : 0
        }

        positions[i * 3] += velocities[i * 2] * dt * 50       // X = East
        positions[i * 3 + 1] += velocities[i * 2 + 1] * dt * 50 // Y = North
      }

      geom.attributes.position.needsUpdate = true
      animFrameRef.current = requestAnimationFrame(tick)
    }
    animFrameRef.current = requestAnimationFrame(tick)
  }, [])

  const clearWind = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }
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
    particlesRef.current = null
    gridDataRef.current = null
  }, [sceneRef])

  return { showWind, clearWind }
}

function _findNearest(wx, wy, grid, frame, mpdLon, mpdLat) {
  let best = null
  let bestDist = Infinity
  for (const p of grid) {
    const px = (p.lon - frame.originLon) * mpdLon
    const py = (p.lat - frame.originLat) * mpdLat
    const d = (px - wx) ** 2 + (py - wy) ** 2
    if (d < bestDist) {
      bestDist = d
      best = p
    }
  }
  return best
}
