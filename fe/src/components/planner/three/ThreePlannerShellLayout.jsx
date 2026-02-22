import {
  ENTITY_OPTIONS,
  MAX_FETCH_RADIUS_METERS,
  MIN_FETCH_RADIUS_METERS,
  SELECT_HINT,
} from './constants'

export function ThreePlannerShellLayout({
  mountRef,
  locationInput,
  setLocationInput,
  searchRadiusInput,
  setSearchRadiusInput,
  isLoading,
  handleSearchSubmit,
  handleSearchAndLoad,
  isSaving,
  handleSave,
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
  defaultLocation,
}) {
  return (
    <div className="fixed top-16 left-0 right-0 bottom-0 bg-zinc-950 text-zinc-100">
      <div className="absolute top-0 left-0 right-0 h-14 z-20 border-b border-zinc-800 bg-zinc-900/95 backdrop-blur px-4 flex items-center gap-2">
        <form className="flex items-center gap-2 w-full" onSubmit={handleSearchSubmit}>
          <input
            value={locationInput}
            onChange={(event) => setLocationInput(event.target.value)}
            placeholder="Search location (e.g., Montreal)"
            className="flex-1 h-9 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm outline-none focus:border-zinc-500"
          />
          <input
            type="number"
            min={MIN_FETCH_RADIUS_METERS}
            max={MAX_FETCH_RADIUS_METERS}
            step={100}
            value={searchRadiusInput}
            onChange={(event) => setSearchRadiusInput(event.target.value)}
            placeholder="Radius (m)"
            title="Fetch/render radius (meters)"
            className="w-28 h-9 rounded-md border border-zinc-700 bg-zinc-950 px-2 text-sm outline-none focus:border-zinc-500"
          />
          <button
            type="submit"
            disabled={isLoading}
            className="h-9 px-3 rounded-md bg-zinc-700 hover:bg-zinc-600 disabled:opacity-60 text-sm"
          >
            Search
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={() => handleSearchAndLoad(defaultLocation, searchRadiusInput)}
            className="h-9 px-3 rounded-md bg-zinc-800 hover:bg-zinc-700 disabled:opacity-60 text-sm"
          >
            Montreal
          </button>
          <button
            type="button"
            disabled={isSaving || isLoading}
            onClick={handleSave}
            className="h-9 px-3 rounded-md bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 text-sm"
          >
            Save
          </button>
        </form>
      </div>

      <div className="absolute top-14 left-0 bottom-0 w-72 z-10 border-r border-zinc-800 bg-zinc-900/95 backdrop-blur p-4 space-y-4 overflow-y-auto">
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-400">Active location</p>
          <p className="text-sm mt-1 break-words">{activeLocation}</p>
        </div>

        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wide text-zinc-400 block" htmlFor="entityType">
            Entity type
          </label>
          <select
            id="entityType"
            value={entityType}
            onChange={(event) => setEntityType(event.target.value)}
            className="w-full h-9 rounded-md border border-zinc-700 bg-zinc-950 px-2 text-sm"
          >
            {ENTITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 gap-2">
          <button
            type="button"
            onClick={handleCreate}
            className="h-9 rounded-md bg-indigo-700 hover:bg-indigo-600 text-sm"
          >
            Create
          </button>
          <button
            type="button"
            onClick={handleEdit}
            className="h-9 rounded-md bg-zinc-700 hover:bg-zinc-600 text-sm"
          >
            Edit / Move
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="h-9 rounded-md bg-rose-700 hover:bg-rose-600 text-sm"
          >
            Delete
          </button>
        </div>

        {moveMode && (
          <div className="rounded-md border border-amber-700 bg-amber-950/50 p-3 text-xs text-amber-300 leading-relaxed">
            <p>Move mode active. Click a destination on the map or press Escape to cancel.</p>
            <button
              type="button"
              onClick={() => {
                setMoveMode(false)
                setMoveSrcCoord(null)
                setStatus(SELECT_HINT)
              }}
              className="mt-2 h-7 px-2 rounded bg-amber-800 hover:bg-amber-700 text-xs"
            >
              Cancel Move
            </button>
          </div>
        )}

        <div className="space-y-1 text-sm text-zinc-300">
          <p>Features: {features.length}</p>
          <p>Radius: {activeRadiusMeters}m</p>
          <p>Selected: {selectedFeatureId ? String(selectedFeatureId).slice(0, 22) : 'none'}</p>
          <p>Status: {isDirty ? 'Unsaved changes' : 'Saved'}</p>
          <p>I3S: {i3sFailed ? 'failed' : i3sReady ? 'mesh loaded' : 'loading'}</p>
          <p>I3S mods: {buildingMods.size}</p>
        </div>

        {selectedBuildingAttrs && (
          <div className="rounded-md border border-zinc-800 bg-zinc-950/70 p-3 text-xs text-zinc-300 leading-relaxed space-y-1">
            <p className="text-zinc-400 uppercase tracking-wide">Building attributes</p>
            {Object.entries(selectedBuildingAttrs).map(([key, val]) =>
              val ? <p key={key}><span className="text-zinc-500">{key}:</span> {val}</p> : null
            )}
          </div>
        )}

        <div className="rounded-md border border-zinc-800 bg-zinc-950/70 p-3 text-xs text-zinc-300 leading-relaxed">
          <p>{status}</p>
        </div>
      </div>

      <div className="absolute top-14 left-72 right-0 bottom-0">
        <div
          ref={mountRef}
          className="absolute inset-0"
          style={{ cursor: moveMode ? 'crosshair' : 'grab' }}
        />
      </div>
    </div>
  )
}
