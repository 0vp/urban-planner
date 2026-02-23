import { useCallback, useEffect, useRef } from 'react'
import { loadFeatureAttributes } from '@loaders.gl/i3s'
import { SELECT_HINT } from './constants'
import { pickSelectableBuildingHit } from './interactionPicking'

function readTransformMod(mod) {
  if (mod?.action === 'delete') {
    return {
      deleted: true,
      delta: [0, 0, 0],
    }
  }

  const hasDelta = Array.isArray(mod?.delta) && mod.delta.length === 3
  const delta = hasDelta ? mod.delta.map((value) => (Number.isFinite(value) ? value : 0)) : [0, 0, 0]

  return {
    deleted: false,
    delta,
  }
}

function deltasEqual(a, b, epsilon = 1e-4) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 3 || b.length !== 3) {
    return false
  }
  return (
    Math.abs(a[0] - b[0]) <= epsilon
    && Math.abs(a[1] - b[1]) <= epsilon
    && Math.abs(a[2] - b[2]) <= epsilon
  )
}

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
  buildingModsRef,
  moveMode,
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
  applyLiveBuildingMove,
  finalizeLiveBuildingMove,
  transformAnchorRef,
  moveTransformControlsRef,
}) {
  const transformStateRef = useRef({
    buildingKey: null,
    startPosition: [0, 0, 0],
    startDelta: [0, 0, 0],
    pendingDelta: null,
    hasPendingCommit: false,
    isProgrammaticUpdate: false,
  })
  const transformDraggingRef = useRef(false)
  const suppressNextClickRef = useRef(false)

  const commitPendingTransform = useCallback(() => {
    const { buildingKey, pendingDelta, hasPendingCommit } = transformStateRef.current
    if (!buildingKey || !hasPendingCommit || !Array.isArray(pendingDelta)) {
      return
    }

    const currentTransform = readTransformMod(buildingModsRef.current?.get(buildingKey))
    if (currentTransform.deleted || !deltasEqual(currentTransform.delta, pendingDelta)) {
      setBuildingMods((previous) => {
        const next = new Map(previous)
        next.set(buildingKey, {
          action: 'move',
          delta: pendingDelta,
        })
        return next
      })
      setIsDirty(true)
    }

    finalizeLiveBuildingMove(buildingKey)
    transformStateRef.current.pendingDelta = null
    transformStateRef.current.hasPendingCommit = false
  }, [buildingModsRef, finalizeLiveBuildingMove, setBuildingMods, setIsDirty])

  const detachTransformControls = useCallback((resetMode = false) => {
    commitPendingTransform()

    const anchor = transformAnchorRef.current
    const moveControls = moveTransformControlsRef.current
    if (moveControls) {
      moveControls.detach()
      moveControls.enabled = false
      moveControls.visible = false
    }
    if (anchor) {
      anchor.visible = false
    }
    transformStateRef.current.buildingKey = null
    transformDraggingRef.current = false
    transformStateRef.current.pendingDelta = null
    transformStateRef.current.hasPendingCommit = false
    if (resetMode) {
      setMoveMode(false)
      setMoveSrcCoord(null)
    }
  }, [commitPendingTransform, moveTransformControlsRef, setMoveMode, setMoveSrcCoord, transformAnchorRef])

  const attachTransformControls = useCallback((buildingKey) => {
    if (!buildingKey) {
      return false
    }

    const anchor = transformAnchorRef.current
    const moveControls = moveTransformControlsRef.current
    if (!anchor || !moveControls) {
      return false
    }

    const centroid = getBuildingCentroid(buildingKey)
    if (!centroid) {
      return false
    }

    const mod = buildingModsRef.current?.get(buildingKey)
    const currentTransform = readTransformMod(mod)
    if (currentTransform.deleted) {
      return false
    }

    transformStateRef.current.isProgrammaticUpdate = true
    anchor.position.set(centroid[0], centroid[1], centroid[2])
    anchor.visible = true

    moveControls.attach(anchor)
    moveControls.enabled = true
    moveControls.visible = true

    transformStateRef.current = {
      buildingKey,
      startPosition: [...centroid],
      startDelta: [...currentTransform.delta],
      pendingDelta: null,
      hasPendingCommit: false,
      isProgrammaticUpdate: false,
    }

    return true
  }, [buildingModsRef, getBuildingCentroid, moveTransformControlsRef, transformAnchorRef])

  const applyTransformFromAnchor = useCallback(() => {
    const anchor = transformAnchorRef.current
    const { buildingKey, startPosition, startDelta, isProgrammaticUpdate } = transformStateRef.current
    if (!moveMode || !anchor || !buildingKey || isProgrammaticUpdate) {
      return
    }

    const nextDelta = [
      startDelta[0] + (anchor.position.x - startPosition[0]),
      startDelta[1] + (anchor.position.y - startPosition[1]),
      startDelta[2] + (anchor.position.z - startPosition[2]),
    ]

    transformStateRef.current.pendingDelta = nextDelta
    transformStateRef.current.hasPendingCommit = !deltasEqual(nextDelta, startDelta)

    const liveUpdated = applyLiveBuildingMove(buildingKey, nextDelta)
    if (liveUpdated) {
      return
    }

    setBuildingMods((previous) => {
      const next = new Map(previous)
      next.set(buildingKey, {
        action: 'move',
        delta: nextDelta,
      })
      return next
    })
    setIsDirty(true)
    transformStateRef.current.hasPendingCommit = false
  }, [applyLiveBuildingMove, moveMode, setBuildingMods, setIsDirty, transformAnchorRef])

  const handleTransformDraggingChanged = useCallback((event) => {
    const dragging = Boolean(event?.value)
    transformDraggingRef.current = dragging
    if (!dragging && moveMode) {
      commitPendingTransform()
      suppressNextClickRef.current = true
      setStatus('Building moved.')
    }
  }, [commitPendingTransform, moveMode, setStatus])

  const resetSelection = useCallback(() => {
    detachTransformControls(true)
    attrsRequestRef.current += 1
    setSelectedFeatureId(null)
    setSelectedSourceType(null)
    setSelectedBuildingKey(null)
    selectedBuildingKeyRef.current = null
    setSelectedBuildingAttrs(null)
    updateHighlightMesh(null)
  }, [
    attrsRequestRef,
    detachTransformControls,
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
      if (moveMode) {
        detachTransformControls(true)
        setStatus('Edit mode disabled.')
        return
      }
      setMoveMode(true)
      setMoveSrcCoord(null)
      const attached = attachTransformControls(selectedBuildingKey)
      if (!attached) {
        setMoveMode(false)
        setStatus('Unable to edit this building right now.')
        return
      }
      setStatus('Edit mode active: drag axis arrows to move.')
      return
    }

    setStatus(`Edit ${selectedFeatureId} is not implemented yet.`)
  }, [
    attachTransformControls,
    detachTransformControls,
    moveMode,
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
      detachTransformControls(true)
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
    detachTransformControls,
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

    if (transformDraggingRef.current) {
      return
    }

    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false
      return
    }

    const rect = renderer.domElement.getBoundingClientRect()
    pointerRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointerRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    raycasterRef.current.setFromCamera(pointerRef.current, camera)

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
        setMoveMode(true)
        setMoveSrcCoord(null)
        updateHighlightMesh(hit.key)
        attachTransformControls(hit.key)

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
        detachTransformControls(true)
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
    attachTransformControls,
    cameraRef,
    detachTransformControls,
    featureGroupRef,
    i3sGroupRef,
    moveMode,
    pointerRef,
    raycasterRef,
    renderRadiusMetersRef,
    rendererRef,
    resetSelection,
    selectedBuildingKeyRef,
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
    const moveControls = moveTransformControlsRef.current
    if (!moveControls) {
      return
    }

    moveControls.addEventListener('objectChange', applyTransformFromAnchor)
    moveControls.addEventListener('dragging-changed', handleTransformDraggingChanged)

    return () => {
      moveControls.removeEventListener('objectChange', applyTransformFromAnchor)
      moveControls.removeEventListener('dragging-changed', handleTransformDraggingChanged)
    }
  }, [
    applyTransformFromAnchor,
    handleTransformDraggingChanged,
    moveTransformControlsRef,
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
    if (!moveMode) {
      detachTransformControls(false)
      return
    }

    if (selectedSourceType !== 'i3s' || !selectedBuildingKey) {
      detachTransformControls(true)
      return
    }

    const attached = attachTransformControls(selectedBuildingKey)
    if (!attached) {
      detachTransformControls(true)
      setStatus('Unable to edit this building right now.')
    }
  }, [
    attachTransformControls,
    detachTransformControls,
    moveMode,
    selectedBuildingKey,
    selectedSourceType,
    setStatus,
  ])

  useEffect(() => {
    updateHighlightMesh(selectedBuildingKey)
  }, [selectedBuildingKey, updateHighlightMesh])

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && moveMode) {
        detachTransformControls(true)
        setStatus(SELECT_HINT)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [detachTransformControls, moveMode, setStatus])

  return {
    resetSelection,
    handleEdit,
    handleDelete,
  }
}
