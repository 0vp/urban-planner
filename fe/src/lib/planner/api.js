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
