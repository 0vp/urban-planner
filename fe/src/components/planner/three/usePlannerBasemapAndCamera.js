import { useCallback } from 'react'
import * as THREE from 'three'
import { ecefToEnu, enuToLonLatAlt, lonLatToECEF } from '../../../lib/planner/i3sGeometryUtils'
import {
  BASEMAP_CACHE_LIMIT,
  BASEMAP_TILE_RADIUS,
  CAMERA_REFERENCE_DISTANCE,
  CAMERA_REFERENCE_ZOOM,
  DEFAULT_VIEW_STATE,
  WORLD_MAP_TILE_URL,
} from './constants'
import { clamp, disposeObject, getTileBounds, latToTileY, lonToTileX } from './helpers'

export function usePlannerBasemapAndCamera({
  rendererRef,
  cameraRef,
  controlsRef,
  basemapGroupRef,
  basemapTilesRef,
  enuFrameRef,
  mapViewStateRef,
  syncTickRef,
  basemapAnchorRef,
}) {
  const clearBasemapTiles = useCallback(() => {
    const basemapGroup = basemapGroupRef.current
    const records = basemapTilesRef.current

    for (const record of records.values()) {
      if (basemapGroup) {
        basemapGroup.remove(record.mesh)
      }
      disposeObject(record.mesh)
      record.texture?.dispose?.()
    }
    records.clear()
    basemapAnchorRef.current = ''
  }, [basemapAnchorRef, basemapGroupRef, basemapTilesRef])

  const updateBasemapTiles = useCallback((view) => {
    const basemapGroup = basemapGroupRef.current
    const renderer = rendererRef.current
    const frame = enuFrameRef.current
    if (!basemapGroup || !renderer || !frame || !view) {
      return
    }

    const zoom = clamp(Math.round(view.zoom), 0, 16)
    const tileCount = 2 ** zoom
    const centerX = lonToTileX(view.longitude, zoom)
    const centerY = latToTileY(view.latitude, zoom)
    const radius = BASEMAP_TILE_RADIUS
    const tileRecords = basemapTilesRef.current
    const anchorKey = `${zoom}/${centerX}/${centerY}`
    if (anchorKey === basemapAnchorRef.current && tileRecords.size > 0) {
      return
    }
    basemapAnchorRef.current = anchorKey
    const desired = new Set()
    const seenTick = syncTickRef.current

    for (let dy = -radius; dy <= radius; dy += 1) {
      const y = centerY + dy
      if (y < 0 || y >= tileCount) {
        continue
      }
      for (let dx = -radius; dx <= radius; dx += 1) {
        const x = ((centerX + dx) % tileCount + tileCount) % tileCount
        const key = `${zoom}/${x}/${y}`
        desired.add(key)
        if (tileRecords.has(key)) {
          const cached = tileRecords.get(key)
          cached.mesh.visible = true
          cached.lastSeen = seenTick
          continue
        }

        const bounds = getTileBounds(x, y, zoom)
        const sw = ecefToEnu(lonLatToECEF(bounds.west, bounds.south, 0), frame)
        const se = ecefToEnu(lonLatToECEF(bounds.east, bounds.south, 0), frame)
        const ne = ecefToEnu(lonLatToECEF(bounds.east, bounds.north, 0), frame)
        const nw = ecefToEnu(lonLatToECEF(bounds.west, bounds.north, 0), frame)

        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute(
          'position',
          new THREE.BufferAttribute(
            new Float32Array([
              sw[0], sw[1], sw[2],
              se[0], se[1], se[2],
              ne[0], ne[1], ne[2],
              nw[0], nw[1], nw[2],
            ]),
            3,
          ),
        )
        geometry.setAttribute(
          'uv',
          new THREE.BufferAttribute(new Float32Array([
            0, 1,
            1, 1,
            1, 0,
            0, 0,
          ]), 2),
        )
        geometry.setIndex([0, 1, 2, 0, 2, 3])

        const material = new THREE.MeshBasicMaterial({
          color: 0x334155,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.95,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        })
        const mesh = new THREE.Mesh(geometry, material)
        mesh.renderOrder = -10
        mesh.position.z -= 1.2
        mesh.receiveShadow = false
        basemapGroup.add(mesh)

        const record = { mesh, texture: null, lastSeen: seenTick }
        tileRecords.set(key, record)

        const textureLoader = new THREE.TextureLoader()
        textureLoader.setCrossOrigin('anonymous')
        textureLoader.load(
          WORLD_MAP_TILE_URL
            .replace('{z}', String(zoom))
            .replace('{y}', String(y))
            .replace('{x}', String(x)),
          (texture) => {
            const current = tileRecords.get(key)
            if (!current || current.mesh !== mesh) {
              texture.dispose()
              return
            }
            texture.flipY = false
            texture.colorSpace = THREE.SRGBColorSpace
            texture.minFilter = THREE.LinearMipmapLinearFilter
            texture.magFilter = THREE.LinearFilter
            texture.generateMipmaps = true
            texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
            current.texture = texture
            mesh.material.map = texture
            mesh.material.color.setHex(0xffffff)
            mesh.material.needsUpdate = true
          },
          undefined,
          () => {
            const current = tileRecords.get(key)
            if (!current || current.mesh !== mesh) {
              return
            }
            mesh.material.color.setHex(0x475569)
            mesh.material.needsUpdate = true
          },
        )
      }
    }

    for (const [key, record] of tileRecords.entries()) {
      if (!desired.has(key)) {
        record.mesh.visible = false
      }
    }

    if (tileRecords.size > BASEMAP_CACHE_LIMIT) {
      const hiddenByAge = [...tileRecords.entries()]
        .filter(([, record]) => !record.mesh.visible)
        .sort((a, b) => a[1].lastSeen - b[1].lastSeen)

      let overflow = tileRecords.size - BASEMAP_CACHE_LIMIT
      for (const [key, record] of hiddenByAge) {
        if (overflow <= 0) {
          break
        }
        basemapGroup.remove(record.mesh)
        disposeObject(record.mesh)
        record.texture?.dispose?.()
        tileRecords.delete(key)
        overflow -= 1
      }
    }
  }, [basemapAnchorRef, basemapGroupRef, basemapTilesRef, enuFrameRef, rendererRef, syncTickRef])

  const deriveMapViewState = useCallback(() => {
    const renderer = rendererRef.current
    const camera = cameraRef.current
    const controls = controlsRef.current
    const frame = enuFrameRef.current
    if (!renderer || !camera || !controls || !frame) {
      return mapViewStateRef.current
    }

    const target = controls.target
    const [longitude, latitude] = enuToLonLatAlt([target.x, target.y, target.z], frame)
    const offsetX = camera.position.x - target.x
    const offsetY = camera.position.y - target.y
    const offsetZ = camera.position.z - target.z
    const distance = Math.hypot(offsetX, offsetY, offsetZ)
    const horizontal = Math.hypot(offsetX, offsetY)
    const pitch = Math.min(85, Math.max(0, (Math.atan2(horizontal, Math.max(1e-6, offsetZ)) * 180) / Math.PI))
    const bearing = (Math.atan2(offsetX, offsetY) * 180 / Math.PI + 360) % 360
    const zoom = CAMERA_REFERENCE_ZOOM - Math.log2(Math.max(1e-6, distance / CAMERA_REFERENCE_DISTANCE))

    return {
      longitude,
      latitude,
      zoom: Number.isFinite(zoom) ? zoom : DEFAULT_VIEW_STATE.zoom,
      pitch,
      bearing,
    }
  }, [cameraRef, controlsRef, enuFrameRef, mapViewStateRef, rendererRef])

  const placeCameraFromView = useCallback((viewState, targetEnu = [0, 0, 0]) => {
    const renderer = rendererRef.current
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!renderer || !camera || !controls) {
      return
    }

    const distance = CAMERA_REFERENCE_DISTANCE * 2 ** (CAMERA_REFERENCE_ZOOM - viewState.zoom)
    const pitchRad = (viewState.pitch * Math.PI) / 180
    const bearingRad = (viewState.bearing * Math.PI) / 180
    const horizontal = distance * Math.sin(pitchRad)
    const dz = distance * Math.cos(pitchRad)
    const dx = Math.sin(bearingRad) * horizontal
    const dy = Math.cos(bearingRad) * horizontal

    controls.target.set(targetEnu[0], targetEnu[1], targetEnu[2])
    camera.position.set(targetEnu[0] + dx, targetEnu[1] + dy, targetEnu[2] + dz)
    camera.lookAt(controls.target)
    controls.update()
  }, [cameraRef, controlsRef, rendererRef])

  return {
    clearBasemapTiles,
    updateBasemapTiles,
    deriveMapViewState,
    placeCameraFromView,
  }
}
