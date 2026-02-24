import { useCallback, useEffect, useRef } from 'react'
import * as THREE from 'three'

const LASSO_COLOR = 0xff66aa
const LASSO_FILL_OPACITY = 0.15
const LASSO_LINE_OPACITY = 0.8
const CLOSE_THRESHOLD_PX = 20

export function useLassoTool({
  mountRef,
  rendererRef,
  cameraRef,
  sceneRef,
  enuFrameRef,
  mapViewStateRef,
  lassoActive,
  setLassoActive,
  setLassoPolygon,
}) {
  const lassoGroupRef = useRef(null)
  const pointsRef = useRef([])
  const meshRef = useRef(null)
  const lineRef = useRef(null)

  useEffect(() => {
    const scene = sceneRef?.current
    if (!scene) return
    if (!lassoGroupRef.current) {
      lassoGroupRef.current = new THREE.Group()
      lassoGroupRef.current.name = 'lassoGroup'
      lassoGroupRef.current.renderOrder = 999
      scene.add(lassoGroupRef.current)
    }
    return () => {
      if (lassoGroupRef.current && scene) {
        scene.remove(lassoGroupRef.current)
        lassoGroupRef.current = null
      }
    }
  }, [sceneRef])

  const clearVisuals = useCallback(() => {
    const group = lassoGroupRef.current
    if (!group) return
    while (group.children.length > 0) {
      const child = group.children[0]
      if (child.geometry) child.geometry.dispose()
      if (child.material) child.material.dispose()
      group.remove(child)
    }
    meshRef.current = null
    lineRef.current = null
  }, [])

  // Scene coordinate system: X=East, Y=North, Z=Up
  const updateVisuals = useCallback((points, closed = false) => {
    clearVisuals()
    const group = lassoGroupRef.current
    if (!group || points.length < 2) return

    // Line outline
    const lineGeom = new THREE.BufferGeometry()
    const linePoints = closed ? [...points, points[0]] : points
    const positions = new Float32Array(linePoints.length * 3)
    for (let i = 0; i < linePoints.length; i++) {
      positions[i * 3] = linePoints[i].x     // East
      positions[i * 3 + 1] = linePoints[i].y // North
      positions[i * 3 + 2] = 2               // slightly above ground (Z=up)
    }
    lineGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const lineMat = new THREE.LineBasicMaterial({ color: LASSO_COLOR, opacity: LASSO_LINE_OPACITY, transparent: true, depthTest: false })
    const line = new THREE.Line(lineGeom, lineMat)
    line.renderOrder = 999
    group.add(line)
    lineRef.current = line

    // Fill polygon (on XY plane, Z=up)
    if (closed && points.length >= 3) {
      const shape = new THREE.Shape()
      shape.moveTo(points[0].x, points[0].y)
      for (let i = 1; i < points.length; i++) {
        shape.lineTo(points[i].x, points[i].y)
      }
      shape.closePath()
      const shapeGeom = new THREE.ShapeGeometry(shape)
      // ShapeGeometry creates vertices on XY plane, which is our ground plane -- just set Z=1
      const posAttr = shapeGeom.getAttribute('position')
      for (let i = 0; i < posAttr.count; i++) {
        posAttr.setZ(i, 1)
      }
      posAttr.needsUpdate = true
      const shapeMat = new THREE.MeshBasicMaterial({
        color: LASSO_COLOR,
        opacity: LASSO_FILL_OPACITY,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false,
      })
      const mesh = new THREE.Mesh(shapeGeom, shapeMat)
      mesh.renderOrder = 998
      group.add(mesh)
      meshRef.current = mesh
    }
  }, [clearVisuals])

  // Raycast onto the ground plane (Z=0, normal pointing up)
  const screenToWorld = useCallback((clientX, clientY) => {
    const renderer = rendererRef?.current
    const camera = cameraRef?.current
    if (!renderer || !camera) return null

    const rect = renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )

    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(ndc, camera)

    // Ground plane: Z=0 with normal pointing up (0,0,1)
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
    const intersection = new THREE.Vector3()
    const hit = raycaster.ray.intersectPlane(groundPlane, intersection)
    return hit ? intersection : null
  }, [rendererRef, cameraRef])

  // Convert scene coords (ENU meters) to [lon, lat]
  const worldToLonLat = useCallback((worldPos) => {
    const frame = enuFrameRef?.current
    if (!frame) return null
    const metersPerDegLat = 111320
    const metersPerDegLon = 111320 * Math.cos((frame.originLat * Math.PI) / 180)
    const lon = frame.originLon + worldPos.x / metersPerDegLon  // X = East
    const lat = frame.originLat + worldPos.y / metersPerDegLat  // Y = North
    return [lon, lat]
  }, [enuFrameRef])

  useEffect(() => {
    if (!lassoActive) return
    const el = mountRef?.current
    if (!el) return

    const points = pointsRef.current

    const handleClick = (e) => {
      if (e.button !== 0) return
      const worldPos = screenToWorld(e.clientX, e.clientY)
      if (!worldPos) return

      if (points.length >= 3) {
        const renderer = rendererRef?.current
        if (renderer) {
          const rect = renderer.domElement.getBoundingClientRect()
          const first = points[0].clone().project(cameraRef.current)
          const firstScreenX = (first.x + 1) / 2 * rect.width + rect.left
          const firstScreenY = (-first.y + 1) / 2 * rect.height + rect.top
          const dx = e.clientX - firstScreenX
          const dy = e.clientY - firstScreenY
          if (Math.sqrt(dx * dx + dy * dy) < CLOSE_THRESHOLD_PX) {
            updateVisuals(points, true)
            const polygon = points.map((p) => worldToLonLat(p)).filter(Boolean)
            setLassoPolygon(polygon)
            setLassoActive(false)
            pointsRef.current = []
            return
          }
        }
      }

      points.push(worldPos)
      updateVisuals(points, false)
    }

    const handleDblClick = (e) => {
      e.preventDefault()
      if (points.length >= 3) {
        updateVisuals(points, true)
        const polygon = points.map((p) => worldToLonLat(p)).filter(Boolean)
        setLassoPolygon(polygon)
        setLassoActive(false)
        pointsRef.current = []
      }
    }

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        clearVisuals()
        pointsRef.current = []
        setLassoActive(false)
        setLassoPolygon(null)
      }
    }

    el.addEventListener('click', handleClick)
    el.addEventListener('dblclick', handleDblClick)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      el.removeEventListener('click', handleClick)
      el.removeEventListener('dblclick', handleDblClick)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [lassoActive, mountRef, rendererRef, cameraRef, screenToWorld, worldToLonLat, updateVisuals, clearVisuals, setLassoActive, setLassoPolygon])

  const clearLasso = useCallback(() => {
    clearVisuals()
    pointsRef.current = []
    setLassoPolygon(null)
    setLassoActive(false)
  }, [clearVisuals, setLassoPolygon, setLassoActive])

  return { lassoGroupRef, clearLasso }
}
