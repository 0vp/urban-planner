const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

function linkAbortSignal(sourceSignal, targetController) {
  if (!sourceSignal) {
    return () => {}
  }
  if (sourceSignal.aborted) {
    targetController.abort(sourceSignal.reason)
    return () => {}
  }
  const onAbort = () => targetController.abort(sourceSignal.reason)
  sourceSignal.addEventListener('abort', onAbort, { once: true })
  return () => sourceSignal.removeEventListener('abort', onAbort)
}

async function fetchJson(url, {
  method = 'GET',
  headers,
  body,
  signal,
  timeoutMs = 8000,
  errorPrefix = 'Request failed',
} = {}) {
  const timeoutController = new AbortController()
  const timeoutId = setTimeout(() => {
    timeoutController.abort()
  }, timeoutMs)

  const requestController = new AbortController()
  const detachExternalAbort = linkAbortSignal(signal, requestController)
  const detachTimeoutAbort = linkAbortSignal(timeoutController.signal, requestController)

  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: requestController.signal,
    })

    if (!response.ok) {
      throw new Error(`${errorPrefix} (${response.status})`)
    }

    return await response.json()
  } catch (error) {
    if (timeoutController.signal.aborted && !signal?.aborted) {
      throw new Error(`${errorPrefix} (timeout)`)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
    detachExternalAbort()
    detachTimeoutAbort()
  }
}

export async function fetchPlannerMap(location, options = {}) {
  return fetchJson(
    `${API_BASE_URL}/api/planner/map?location=${encodeURIComponent(location)}`,
    {
      signal: options.signal,
      timeoutMs: options.timeoutMs ?? 5000,
      errorPrefix: 'Failed to load planner map',
    },
  )
}

export async function savePlannerMap(payload, options = {}) {
  return fetchJson(`${API_BASE_URL}/api/planner/map`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? 10000,
    errorPrefix: 'Failed to save planner map',
  })
}

export async function fetchFallbackRoads({ center, radiusMeters, signal }) {
  const [lon, lat] = Array.isArray(center) ? center : []
  const url = new URL(`${API_BASE_URL}/api/planner/osm/roads`)
  url.searchParams.set('lon', String(lon))
  url.searchParams.set('lat', String(lat))
  url.searchParams.set('radius_meters', String(radiusMeters))

  const data = await fetchJson(url.toString(), {
    signal,
    timeoutMs: 7000,
    errorPrefix: 'Failed to load fallback roads',
  })
  return Array.isArray(data?.features) ? data.features : []
}

export function buildAgentWebSocketUrl() {
  const baseUrl = new URL(API_BASE_URL)
  baseUrl.protocol = baseUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  baseUrl.pathname = '/api/agent/ws'
  baseUrl.search = ''
  return baseUrl.toString()
}
