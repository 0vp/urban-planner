const tools = [
  { id: 'select', label: 'Select' },
  { id: 'move', label: 'Move' },
  { id: 'rotate', label: 'Rotate' },
  { id: 'scale', label: 'Scale' },
]

const creators = [
  { id: 'building', label: 'Add Building' },
  { id: 'road', label: 'Add Road' },
  { id: 'river', label: 'Add River' },
  { id: 'park', label: 'Add Park' },
]

function Button({ active, disabled, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
        active
          ? 'border-sky-300 bg-sky-400/20 text-sky-100'
          : 'border-zinc-700 bg-zinc-900/90 text-zinc-200 hover:border-zinc-500 hover:text-white'
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {children}
    </button>
  )
}

export function EditorToolbar({
  tool,
  onToolChange,
  onCreate,
  onDelete,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  hasSelection,
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {tools.map((item) => (
        <Button key={item.id} active={tool === item.id} onClick={() => onToolChange(item.id)}>
          {item.label}
        </Button>
      ))}
      <div className="mx-1 h-5 w-px bg-zinc-700" />
      {creators.map((item) => (
        <Button key={item.id} onClick={() => onCreate(item.id)}>
          {item.label}
        </Button>
      ))}
      <Button disabled={!hasSelection} onClick={onDelete}>
        Delete
      </Button>
      <div className="mx-1 h-5 w-px bg-zinc-700" />
      <Button disabled={!canUndo} onClick={onUndo}>
        Undo
      </Button>
      <Button disabled={!canRedo} onClick={onRedo}>
        Redo
      </Button>
    </div>
  )
}
