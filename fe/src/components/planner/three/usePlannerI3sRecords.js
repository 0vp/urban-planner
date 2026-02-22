import { useCallback } from 'react'
import * as THREE from 'three'
import {
  applyModsToTileGeometry,
  buildTileFeatureIndex,
  ecefToEnu,
  parseBuildingKey,
  vectorEcefToEnu,
} from '../../../lib/planner/i3sGeometryUtils'
import { COLORS } from './constants'
import { applyRadiusClipShader, disposeObject, normalizeColorAttribute } from './helpers'

function normalizeIndexArray(rawIndices) {
  if (!rawIndices?.length) {
    return null
  }

  if (rawIndices instanceof Uint16Array || rawIndices instanceof Uint32Array) {
    return rawIndices
  }

  if (ArrayBuffer.isView(rawIndices)) {
    return Uint32Array.from(rawIndices)
  }

  return Uint32Array.from(rawIndices)
}

function scheduleBoundsTreeBuild(geometry) {
  const build = () => {
    try {
      if (!geometry?.getAttribute?.('position')) {
        return
      }
      geometry.computeBoundsTree?.({ maxLeafTris: 24 })
    } catch {
    }
  }

  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(build, { timeout: 150 })
    return
  }

  setTimeout(build, 0)
}

export function usePlannerI3sRecords({
  i3sGroupRef,
  highlightGroupRef,
  tileRecordsRef,
  enuFrameRef,
  radiusClipUniformRef,
  buildingModsRef,
  selectedBuildingKeyRef,
}) {
  const clearTileRecords = useCallback(() => {
    const records = tileRecordsRef.current
    const i3sGroup = i3sGroupRef.current
    if (!i3sGroup) {
      records.clear()
      return
    }
    for (const record of records.values()) {
      i3sGroup.remove(record.mesh)
      disposeObject(record.mesh)
    }
    records.clear()
  }, [i3sGroupRef, tileRecordsRef])

  const updateHighlightMesh = useCallback((buildingKey) => {
    const highlightGroup = highlightGroupRef.current
    if (!highlightGroup) {
      return
    }

    while (highlightGroup.children.length) {
      const child = highlightGroup.children.pop()
      disposeObject(child)
    }

    if (!buildingKey) {
      return
    }

    const { tileId } = parseBuildingKey(buildingKey)
    const record = tileRecordsRef.current.get(tileId)
    if (!record) {
      return
    }

    const triangles = record.buildingToTriangles.get(buildingKey)
    if (!triangles?.length) {
      return
    }

    const srcPositions = record.positions
    const highlightPositions = new Float32Array(triangles.length * 3)
    for (let i = 0; i < triangles.length; i++) {
      const vertexIndex = triangles[i] * 3
      const out = i * 3
      highlightPositions[out] = srcPositions[vertexIndex]
      highlightPositions[out + 1] = srcPositions[vertexIndex + 1]
      highlightPositions[out + 2] = srcPositions[vertexIndex + 2]
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(highlightPositions, 3))
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(COLORS.roadSelected[0] / 255, COLORS.roadSelected[1] / 255, COLORS.roadSelected[2] / 255),
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      side: THREE.DoubleSide,
    })

    const mesh = new THREE.Mesh(geometry, material)
    highlightGroup.add(mesh)
  }, [highlightGroupRef, tileRecordsRef])

  const applyModsToAllTiles = useCallback((mods) => {
    for (const record of tileRecordsRef.current.values()) {
      applyModsToTileGeometry(record, mods)
      record.positionAttribute.needsUpdate = true
      record.geometry.computeBoundingSphere()
      record.geometry.computeBoundingBox()
      record.geometry.boundsTree?.refit?.()
    }
    updateHighlightMesh(selectedBuildingKeyRef.current)
  }, [selectedBuildingKeyRef, tileRecordsRef, updateHighlightMesh])

  const getBuildingCentroid = useCallback((buildingKey) => {
    if (!buildingKey) {
      return null
    }
    const { tileId } = parseBuildingKey(buildingKey)
    const record = tileRecordsRef.current.get(tileId)
    if (!record) {
      return null
    }
    const vertices = record.buildingToVertices.get(buildingKey)
    if (!vertices?.length) {
      return null
    }

    let x = 0
    let y = 0
    let z = 0
    for (let i = 0; i < vertices.length; i++) {
      const offset = vertices[i] * 3
      x += record.positions[offset]
      y += record.positions[offset + 1]
      z += record.positions[offset + 2]
    }
    const inv = 1 / vertices.length
    return [x * inv, y * inv, z * inv]
  }, [tileRecordsRef])

  const createTileRecord = useCallback((tile) => {
    const frame = enuFrameRef.current
    const content = tile?.content
    const positionsRaw = content?.attributes?.positions?.value || content?.attributes?.positions
    if (!frame || !positionsRaw?.length) {
      return null
    }

    const vertexCount = Math.floor(positionsRaw.length / 3)
    const basePositions = new Float32Array(vertexCount * 3)
    for (let i = 0; i < positionsRaw.length; i += 3) {
      const enu = ecefToEnu([positionsRaw[i], positionsRaw[i + 1], positionsRaw[i + 2]], frame)
      basePositions[i] = enu[0]
      basePositions[i + 1] = enu[1]
      basePositions[i + 2] = enu[2]
    }

    const geometry = new THREE.BufferGeometry()
    const positionAttribute = new THREE.BufferAttribute(new Float32Array(basePositions), 3)
    geometry.setAttribute('position', positionAttribute)

    const rawIndices = normalizeIndexArray(content?.indices?.value || content?.indices)
    if (rawIndices?.length) {
      geometry.setIndex(new THREE.BufferAttribute(rawIndices, 1))
    }

    const rawNormals = content?.attributes?.normals?.value || content?.attributes?.normals
    if (rawNormals?.length >= vertexCount * 3) {
      const normals = new Float32Array(vertexCount * 3)
      for (let i = 0; i < rawNormals.length; i += 3) {
        const [x, y, z] = vectorEcefToEnu([rawNormals[i], rawNormals[i + 1], rawNormals[i + 2]], frame)
        const norm = Math.hypot(x, y, z) || 1
        normals[i] = x / norm
        normals[i + 1] = y / norm
        normals[i + 2] = z / norm
      }
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    } else {
      geometry.computeVertexNormals()
    }

    const colorAttribute = normalizeColorAttribute(content?.attributes?.colors, vertexCount)
    if (colorAttribute) {
      geometry.setAttribute('color', colorAttribute)
    }

    const material = new THREE.MeshStandardMaterial({
      color: colorAttribute ? 0xffffff : 0xbec5ce,
      vertexColors: Boolean(colorAttribute),
      metalness: 0.02,
      roughness: 0.9,
      flatShading: true,
    })
    applyRadiusClipShader(material, radiusClipUniformRef.current, 'planner-radius-clip-i3s-v2')

    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.userData = { tileId: tile.id }

    scheduleBoundsTreeBuild(geometry)

    const featureIndex = buildTileFeatureIndex(
      tile.id,
      rawIndices,
      content?.featureIds,
      vertexCount,
    )

    const record = {
      tileId: tile.id,
      tile,
      geometry,
      mesh,
      positionAttribute,
      positions: positionAttribute.array,
      basePositions,
      buildingToVertices: featureIndex.buildingToVertices,
      buildingToTriangles: featureIndex.buildingToTriangles,
      vertexToBuildingKey: featureIndex.vertexToBuildingKey,
      edgeLines: null,
    }

    applyModsToTileGeometry(record, buildingModsRef.current)
    positionAttribute.needsUpdate = true
    geometry.computeBoundingSphere()
    return record
  }, [buildingModsRef, enuFrameRef, radiusClipUniformRef])

  const findVisibleBuildingKeyByFeatureId = useCallback((featureId) => {
    if (!Number.isFinite(featureId) || featureId < 0) {
      return null
    }

    for (const record of tileRecordsRef.current.values()) {
      if (!record?.mesh?.visible || !record?.buildingToVertices) {
        continue
      }

      for (const key of record.buildingToVertices.keys()) {
        const parsed = parseBuildingKey(key)
        if (parsed.featureId === featureId) {
          return key
        }
      }
    }

    return null
  }, [tileRecordsRef])

  return {
    clearTileRecords,
    updateHighlightMesh,
    applyModsToAllTiles,
    getBuildingCentroid,
    createTileRecord,
    findVisibleBuildingKeyByFeatureId,
  }
}
