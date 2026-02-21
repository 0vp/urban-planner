import { useEffect, useMemo, useRef } from 'react'
import { EditorToolbar } from './EditorToolbar'
import { InspectorPanel } from './InspectorPanel'
import { LayerPanel } from './LayerPanel'
import { MapSearchBar } from './MapSearchBar'
import { PlannerScene } from './PlannerScene'
import { SaveLoadPanel } from './SaveLoadPanel'
import { usePlannerStore } from '../../lib/planner/plannerStore'
import { safeFetchLocationEntities } from '../../lib/planner/mapDataProvider'
import { getTheme, plannerThemes } from '../../lib/planner/theme'
import { toDownloadData } from '../../lib/planner/serialize'

function downloadFile(name, content, type = 'application/json') {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function parseImportFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read file'))
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result))
        resolve(parsed)
      } catch {
        reject(new Error('Invalid JSON file'))
      }
    }
    reader.readAsText(file)
  })
}

export function PlannerShell() {
  const fileInputRef = useRef(null)
  const didBootstrapSearchRef = useRef(false)

  const entities = usePlannerStore((state) => state.entities)
  const locationMeta = usePlannerStore((state) => state.locationMeta)
  const selectedEntityId = usePlannerStore((state) => state.selectedEntityId)
  const layers = usePlannerStore((state) => state.layers)
  const tool = usePlannerStore((state) => state.tool)
  const themeName = usePlannerStore((state) => state.themeName)
  const history = usePlannerStore((state) => state.history)
  const status = usePlannerStore((state) => state.status)

  const setTool = usePlannerStore((state) => state.setTool)
  const addEntity = usePlannerStore((state) => state.addEntity)
  const deleteSelectedEntity = usePlannerStore((state) => state.deleteSelectedEntity)
  const undo = usePlannerStore((state) => state.undo)
  const redo = usePlannerStore((state) => state.redo)
  const setLayerVisibility = usePlannerStore((state) => state.setLayerVisibility)
  const updateSelectedStyle = usePlannerStore((state) => state.updateSelectedStyle)
  const replaceAllEntities = usePlannerStore((state) => state.replaceAllEntities)
  const setStatus = usePlannerStore((state) => state.setStatus)
  const saveToBrowser = usePlannerStore((state) => state.saveToBrowser)
  const loadFromBrowser = usePlannerStore((state) => state.loadFromBrowser)
  const importSnapshot = usePlannerStore((state) => state.importSnapshot)
  const setThemeName = usePlannerStore((state) => state.setThemeName)

  const selectedEntity = useMemo(() => {
    return entities.find((entity) => entity.id === selectedEntityId) ?? null
  }, [entities, selectedEntityId])

  const activeTheme = useMemo(() => getTheme(themeName), [themeName])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveToBrowser()
    }, 1200)

    return () => {
      window.clearTimeout(timer)
    }
  }, [entities, layers, locationMeta, saveToBrowser])

  useEffect(() => {
    if (didBootstrapSearchRef.current) {
      return
    }

    if (!locationMeta?.source?.includes('seed')) {
      didBootstrapSearchRef.current = true
      return
    }

    didBootstrapSearchRef.current = true
    handleSearch(locationMeta.query ?? 'Montreal')
  }, [locationMeta?.query, locationMeta?.source])

  async function handleSearch(query) {
    setStatus({ loading: true, error: '', message: `Loading ${query}...` })
    const result = await safeFetchLocationEntities(query)
    replaceAllEntities(result)
    const label = result.locationMeta.label ?? result.locationMeta.query
    const source = result.locationMeta.source ?? 'unknown'

    if (result.isFallback) {
      setStatus({
        loading: false,
        error: 'Live map data unavailable. Showing fallback seed scene.',
        message: `${label}: ${result.entities.length} entities (${source})`,
      })
      return
    }

    setStatus({
      loading: false,
      error: '',
      message: `${label}: ${result.entities.length} entities (${source})`,
    })
  }

  function handleCreate(type) {
    const anchor = selectedEntity?.transform.position ?? [0, 0, 0]
    const randomOffset = () => Math.round((Math.random() * 18 - 9) * 10) / 10
    addEntity(type, {
      position: [anchor[0] + randomOffset(), 0, anchor[2] + randomOffset()],
    })
  }

  function handleSave() {
    saveToBrowser()
    setStatus({ message: 'Saved to browser storage', error: '' })
  }

  function handleLoad() {
    const success = loadFromBrowser()
    setStatus({
      error: success ? '' : 'No saved project found in browser storage',
      message: success ? 'Loaded from browser storage' : '',
    })
  }

  function handleExport() {
    const state = usePlannerStore.getState()
    downloadFile('urban-planner-project.json', toDownloadData(state))
    setStatus({ message: 'Project exported', error: '' })
  }

  async function handleImport(event) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    try {
      const parsed = await parseImportFile(file)
      importSnapshot(parsed)
      setStatus({ message: 'Project imported', error: '' })
    } catch (error) {
      setStatus({ error: error.message, message: '' })
    } finally {
      event.target.value = ''
    }
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-zinc-950">
      <PlannerScene theme={activeTheme} />

      <div className="pointer-events-none absolute inset-0">
        <div className="pointer-events-auto absolute left-4 right-4 top-4 rounded-xl border border-zinc-700/80 bg-zinc-950/80 p-3 backdrop-blur">
          <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="w-full lg:max-w-xl">
              <MapSearchBar
                defaultValue={locationMeta?.query ?? 'Montreal'}
                loading={status.loading}
                onSearch={handleSearch}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-zinc-200">Theme</label>
              <select
                value={themeName}
                onChange={(event) => setThemeName(event.target.value)}
                className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-white"
              >
                {Object.keys(plannerThemes).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <EditorToolbar
            tool={tool}
            onToolChange={setTool}
            onCreate={handleCreate}
            onDelete={deleteSelectedEntity}
            onUndo={undo}
            onRedo={redo}
            canUndo={history.past.length > 0}
            canRedo={history.future.length > 0}
            hasSelection={Boolean(selectedEntity)}
          />

          {(status.message || status.error) && (
            <div
              className={`mt-3 rounded-md px-2.5 py-2 text-xs ${
                status.error ? 'bg-rose-500/10 text-rose-200' : 'bg-sky-500/10 text-sky-200'
              }`}
            >
              {status.error ? `${status.error} ${status.message}` : status.message}
            </div>
          )}
        </div>

        <div className="pointer-events-auto absolute bottom-4 left-4 w-56 space-y-3">
          <LayerPanel layers={layers} entities={entities} onLayerChange={setLayerVisibility} />
        </div>

        <div className="pointer-events-auto absolute bottom-4 right-4 w-64 space-y-3">
          <InspectorPanel selectedEntity={selectedEntity} onStyleUpdate={updateSelectedStyle} />
          <SaveLoadPanel
            onSave={handleSave}
            onLoad={handleLoad}
            onExport={handleExport}
            onImport={() => fileInputRef.current?.click()}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={handleImport}
          />
        </div>
      </div>
    </div>
  )
}
