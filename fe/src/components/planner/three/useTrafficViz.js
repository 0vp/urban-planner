import { useCallback, useRef } from 'react'
import * as THREE from 'three'

const CONGESTION_COLORS = {
  free_flow: new THREE.Color(0x22cc44),
  moderate: new THREE.Color(0xddcc22),
  heavy: new THREE.Color(0xff8800),
  gridlock: new THREE.Color(0xff2222),
}

// Scene coordinate system: X=East, Y=North, Z=Up
export function useTrafficViz({ sceneRef, enuFrameRef }) {
  const groupRef = useRef(null)

  const showTraffic = useCallback((segments) => {
    const scene = sceneRef?.current
    const frame = enuFrameRef?.current
    if (!scene || !frame) return

    clearTraffic()

    if (!Array.isArray(segments) || segments.length === 0) {
      return { segmentCount: 0 }
    }

    const group = new THREE.Group()
    group.name = 'trafficOverlay'
    groupRef.current = group

    const metersPerDegLat = 111320
    const metersPerDegLon = 111320 * Math.cos((frame.originLat * Math.PI) / 180)

    for (const seg of segments) {
      const color = CONGESTION_COLORS[seg.congestion] || CONGESTION_COLORS.free_flow

      // from/to are [lon, lat] -- X=East from lon, Y=North from lat, Z=Up
      const fromX = (seg.from[0] - frame.originLon) * metersPerDegLon
      const fromY = (seg.from[1] - frame.originLat) * metersPerDegLat
      const toX = (seg.to[0] - frame.originLon) * metersPerDegLon
      const toY = (seg.to[1] - frame.originLat) * metersPerDegLat

      const zHeight = 3 + seg.vc_ratio * 8

      const geom = new THREE.BufferGeometry()
      const positions = new Float32Array([
        fromX, fromY, zHeight,
        toX, toY, zHeight,
      ])
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))

      const mat = new THREE.LineBasicMaterial({
        color,
        linewidth: 1,
        opacity: 0.5 + seg.vc_ratio * 0.5,
        transparent: true,
        depthTest: false,
      })

      const line = new THREE.Line(geom, mat)
      line.frustumCulled = false
      line.renderOrder = 900
      group.add(line)

      if (seg.vc_ratio >= 0.8) {
        const midX = (fromX + toX) / 2
        const midY = (fromY + toY) / 2
        const radius = 2 + seg.vc_ratio * 4
        const dotGeom = new THREE.SphereGeometry(radius, 8, 8)
        const dotMat = new THREE.MeshBasicMaterial({ color, opacity: 0.8, transparent: true, depthTest: false })
        const dot = new THREE.Mesh(dotGeom, dotMat)
        dot.position.set(midX, midY, zHeight + 5)
        dot.frustumCulled = false
        dot.renderOrder = 901
        group.add(dot)
      }
    }

    scene.add(group)
    return { segmentCount: segments.length }
  }, [sceneRef, enuFrameRef])

  const clearTraffic = useCallback(() => {
    const scene = sceneRef?.current
    const group = groupRef.current
    if (!scene || !group) return
    group.traverse((child) => {
      if (child.geometry) child.geometry.dispose()
      if (child.material) child.material.dispose()
    })
    scene.remove(group)
    groupRef.current = null
  }, [sceneRef])

  return { showTraffic, clearTraffic }
}
