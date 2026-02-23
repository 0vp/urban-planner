import { MAX_FETCH_RADIUS_METERS, MIN_FETCH_RADIUS_METERS } from './constants'
import { AgentSidebar } from './AgentSidebar'
import { PlannerSidebar } from './PlannerSidebar'

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
    <div className="fixed inset-0 bg-[#0D0D0D] text-[#8b8b8b] overflow-hidden pointer-events-none">
      <div
        ref={mountRef}
        className="absolute inset-0 z-0 pointer-events-auto"
        style={{ cursor: moveMode ? 'default' : 'grab' }}
      />

      <div className="absolute top-5 left-1/2 -translate-x-1/2 z-20 pointer-events-none flex justify-center w-full px-5">
        <div className="w-full max-w-[1120px] h-14 rounded-[15px] border border-[#2A2A2A] bg-[#141414]/90 shadow-2xl backdrop-blur-md px-4 flex items-center gap-3 pointer-events-auto">
          <form className="flex items-center gap-3 w-full" onSubmit={handleSearchSubmit}>
            <input
              value={locationInput}
              onChange={(event) => setLocationInput(event.target.value)}
              placeholder="Search location (e.g., Montreal)"
              className="flex-1 h-9 rounded-lg border border-[#2A2A2A] bg-[#0D0D0D] px-3 text-sm text-[#E0E0E0] outline-none focus:border-[#555555] transition-colors placeholder:text-[#666666]"
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
              className="w-28 h-9 rounded-lg border border-[#2A2A2A] bg-[#0D0D0D] px-3 text-sm text-[#E0E0E0] outline-none focus:border-[#555555] transition-colors placeholder:text-[#666666]"
            />
            <div className="h-5 w-px bg-[#2A2A2A] mx-1" />
            <button
              type="submit"
              disabled={isLoading}
              className="h-9 px-4 rounded-lg bg-[#E0E0E0] text-[#0D0D0D] font-medium hover:bg-white disabled:opacity-50 transition-colors text-sm"
            >
              Search
            </button>
            <button
              type="button"
              disabled={isLoading}
              onClick={() => handleSearchAndLoad(defaultLocation, searchRadiusInput)}
              className="h-9 px-4 rounded-lg bg-[#2A2A2A] text-[#E0E0E0] hover:bg-[#333333] disabled:opacity-50 transition-colors text-sm font-medium"
            >
              Montreal
            </button>
            <button
              type="button"
              disabled={isSaving || isLoading}
              onClick={handleSave}
              className="h-9 px-4 rounded-lg bg-[#333333] text-[#E0E0E0] hover:bg-[#444444] disabled:opacity-50 transition-colors text-sm font-medium ml-auto"
            >
              Save
            </button>
          </form>
        </div>
      </div>

      <PlannerSidebar
        activeLocation={activeLocation}
        entityType={entityType}
        setEntityType={setEntityType}
        handleCreate={handleCreate}
        handleEdit={handleEdit}
        handleDelete={handleDelete}
        moveMode={moveMode}
        setMoveMode={setMoveMode}
        setMoveSrcCoord={setMoveSrcCoord}
        setStatus={setStatus}
        features={features}
        activeRadiusMeters={activeRadiusMeters}
        selectedFeatureId={selectedFeatureId}
        isDirty={isDirty}
        i3sFailed={i3sFailed}
        i3sReady={i3sReady}
        buildingMods={buildingMods}
        selectedBuildingAttrs={selectedBuildingAttrs}
        status={status}
      />

      <AgentSidebar setStatus={setStatus} />
    </div>
  )
}
