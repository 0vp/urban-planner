import { useCallback, useEffect } from 'react'
import * as THREE from 'three'
import { loadFeatureAttributes } from '@loaders.gl/i3s'
import { computeMoveDelta } from '../../../lib/planner/i3sGeometryUtils'
import { SELECT_HINT } from './constants'
import { pickSelectableBuildingHit } from './interactionPicking'

export function usePlannerInteraction({
  rendererRef,
  cameraRef,
  i3sGroupRef,
  featureGroupRef,
  tileRecordsRef,
  pointerRef,
  raycasterRef,
  renderRadiusMetersRef,
  attrsRequestRef,
  selectedBuildingKeyRef,
  moveMode,
  moveSrcCoord,
  selectedBuildingKey,
  selectedFeatureId,
  selectedSourceType,
  setStatus,
  setMoveMode,
  setMoveSrcCoord,
  setBuildingMods,
  setIsDirty,
  setSelectedFeatureId,
  setSelectedSourceType,
  setSelectedBuildingKey,
  setSelectedBuildingAttrs,
  setFeatures,
  updateHighlightMesh,
  getBuildingCentroid,
}) {
  const resetSelection = useCallback(() => {
    attrsRequestRef.current += 1
    setSelectedFeatureId(null)
    setSelectedSourceType(null)
    setSelectedBuildingKey(null)
    selectedBuildingKeyRef.current = null
    setSelectedBuildingAttrs(null)
    updateHighlightMesh(null)
  }, [
    attrsRequestRef,
    selectedBuildingKeyRef,
    setSelectedBuildingAttrs,
    setSelectedBuildingKey,
    setSelectedFeatureId,
    setSelectedSourceType,
    updateHighlightMesh,
  ])

  const handleEdit = useCallback(() => {
    if (!selectedFeatureId) {
      setStatus('Select a feature first.')
      return
    }
    if (selectedSourceType === 'i3s' && selectedBuildingKey) {
      const centroid = getBuildingCentroid(selectedBuildingKey)
      if (!centroid) {
        setStatus('Unable to move this building.')
        return
      }
      setMoveMode(true)
      setMoveSrcCoord(centroid)
      setStatus('Move mode: click a destination on the map.')
      return
    }
    setStatus(`Edit ${selectedFeatureId} is not implemented yet.`)
  }, [
    getBuildingCentroid,
    selectedBuildingKey,
    selectedFeatureId,
    selectedSourceType,
    setMoveMode,
    setMoveSrcCoord,
    setStatus,
  ])

  const handleDelete = useCallback(() => {
    if (!selectedFeatureId) {
      setStatus('Select a feature to delete.')
      return
    }

    if (selectedSourceType === 'i3s') {
      if (!selectedBuildingKey) {
        setStatus('No I3S building selected.')
        return
      }
      setBuildingMods((prev) => {
        const next = new Map(prev)
        next.set(selectedBuildingKey, { action: 'delete' })
        return next
      })
      resetSelection()
      setIsDirty(true)
      setStatus('I3S building deleted.')
      return
    }

    setFeatures((previous) => previous.filter((feature) => feature.id !== selectedFeatureId))
    resetSelection()
    setIsDirty(true)
    setStatus('Feature deleted.')
  }, [
    resetSelection,
    selectedBuildingKey,
    selectedFeatureId,
    selectedSourceType,
    setBuildingMods,
    setFeatures,
    setIsDirty,
    setStatus,
  ])

  const handleSceneClick = useCallback((event) => {
    const renderer = rendererRef.current
    const camera = cameraRef.current
    const i3sGroup = i3sGroupRef.current
    const featureGroup = featureGroupRef.current
    if (!renderer || !camera || !i3sGroup || !featureGroup) {
      return
    }

    const rect = renderer.domElement.getBoundingClientRect()
    pointerRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointerRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    raycasterRef.current.setFromCamera(pointerRef.current, camera)

    if (moveMode) {
      const target = new THREE.Vector3()
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
      if (!raycasterRef.current.ray.intersectPlane(plane, target)) {
        setStatus('Move mode: click on the ground to choose destination.')
        return
      }

      if (selectedBuildingKeyRef.current && moveSrcCoord) {
        const destination = [target.x, target.y, target.z]
        const delta = computeMoveDelta(moveSrcCoord, destination)
        setBuildingMods((previous) => {
          const next = new Map(previous)
          const current = next.get(selectedBuildingKeyRef.current)
          const previousDelta = current?.action === 'move' ? current.delta : [0, 0, 0]
          next.set(selectedBuildingKeyRef.current, {
            action: 'move',
            delta: [
              previousDelta[0] + delta[0],
              previousDelta[1] + delta[1],
              previousDelta[2] + delta[2],
            ],
          })
          return next
        })
        setIsDirty(true)
        setStatus('Building moved.')
      }

      setMoveMode(false)
      setMoveSrcCoord(null)
      return
    }

    const visibleI3sMeshes = i3sGroup.children.filter((node) => node.visible)
    const buildingHits = raycasterRef.current.intersectObjects(visibleI3sMeshes, false)
    if (buildingHits.length > 0) {
      const hit = pickSelectableBuildingHit(buildingHits, tileRecordsRef, renderRadiusMetersRef)
      if (hit?.key) {
        attrsRequestRef.current += 1
        const requestId = attrsRequestRef.current
        const parsed = hit.parsed
        selectedBuildingKeyRef.current = hit.key
        setSelectedBuildingKey(hit.key)
        setSelectedFeatureId(`i3s_${hit.key}`)
        setSelectedSourceType('i3s')
        setSelectedBuildingAttrs(null)
        updateHighlightMesh(hit.key)

        if (!Number.isFinite(parsed.featureId) || parsed.featureId < 0) {
          setStatus('Selected I3S building (attributes unavailable for this geometry).')
          return
        }

        setStatus(`Selected I3S building (ID: ${parsed.featureId}). Loading attributes...`)

        loadFeatureAttributes(hit.record.tile, parsed.featureId)
          .then((attrs) => {
            if (requestId !== attrsRequestRef.current) {
              return
            }
            if (attrs) {
              setSelectedBuildingAttrs(attrs)
              const name = attrs.name || 'unnamed'
              const height = attrs.height || '?'
              setStatus(`I3S: ${name} | Height: ${height}m | ID: ${parsed.featureId}`)
            } else {
              setStatus(`Selected I3S building (ID: ${parsed.featureId}).`)
            }
          })
          .catch(() => {
            if (requestId === attrsRequestRef.current) {
              setStatus(`Selected I3S building (ID: ${parsed.featureId}).`)
            }
          })
        return
      }
    }

    const lineHits = raycasterRef.current.intersectObjects(featureGroup.children, false)
    if (lineHits.length > 0) {
      const lineHit = lineHits.find((hit) => {
        const point = hit?.point
        return point && Math.hypot(point.x, point.y) <= renderRadiusMetersRef.current
      })
      if (!lineHit) {
        resetSelection()
        setStatus(SELECT_HINT)
        return
      }

      const lineObject = lineHit.object
      let sourceId = lineObject.userData?.sourceId
      let entityType = lineObject.userData?.entityType
      let name = lineObject.userData?.name || entityType || 'unnamed'

      if (!sourceId && lineObject.userData?.mergedFeatureMesh) {
        const faceIndex = Number(lineHit?.faceIndex)
        const triangleFeatureIndices = lineObject.userData?.triangleFeatureIndices
        const featureIds = lineObject.userData?.featureIds
        if (
          Number.isInteger(faceIndex)
          && triangleFeatureIndices
          && featureIds
          && faceIndex >= 0
          && faceIndex < triangleFeatureIndices.length
        ) {
          const featureIndex = triangleFeatureIndices[faceIndex]
          sourceId = featureIds[featureIndex]
          const featureMeta = sourceId ? lineObject.userData?.featureMetaById?.[sourceId] : null
          entityType = featureMeta?.entityType || entityType
          name = featureMeta?.name || name
        }
      }

      if (sourceId) {
        attrsRequestRef.current += 1
        selectedBuildingKeyRef.current = null
        setSelectedBuildingKey(null)
        setSelectedBuildingAttrs(null)
        setSelectedFeatureId(sourceId)
        setSelectedSourceType('feature')
        setStatus(`Selected ${entityType || 'feature'}: ${name}`)
        updateHighlightMesh(null)
        return
      }
    }

    resetSelection()
    setStatus(SELECT_HINT)
  }, [
    attrsRequestRef,
    cameraRef,
    featureGroupRef,
    i3sGroupRef,
    moveMode,
    moveSrcCoord,
    pointerRef,
    raycasterRef,
    renderRadiusMetersRef,
    rendererRef,
    resetSelection,
    selectedBuildingKeyRef,
    setBuildingMods,
    setIsDirty,
    setMoveMode,
    setMoveSrcCoord,
    setSelectedBuildingAttrs,
    setSelectedBuildingKey,
    setSelectedFeatureId,
    setSelectedSourceType,
    setStatus,
    tileRecordsRef,
    updateHighlightMesh,
  ])

  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer) {
      return
    }

    const onClick = (event) => handleSceneClick(event)
    renderer.domElement.addEventListener('click', onClick)
    return () => renderer.domElement.removeEventListener('click', onClick)
  }, [handleSceneClick, rendererRef])

  useEffect(() => {
    updateHighlightMesh(selectedBuildingKey)
  }, [selectedBuildingKey, updateHighlightMesh])

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && moveMode) {
        setMoveMode(false)
        setMoveSrcCoord(null)
        setStatus(SELECT_HINT)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [moveMode, setMoveMode, setMoveSrcCoord, setStatus])

  return {
    resetSelection,
    handleEdit,
    handleDelete,
  }
}
