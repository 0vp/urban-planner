const STORAGE_KEY = 'urban-planner-v1'

function getStorage() {
  if (typeof window === 'undefined') {
    return null
  }

  return window.localStorage
}

export function getPlannerStorageKey() {
  return STORAGE_KEY
}

export function savePlannerState(snapshot) {
  const storage = getStorage()
  if (!storage) {
    return false
  }

  storage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  return true
}

export function loadPlannerState() {
  const storage = getStorage()
  if (!storage) {
    return null
  }

  const raw = storage.getItem(STORAGE_KEY)
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function makeSnapshot(state) {
  return {
    version: 1,
    savedAt: Date.now(),
    themeName: state.themeName,
    layers: state.layers,
    entities: state.entities,
    locationMeta: state.locationMeta,
  }
}

export function toDownloadData(state) {
  return JSON.stringify(makeSnapshot(state), null, 2)
}
