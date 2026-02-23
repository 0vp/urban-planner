const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'
const MEMORY_API_BASE = `${API_BASE_URL.replace(/\/$/, '')}/api/backboard`

async function fetchJson(path, options = {}) {
  const response = await fetch(`${MEMORY_API_BASE}${path}`, options)

  if (!response.ok) {
    let detail = `Request failed (${response.status})`
    try {
      const payload = await response.json()
      if (typeof payload?.detail === 'string') {
        detail = payload.detail
      } else if (payload?.detail) {
        detail = JSON.stringify(payload.detail)
      }
    } catch {
      detail = `Request failed (${response.status})`
    }
    throw new Error(detail)
  }

  if (response.status === 204) {
    return {}
  }
  return response.json()
}

function requireId(value, label) {
  if (!value || value === 'undefined') {
    throw new Error(`${label} is required`)
  }
  return value
}

export const assistantsApi = {
  list: () => fetchJson('/assistants'),
  create: (data) => fetchJson('/assistants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }),
  update: (id, data) => fetchJson(`/assistants/${requireId(id, 'Assistant ID')}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }),
  delete: (id) => fetchJson(`/assistants/${requireId(id, 'Assistant ID')}`, {
    method: 'DELETE',
  }),
  listThreads: (id) => fetchJson(`/assistants/${requireId(id, 'Assistant ID')}/threads`),
  listDocuments: (id) => fetchJson(`/assistants/${requireId(id, 'Assistant ID')}/documents`),
  createThread: (id, data = {}) => fetchJson(`/assistants/${requireId(id, 'Assistant ID')}/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }),
  uploadDocument: (id, file) => {
    const formData = new FormData()
    formData.append('file', file)
    return fetchJson(`/assistants/${requireId(id, 'Assistant ID')}/documents`, {
      method: 'POST',
      body: formData,
    })
  },
}

export const memoriesApi = {
  listForAssistant: (assistantId) => fetchJson(`/assistants/${requireId(assistantId, 'Assistant ID')}/memories`),
  createForAssistant: (assistantId, data) => fetchJson(`/assistants/${requireId(assistantId, 'Assistant ID')}/memories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }),
  updateForAssistant: (assistantId, memoryId, data) => fetchJson(`/assistants/${requireId(assistantId, 'Assistant ID')}/memories/${requireId(memoryId, 'Memory ID')}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }),
  deleteForAssistant: (assistantId, memoryId) => fetchJson(`/assistants/${requireId(assistantId, 'Assistant ID')}/memories/${requireId(memoryId, 'Memory ID')}`, {
    method: 'DELETE',
  }),
}

export const threadsApi = {
  list: () => fetchJson('/threads'),
  delete: (id) => fetchJson(`/threads/${requireId(id, 'Thread ID')}`, {
    method: 'DELETE',
  }),
  listMessages: (id) => fetchJson(`/threads/${requireId(id, 'Thread ID')}/messages`),
  addMessage: (id, data) => fetchJson(`/threads/${requireId(id, 'Thread ID')}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }),
  listDocuments: (id) => fetchJson(`/threads/${requireId(id, 'Thread ID')}/documents`),
  uploadDocument: (id, file) => {
    const formData = new FormData()
    formData.append('file', file)
    return fetchJson(`/threads/${requireId(id, 'Thread ID')}/documents`, {
      method: 'POST',
      body: formData,
    })
  },
}

export const documentsApi = {
  getStatus: (id) => fetchJson(`/documents/${requireId(id, 'Document ID')}/status`),
  delete: (id) => fetchJson(`/documents/${requireId(id, 'Document ID')}`, {
    method: 'DELETE',
  }),
}

export const modelsApi = {
  list: () => fetchJson('/models'),
  listProviders: () => fetchJson('/models/providers'),
  listEmbeddingModels: () => fetchJson('/models/embedding'),
  listEmbeddingProviders: () => fetchJson('/embedding-providers'),
}
