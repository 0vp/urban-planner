import { useEffect, useState } from 'react'

export function MapSearchBar({ defaultValue = 'Montreal', loading, onSearch }) {
  const [query, setQuery] = useState(defaultValue)

  useEffect(() => {
    setQuery(defaultValue)
  }, [defaultValue])

  function handleSubmit(event) {
    event.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) {
      return
    }

    onSearch(trimmed)
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full gap-2">
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search location (e.g. Montreal)"
        className="w-full rounded-md border border-zinc-700 bg-zinc-900/90 px-3 py-2 text-sm text-white outline-none ring-sky-400/60 focus:ring"
      />
      <button
        type="submit"
        disabled={loading}
        className="rounded-md bg-sky-500 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? 'Loading...' : 'Load'}
      </button>
    </form>
  )
}
