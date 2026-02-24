import { useCallback, useRef } from 'react'
import * as THREE from 'three'
import SunCalc from 'suncalc'

// Scene coordinate system: X=East, Y=North, Z=Up
export function useSunShadow({ sceneRef, rendererRef }) {
  const lightRef = useRef(null)
  const shadowPlaneRef = useRef(null)
  const groupRef = useRef(null)

  const showSunShadows = useCallback(({ date, hour, lat, lon }) => {
    const scene = sceneRef?.current
    const renderer = rendererRef?.current
    if (!scene || !renderer) return

    clearSunShadows()

    const group = new THREE.Group()
    group.name = 'sunShadowOverlay'
    groupRef.current = group

    const dt = new Date(date || '2025-06-21')
    dt.setHours(hour ?? 12, 0, 0, 0)
    const sunPos = SunCalc.getPosition(dt, lat, lon)
    const altitude = sunPos.altitude
    const azimuth = sunPos.azimuth

    if (altitude <= 0) {
      scene.add(group)
      return { sunAboveHorizon: false, altitude: (altitude * 180) / Math.PI, azimuth: (azimuth * 180) / Math.PI }
    }

    // SunCalc azimuth: 0=south, positive=west. Convert to scene coords (X=East, Y=North, Z=Up)
    // Scene azimuth from North: sunCalc azimuth + PI (since sunCalc 0=south)
    const distance = 2000
    const sunX = distance * Math.sin(azimuth) * Math.cos(altitude)   // East component
    const sunY = -distance * Math.cos(azimuth) * Math.cos(altitude)  // North component (negate because sunCalc 0=south)
    const sunZ = distance * Math.sin(altitude)                       // Up component

    const dirLight = new THREE.DirectionalLight(0xfff4e0, 0.8)
    dirLight.position.set(sunX, sunY, sunZ)
    dirLight.target.position.set(0, 0, 0)
    dirLight.castShadow = true
    dirLight.shadow.mapSize.width = 2048
    dirLight.shadow.mapSize.height = 2048
    dirLight.shadow.camera.near = 1
    dirLight.shadow.camera.far = 5000
    dirLight.shadow.camera.left = -1500
    dirLight.shadow.camera.right = 1500
    dirLight.shadow.camera.top = 1500
    dirLight.shadow.camera.bottom = -1500
    dirLight.shadow.bias = -0.001
    group.add(dirLight)
    group.add(dirLight.target)
    lightRef.current = dirLight

    // Shadow-receiving ground plane on XY at Z=0.1
    const planeGeom = new THREE.PlaneGeometry(4000, 4000)
    // PlaneGeometry is on XY by default -- perfect for our Z-up scene
    const planeMat = new THREE.ShadowMaterial({ opacity: 0.4, color: 0x000033 })
    const plane = new THREE.Mesh(planeGeom, planeMat)
    plane.receiveShadow = true
    plane.frustumCulled = false
    plane.position.z = 0.1
    plane.renderOrder = 800
    group.add(plane)
    shadowPlaneRef.current = plane

    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap

    scene.traverse((obj) => {
      if (obj.isMesh && obj !== plane) {
        obj.castShadow = true
      }
    })

    scene.add(group)

    return {
      sunAboveHorizon: true,
      altitude: Math.round((altitude * 180) / Math.PI * 10) / 10,
      azimuth: Math.round((azimuth * 180) / Math.PI * 10) / 10,
    }
  }, [sceneRef, rendererRef])

  const clearSunShadows = useCallback(() => {
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
    lightRef.current = null
    shadowPlaneRef.current = null
  }, [sceneRef])

  return { showSunShadows, clearSunShadows }
}
