export function SaveLoadPanel({ onSave, onLoad, onExport, onImport }) {
  function ActionButton({ onClick, children }) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded-md border border-zinc-700 bg-zinc-900/90 px-2.5 py-1.5 text-xs text-zinc-100 transition-colors hover:border-zinc-500 hover:text-white"
      >
        {children}
      </button>
    )
  }

  return (
    <div className="rounded-xl border border-zinc-700/80 bg-zinc-900/90 p-3 backdrop-blur">
      <h3 className="mb-3 text-sm font-semibold text-white">Persistence</h3>
      <div className="grid grid-cols-2 gap-2">
        <ActionButton onClick={onSave}>Save</ActionButton>
        <ActionButton onClick={onLoad}>Load</ActionButton>
        <ActionButton onClick={onExport}>Export</ActionButton>
        <ActionButton onClick={onImport}>Import</ActionButton>
      </div>
    </div>
  )
}
