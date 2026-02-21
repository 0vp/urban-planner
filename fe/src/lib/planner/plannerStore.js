import { create } from 'zustand'
import { createEntityTemplate, createMontrealSeed } from './sampleData'
import { loadPlannerState, makeSnapshot, savePlannerState } from './serialize'
import { defaultThemeName } from './theme'

const HISTORY_LIMIT = 40

function deepClone(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }

  return JSON.parse(JSON.stringify(value))
}

function stateForHistory(state) {
  return {
    entities: deepClone(state.entities),
    locationMeta: deepClone(state.locationMeta),
    layers: deepClone(state.layers),
    selectedEntityId: state.selectedEntityId,
  }
}

function applyHistorySnapshot(state, snapshot) {
  return {
    ...state,
    entities: deepClone(snapshot.entities),
    locationMeta: deepClone(snapshot.locationMeta),
    layers: deepClone(snapshot.layers),
    selectedEntityId: snapshot.selectedEntityId,
  }
}

function pushHistoryEntry(state) {
  const nextPast = [...state.history.past, stateForHistory(state)]
  if (nextPast.length > HISTORY_LIMIT) {
    nextPast.shift()
  }

  return {
    past: nextPast,
    future: [],
  }
}

function withHistory(state, updates) {
  return {
    ...state,
    ...updates,
    history: pushHistoryEntry(state),
  }
}

const persisted = loadPlannerState()
const seed = createMontrealSeed()

const initialState = {
  entities: persisted?.entities ?? seed.entities,
  locationMeta: persisted?.locationMeta ?? seed.locationMeta,
  selectedEntityId: null,
  hoveredEntityId: null,
  themeName: persisted?.themeName ?? defaultThemeName,
  tool: 'select',
  layers: persisted?.layers ?? {
    building: true,
    road: true,
    river: true,
    park: true,
  },
  status: {
    loading: false,
    message: '',
    error: '',
  },
  history: {
    past: [],
    future: [],
  },
}

export const usePlannerStore = create((set, get) => ({
  ...initialState,

  setTool: (tool) => set({ tool }),

  setThemeName: (themeName) => set({ themeName }),

  setHoveredEntityId: (hoveredEntityId) => set({ hoveredEntityId }),

  selectEntity: (selectedEntityId) => set({ selectedEntityId }),

  clearSelection: () => set({ selectedEntityId: null }),

  setLayerVisibility: (layerType, visible) =>
    set((state) => ({
      layers: {
        ...state.layers,
        [layerType]: visible,
      },
    })),

  setStatus: (statusPatch) =>
    set((state) => ({
      status: {
        ...state.status,
        ...statusPatch,
      },
    })),

  replaceAllEntities: ({ entities, locationMeta }) =>
    set((state) => {
      const sortedEntities = deepClone(entities)
      return withHistory(state, {
        entities: sortedEntities,
        locationMeta,
        selectedEntityId: null,
      })
    }),

  addEntity: (type, options = {}) =>
    set((state) => {
      const template = createEntityTemplate(type)
      const position = options.position ?? [0, 0, 0]
      const nextEntity = {
        ...template,
        transform: {
          ...template.transform,
          position,
        },
      }

      return withHistory(state, {
        entities: [...state.entities, nextEntity],
        selectedEntityId: nextEntity.id,
      })
    }),

  deleteSelectedEntity: () =>
    set((state) => {
      if (!state.selectedEntityId) {
        return state
      }

      return withHistory(state, {
        entities: state.entities.filter((entity) => entity.id !== state.selectedEntityId),
        selectedEntityId: null,
      })
    }),

  updateEntityTransform: (id, transformPatch) =>
    set((state) => ({
      entities: state.entities.map((entity) => {
        if (entity.id !== id) {
          return entity
        }

        return {
          ...entity,
          transform: {
            ...entity.transform,
            ...transformPatch,
          },
        }
      }),
    })),

  beginTransformChange: () =>
    set((state) => ({
      history: pushHistoryEntry(state),
    })),

  updateSelectedStyle: (stylePatch) =>
    set((state) => {
      if (!state.selectedEntityId) {
        return state
      }

      return withHistory(state, {
        entities: state.entities.map((entity) => {
          if (entity.id !== state.selectedEntityId) {
            return entity
          }

          return {
            ...entity,
            style: {
              ...entity.style,
              ...stylePatch,
            },
          }
        }),
      })
    }),

  undo: () =>
    set((state) => {
      if (!state.history.past.length) {
        return state
      }

      const previous = state.history.past[state.history.past.length - 1]
      const nextPast = state.history.past.slice(0, -1)
      const nextFuture = [stateForHistory(state), ...state.history.future]

      const restored = applyHistorySnapshot(state, previous)
      return {
        ...restored,
        history: {
          past: nextPast,
          future: nextFuture,
        },
      }
    }),

  redo: () =>
    set((state) => {
      if (!state.history.future.length) {
        return state
      }

      const [next, ...remainingFuture] = state.history.future
      const nextPast = [...state.history.past, stateForHistory(state)]
      const restored = applyHistorySnapshot(state, next)

      return {
        ...restored,
        history: {
          past: nextPast,
          future: remainingFuture,
        },
      }
    }),

  saveToBrowser: () => {
    const state = get()
    const snapshot = makeSnapshot(state)
    return savePlannerState(snapshot)
  },

  loadFromBrowser: () => {
    const loaded = loadPlannerState()
    if (!loaded) {
      return false
    }

    set((state) =>
      withHistory(state, {
        entities: loaded.entities ?? state.entities,
        locationMeta: loaded.locationMeta ?? state.locationMeta,
        layers: loaded.layers ?? state.layers,
        themeName: loaded.themeName ?? state.themeName,
      }),
    )

    return true
  },

  importSnapshot: (snapshot) =>
    set((state) =>
      withHistory(state, {
        entities: snapshot.entities ?? state.entities,
        locationMeta: snapshot.locationMeta ?? state.locationMeta,
        layers: snapshot.layers ?? state.layers,
        themeName: snapshot.themeName ?? state.themeName,
        selectedEntityId: null,
      }),
    ),
}))
