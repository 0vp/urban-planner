const layerItems = [
  { type: 'building', label: 'Buildings' },
  { type: 'road', label: 'Roads' },
  { type: 'river', label: 'Rivers' },
  { type: 'park', label: 'Parks' },
]

export function LayerPanel({ layers, entities, onLayerChange }) {
  const counts = layerItems.reduce((accumulator, layer) => {
    accumulator[layer.type] = entities.filter((entity) => entity.type === layer.type).length
    return accumulator
  }, {})

  return (
    <div className="rounded-xl border border-zinc-700/80 bg-zinc-900/90 p-3 backdrop-blur">
      <h3 className="mb-3 text-sm font-semibold text-white">Layers</h3>
      <div className="space-y-2">
        {layerItems.map((item) => (
          <label key={item.type} className="flex items-center justify-between gap-3 text-xs text-zinc-200">
            <span className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={Boolean(layers[item.type])}
                onChange={(event) => onLayerChange(item.type, event.target.checked)}
                className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800"
              />
              {item.label}
            </span>
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-300">{counts[item.type] ?? 0}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
