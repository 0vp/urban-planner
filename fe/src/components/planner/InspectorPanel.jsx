export function InspectorPanel({ selectedEntity, onStyleUpdate }) {
  if (!selectedEntity) {
    return (
      <div className="rounded-xl border border-zinc-700/80 bg-zinc-900/90 p-3 backdrop-blur">
        <h3 className="mb-2 text-sm font-semibold text-white">Inspector</h3>
        <p className="text-xs text-zinc-400">Select an entity to edit its properties.</p>
      </div>
    )
  }

  const { style, type } = selectedEntity

  return (
    <div className="rounded-xl border border-zinc-700/80 bg-zinc-900/90 p-3 backdrop-blur">
      <h3 className="mb-3 text-sm font-semibold text-white">Inspector</h3>
      <div className="space-y-2 text-xs text-zinc-200">
        <div className="rounded bg-zinc-800/80 px-2 py-1 text-zinc-300">{type.toUpperCase()}</div>
        {type === 'building' && (
          <label className="flex flex-col gap-1">
            Height
            <input
              type="range"
              min="6"
              max="100"
              step="1"
              value={Math.round(style.height ?? 20)}
              onChange={(event) => onStyleUpdate({ height: Number(event.target.value) })}
            />
          </label>
        )}
        {(type === 'road' || type === 'river') && (
          <label className="flex flex-col gap-1">
            Width
            <input
              type="range"
              min="2"
              max="30"
              step="1"
              value={Math.round(style.width ?? 8)}
              onChange={(event) => onStyleUpdate({ width: Number(event.target.value) })}
            />
          </label>
        )}
        {type === 'park' && (
          <label className="flex flex-col gap-1">
            Elevation
            <input
              type="range"
              min="0.1"
              max="4"
              step="0.1"
              value={style.height ?? 0.5}
              onChange={(event) => onStyleUpdate({ height: Number(event.target.value) })}
            />
          </label>
        )}
      </div>
    </div>
  )
}
