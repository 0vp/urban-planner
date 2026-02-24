import { useState } from 'react'
import { ENTITY_OPTIONS, SELECT_HINT } from './constants'
import { SimulationPanel } from './SimulationPanel'

export function PlannerSidebar({
  activeLocation,
  entityType,
  setEntityType,
  handleCreate,
  handleEdit,
  handleDelete,
  moveMode,
  setMoveMode,
  setMoveSrcCoord,
  setStatus,
  features,
  activeRadiusMeters,
  selectedFeatureId,
  isDirty,
  i3sFailed,
  i3sReady,
  buildingMods,
  selectedBuildingAttrs,
  status,
  lassoActive,
  setLassoActive,
  lassoPolygon,
  clearLasso,
  center,
  simulationResults,
  setSimulationResults,
  onTrafficResult,
  onWindResult,
  onSunResult,
  onClearOverlays,
}) {
  const [isCollapsed, setIsCollapsed] = useState(true)

  return (
    <div
      aria-label="Planner Sidebar"
      className={`absolute top-24 left-5 bottom-5 z-30 rounded-[15px] border border-[#2A2A2A] bg-[#141414]/90 shadow-2xl backdrop-blur-md flex flex-col pointer-events-auto transition-all duration-300 ease-in-out overflow-hidden ${isCollapsed ? 'w-16 p-3 items-center gap-4' : 'w-80 p-5 gap-6'}`}
    >
      {isCollapsed ? (
        <div className="flex flex-col gap-4 w-full items-center mt-2 overflow-visible animate-[fadeIn_300ms_ease-in]">
          <div className="group relative">
            <button onClick={() => setIsCollapsed(false)} className="p-2 rounded-lg hover:bg-[#2A2A2A] text-[#8b8b8b] hover:text-[#E0E0E0] transition-colors">
              <i className="fa-solid fa-location-dot text-lg"></i>
            </button>
            <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-2 py-1 bg-[#2A2A2A] text-[#E0E0E0] text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
              Location: {activeLocation}
            </div>
          </div>

          <div className="group relative">
            <button onClick={() => setIsCollapsed(false)} className="p-2 rounded-lg hover:bg-[#2A2A2A] text-[#8b8b8b] hover:text-[#E0E0E0] transition-colors">
              <i className="fa-solid fa-layer-group text-lg"></i>
            </button>
            <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-2 py-1 bg-[#2A2A2A] text-[#E0E0E0] text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
              Entity: {ENTITY_OPTIONS.find((option) => option.value === entityType)?.label || entityType}
            </div>
          </div>

          <div className="group relative">
            <button
              onClick={() => { setLassoActive?.(!lassoActive); if (lassoActive) clearLasso?.() }}
              className={`p-2 rounded-lg hover:bg-[#2A2A2A] transition-colors ${lassoActive ? 'text-[#ff66aa] bg-[#2A2A2A]' : 'text-[#8b8b8b] hover:text-[#E0E0E0]'}`}
            >
              <i className="fa-solid fa-draw-polygon text-lg"></i>
            </button>
            <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-2 py-1 bg-[#2A2A2A] text-[#E0E0E0] text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
              {lassoActive ? 'Cancel Lasso' : lassoPolygon ? 'Lasso Active (click to clear)' : 'Lasso Select Area'}
            </div>
          </div>

          <div className="w-8 h-px bg-[#2A2A2A] my-1" />

          <div className="group relative">
            <button onClick={handleCreate} className="p-2 rounded-lg hover:bg-[#2A2A2A] text-[#8b8b8b] hover:text-[#E0E0E0] transition-colors">
              <i className="fa-solid fa-plus text-lg"></i>
            </button>
            <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-2 py-1 bg-[#2A2A2A] text-[#E0E0E0] text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
              Create
            </div>
          </div>

          <div className="group relative">
            <button onClick={handleEdit} className="p-2 rounded-lg hover:bg-[#2A2A2A] text-[#8b8b8b] hover:text-[#E0E0E0] transition-colors">
              <i className="fa-solid fa-pen text-lg"></i>
            </button>
            <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-2 py-1 bg-[#2A2A2A] text-[#E0E0E0] text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
              Edit / Move
            </div>
          </div>

          <div className="group relative">
            <button onClick={handleDelete} className="p-2 rounded-lg hover:bg-[#2A2A2A] text-[#8b8b8b] hover:text-[#E0E0E0] transition-colors">
              <i className="fa-solid fa-trash text-lg"></i>
            </button>
            <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-2 py-1 bg-[#2A2A2A] text-[#E0E0E0] text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
              Delete Selected
            </div>
          </div>

          <div className="w-8 h-px bg-[#2A2A2A] my-1" />

          <div className="group relative">
            <button onClick={() => setIsCollapsed(false)} className="p-2 rounded-lg hover:bg-[#2A2A2A] text-[#8b8b8b] hover:text-[#E0E0E0] transition-colors">
              <i className="fa-solid fa-chart-bar text-lg"></i>
            </button>
            <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-2 py-1 bg-[#2A2A2A] text-[#E0E0E0] text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
              Stats ({features.length} features)
            </div>
          </div>

          <SimulationPanel
            center={center}
            features={features}
            lassoPolygon={lassoPolygon}
            onTrafficResult={onTrafficResult}
            onWindResult={onWindResult}
            onSunResult={onSunResult}
            onClearOverlays={onClearOverlays}
            setStatus={setStatus}
            setSimulationResults={setSimulationResults}
          />

          {selectedBuildingAttrs && (
            <div className="group relative">
              <button onClick={() => setIsCollapsed(false)} className="p-2 rounded-lg hover:bg-[#2A2A2A] text-[#8b8b8b] hover:text-[#E0E0E0] transition-colors">
                <i className="fa-solid fa-building text-lg"></i>
              </button>
              <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-2 py-1 bg-[#2A2A2A] text-[#E0E0E0] text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                Building Attributes
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar flex flex-col gap-6 animate-[fadeIn_300ms_ease-in]">
          <div>
            <h2 className="text-[10px] font-semibold uppercase tracking-widest text-[#666666] mb-1.5">Planner Controls</h2>
            <p className="text-sm font-medium text-[#E0E0E0] break-words leading-snug">{activeLocation}</p>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-[#666666] block" htmlFor="entityType">
              Entity Type
            </label>
            <select
              id="entityType"
              value={entityType}
              onChange={(event) => setEntityType(event.target.value)}
              className="w-full h-9 rounded-lg border border-[#2A2A2A] bg-[#0D0D0D] px-3 text-sm text-[#E0E0E0] outline-none focus:border-[#555555] transition-colors"
            >
              {ENTITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <h2 className="text-[10px] font-semibold uppercase tracking-widest text-[#666666] mb-1.5">Actions</h2>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleCreate}
                className="h-9 rounded-lg bg-[#2A2A2A] text-[#E0E0E0] border border-[#333333] hover:bg-[#333333] hover:border-[#444444] transition-colors text-sm font-medium"
              >
                Create
              </button>
              <button
                type="button"
                onClick={handleEdit}
                className="h-9 rounded-lg bg-[#2A2A2A] text-[#E0E0E0] border border-[#333333] hover:bg-[#333333] hover:border-[#444444] transition-colors text-sm font-medium"
              >
                Edit / Move
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="col-span-2 h-9 rounded-lg bg-[#2A2A2A] text-[#E0E0E0] border border-[#333333] hover:bg-[#333333] hover:border-[#444444] transition-colors text-sm font-medium"
              >
                Delete Selected
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-[10px] font-semibold uppercase tracking-widest text-[#666666] mb-1.5">Selection</h2>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => { setLassoActive?.(!lassoActive); if (lassoActive) clearLasso?.() }}
                className={`h-9 rounded-lg border transition-colors text-sm font-medium ${lassoActive ? 'bg-[#ff66aa]/20 text-[#ff66aa] border-[#ff66aa]/40' : 'bg-[#2A2A2A] text-[#E0E0E0] border-[#333333] hover:bg-[#333333] hover:border-[#444444]'}`}
              >
                <i className="fa-solid fa-draw-polygon mr-1.5"></i>
                {lassoActive ? 'Drawing...' : 'Lasso'}
              </button>
              <button
                type="button"
                onClick={() => clearLasso?.()}
                disabled={!lassoPolygon}
                className="h-9 rounded-lg bg-[#2A2A2A] text-[#E0E0E0] border border-[#333333] hover:bg-[#333333] hover:border-[#444444] disabled:opacity-30 transition-colors text-sm font-medium"
              >
                Clear Lasso
              </button>
            </div>
            {lassoPolygon && (
              <div className="text-[10px] text-[#8b8b8b]">
                <i className="fa-solid fa-draw-polygon text-[#ff66aa] mr-1"></i>
                Lasso area selected ({lassoPolygon.length} points)
              </div>
            )}
            {lassoActive && (
              <div className="text-[10px] text-[#8b8b8b]">
                Click to add points. Double-click or click near start to close. Esc to cancel.
              </div>
            )}
          </div>

          <div className="space-y-2">
            <SimulationPanel
              center={center}
              features={features}
              lassoPolygon={lassoPolygon}
              onTrafficResult={onTrafficResult}
              onWindResult={onWindResult}
              onSunResult={onSunResult}
              onClearOverlays={onClearOverlays}
              setStatus={setStatus}
              setSimulationResults={setSimulationResults}
            />
          </div>

          {moveMode && (
            <div className="rounded-xl border border-[#555555] bg-[#2A2A2A] p-3.5 text-xs text-[#E0E0E0] leading-relaxed shadow-inner">
              <p className="mb-2.5">Move mode active. Click a destination on the map or press Escape to cancel.</p>
              <button
                type="button"
                onClick={() => {
                  setMoveMode(false)
                  setMoveSrcCoord(null)
                  setStatus(SELECT_HINT)
                }}
                className="w-full h-8 rounded-lg bg-[#333333] hover:bg-[#444444] border border-[#555555] transition-colors text-xs font-medium"
              >
                Cancel Move
              </button>
            </div>
          )}

          <div className="space-y-2">
            <h2 className="text-[10px] font-semibold uppercase tracking-widest text-[#666666] mb-1.5">Scene Stats</h2>
            <div className="rounded-xl border border-[#2A2A2A] bg-[#0D0D0D]/50 p-3.5 space-y-2 text-xs text-[#8b8b8b]">
              <div className="flex justify-between"><span className="text-[#666666]">Features</span><span className="text-[#E0E0E0] font-medium">{features.length}</span></div>
              <div className="flex justify-between"><span className="text-[#666666]">Radius</span><span className="text-[#E0E0E0] font-medium">{activeRadiusMeters}m</span></div>
              <div className="flex justify-between"><span className="text-[#666666]">Selected</span><span className="text-[#E0E0E0] font-medium truncate max-w-[120px] text-right">{selectedFeatureId ? String(selectedFeatureId) : 'none'}</span></div>
              <div className="flex justify-between"><span className="text-[#666666]">Status</span><span className="text-[#E0E0E0] font-medium">{isDirty ? 'Unsaved changes' : 'Saved'}</span></div>
              <div className="flex justify-between"><span className="text-[#666666]">I3S Layer</span><span className="text-[#E0E0E0] font-medium">{i3sFailed ? 'Failed' : i3sReady ? 'Loaded' : 'Loading...'}</span></div>
              <div className="flex justify-between"><span className="text-[#666666]">I3S Mods</span><span className="text-[#E0E0E0] font-medium">{buildingMods.size}</span></div>
            </div>
          </div>

          {selectedBuildingAttrs && (
            <div className="space-y-2">
              <h2 className="text-[10px] font-semibold uppercase tracking-widest text-[#666666] mb-1.5">Building Attributes</h2>
              <div className="rounded-xl border border-[#2A2A2A] bg-[#0D0D0D]/50 p-3.5 text-xs text-[#8b8b8b] space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar">
                {Object.entries(selectedBuildingAttrs).map(([key, val]) =>
                  val ? (
                    <div key={key} className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-[#666666] uppercase tracking-wider">{key}</span>
                      <span className="text-[#E0E0E0] font-medium break-words">{val}</span>
                    </div>
                  ) : null
                )}
              </div>
            </div>
          )}

          <div className="mt-auto pt-4">
            <div className="rounded-xl border border-[#2A2A2A] bg-[#0D0D0D]/50 p-3 text-xs text-[#8b8b8b] leading-relaxed text-center">
              {status}
            </div>
          </div>
        </div>
      )}

      <div className={`flex ${isCollapsed ? 'justify-center mt-auto' : 'justify-end mt-2'} w-full`}>
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="h-8 w-8 grid place-items-center rounded-full border border-[#333333] bg-[#1A1A1A] hover:bg-[#242424] text-[#8b8b8b] hover:text-[#E0E0E0] transition-colors"
          title={isCollapsed ? 'Expand Planner Sidebar' : 'Collapse Planner Sidebar'}
          aria-label={isCollapsed ? 'Expand Planner Sidebar' : 'Collapse Planner Sidebar'}
        >
          {isCollapsed ? <i className="fa-solid fa-circle-chevron-right text-sm"></i> : <i className="fa-solid fa-circle-chevron-left text-sm"></i>}
        </button>
      </div>
    </div>
  )
}
