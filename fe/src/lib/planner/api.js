const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

export async function fetchPlannerMap(location) {
  const response = await fetch(
    `${API_BASE_URL}/api/planner/map?location=${encodeURIComponent(location)}`,
  )

  if (!response.ok) {
    throw new Error(`Failed to load planner map (${response.status})`)
  }

  return response.json()
}

export async function savePlannerMap(payload) {
  const response = await fetch(`${API_BASE_URL}/api/planner/map`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`Failed to save planner map (${response.status})`)
  }

  return response.json()
}

export async function fetchFallbackRoads({ center, radiusMeters }) {
  const [lon, lat] = Array.isArray(center) ? center : []
  const url = new URL(`${API_BASE_URL}/api/planner/osm/roads`)
  url.searchParams.set('lon', String(lon))
  url.searchParams.set('lat', String(lat))
  url.searchParams.set('radius_meters', String(radiusMeters))

  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error(`Failed to load fallback roads (${response.status})`)
  }

  const data = await response.json()
  return Array.isArray(data?.features) ? data.features : []
}
