import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { buildAgentWebSocketUrl } from '../../../lib/planner/api'

const MAX_CHAT_MESSAGES = 40

function buildAgentMemory({ location }) {
  return JSON.stringify({ location })
}

function parseToolEvent(eventLine) {
  if (typeof eventLine !== 'string') {
    return null
  }

  const match = eventLine.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\((.*)\) -> (.*)$/s)
  if (!match) {
    return null
  }

  const [, name, argsRaw, outputRaw] = match
  let args = null
  let output = outputRaw

  try {
    args = JSON.parse(argsRaw)
  } catch {
    args = null
  }

  if (typeof outputRaw === 'string') {
    const trimmedOutput = outputRaw.trim()
    try {
      output = JSON.parse(trimmedOutput)
    } catch {
      output = trimmedOutput
    }
  }

  return {
    name,
    args,
    output,
    eventLine,
  }
}

function normalizeToolEvent(event) {
  if (typeof event === 'string') {
    const parsed = parseToolEvent(event)
    if (parsed) {
      return parsed
    }
    return {
      name: 'tool',
      args: null,
      output: null,
      eventLine: event,
    }
  }

  const name = typeof event?.name === 'string' ? event.name : 'tool'
  const args = event?.args ?? null
  const output = event?.output ?? null
  const eventLine = typeof event?.eventLine === 'string' && event.eventLine.trim()
    ? event.eventLine
    : `${name}(${stringifyCompact(args ?? {})}) -> ${stringifyCompact(output ?? '')}`

  return {
    name,
    args,
    output,
    eventLine,
  }
}

function deriveTodoItems(toolEvents) {
  let tasks = []
  let completed = new Set()

  for (const eventEntry of toolEvents) {
    const parsed = normalizeToolEvent(eventEntry)

    if (parsed.name === 'create_todo' && Array.isArray(parsed.args?.tasks)) {
      tasks = parsed.args.tasks.map((task) => String(task))
      completed = new Set()
      continue
    }

    if (parsed.name === 'task_done' && Number.isInteger(parsed.args?.task_index)) {
      completed.add(parsed.args.task_index)
    }
  }

  const firstIncomplete = tasks.findIndex((_, index) => !completed.has(index))

  return tasks.map((task, index) => ({
    task,
    status: completed.has(index) ? 'done' : firstIncomplete === index ? 'in_progress' : 'pending',
  }))
}

function stringifyCompact(value) {
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function stringifyPretty(value) {
  if (value == null) {
    return 'null'
  }
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function makeRunMessage(requestId) {
  return {
    role: 'run',
    requestId,
    status: 'running',
    toolEvents: [],
    summary: '',
    rawResponse: '',
    todoItems: [],
  }
}

function getVisibleToolEvents(toolEvents) {
  return (Array.isArray(toolEvents) ? toolEvents : []).filter((toolEvent) => toolEvent?.name !== 'finish')
}

export function AgentSidebar({ setStatus, activeLocation }) {
  const [isAgentCollapsed, setIsAgentCollapsed] = useState(true)
  const [agentPrompt, setAgentPrompt] = useState('')
  const [agentMessages, setAgentMessages] = useState([])
  const [agentConnection, setAgentConnection] = useState('connecting')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const socketRef = useRef(null)

  const appendMessage = useCallback((message) => {
    setAgentMessages((prev) => [...prev, message].slice(-MAX_CHAT_MESSAGES))
  }, [])

  const updateRunMessage = useCallback((requestId, updater) => {
    setAgentMessages((prev) => {
      let found = false
      const next = prev.map((message) => {
        if (message.role === 'run' && message.requestId === requestId) {
          found = true
          return updater(message)
        }
        return message
      })

      if (found) {
        return next
      }

      return [...next, updater(makeRunMessage(requestId))].slice(-MAX_CHAT_MESSAGES)
    })
  }, [])

  useEffect(() => {
    const websocket = new WebSocket(buildAgentWebSocketUrl())
    socketRef.current = websocket
    setAgentConnection('connecting')

    websocket.addEventListener('message', (event) => {
      let payload
      try {
        payload = JSON.parse(event.data)
      } catch {
        return
      }

      if (payload?.type === 'ready') {
        setAgentConnection('ready')
        setStatus('Agent connected.')
        return
      }

      if (payload?.type === 'run_started') {
        const requestId = String(payload?.requestId || '')
        if (!requestId) {
          return
        }
        updateRunMessage(requestId, (run) => ({ ...run, status: 'running' }))
        return
      }

      if (payload?.type === 'tool_event') {
        const requestId = String(payload?.requestId || '')
        if (!requestId) {
          return
        }

        updateRunMessage(requestId, (run) => {
          const nextToolEvents = [...run.toolEvents, normalizeToolEvent(payload)]
          return {
            ...run,
            status: 'running',
            toolEvents: nextToolEvents,
            todoItems: deriveTodoItems(nextToolEvents),
          }
        })
        return
      }

      if (payload?.type === 'result') {
        setIsSubmitting(false)
        const requestId = String(payload?.requestId || '')
        const incomingToolEvents = (Array.isArray(payload?.toolEvents) ? payload.toolEvents : []).map(normalizeToolEvent)

        if (requestId) {
          updateRunMessage(requestId, (run) => {
            const nextToolEvents = incomingToolEvents.length >= run.toolEvents.length ? incomingToolEvents : run.toolEvents
            return {
              ...run,
              status: 'completed',
              toolEvents: nextToolEvents,
              summary: typeof payload?.summary === 'string' ? payload.summary : '',
              rawResponse: typeof payload?.rawResponse === 'string' ? payload.rawResponse : '',
              todoItems: deriveTodoItems(nextToolEvents),
            }
          })
        }

        setStatus('Agent completed request.')
        return
      }

      if (payload?.type === 'error') {
        setIsSubmitting(false)
        setAgentConnection('error')
        const baseError = typeof payload?.error === 'string' ? payload.error : 'Agent request failed.'
        const detail = typeof payload?.details === 'string' && payload.details.trim() ? ` (${payload.details})` : ''
        const text = `${baseError}${detail}`
        appendMessage({ role: 'error', text })
        setStatus(`Agent error: ${text}`)
      }
    })

    websocket.addEventListener('error', () => {
      setIsSubmitting(false)
      setAgentConnection('error')
      setStatus('Agent websocket connection failed.')
    })

    websocket.addEventListener('close', () => {
      if (socketRef.current !== websocket) {
        return
      }
      socketRef.current = null
      setIsSubmitting(false)
      setAgentConnection('disconnected')
      setStatus('Agent websocket disconnected.')
    })

    return () => {
      if (socketRef.current === websocket) {
        socketRef.current = null
      }
      websocket.close()
    }
  }, [appendMessage, setStatus, updateRunMessage])

  const latestRun = [...agentMessages].reverse().find((message) => message.role === 'run')
  const pinnedTodoItems = latestRun?.todoItems || []

  return (
    <div
      aria-label="Agent Sidebar"
      className={`absolute top-24 right-5 bottom-5 z-30 rounded-[15px] border border-[#2A2A2A] bg-[#141414]/90 shadow-2xl backdrop-blur-md flex flex-col pointer-events-auto transition-all duration-300 ease-in-out ${isAgentCollapsed ? 'w-16 p-3 items-center gap-4 overflow-hidden' : 'w-[26rem] p-5 gap-3 overflow-visible'}`}
    >
      {isAgentCollapsed ? (
        <div className="flex flex-col gap-4 w-full items-center mt-2 overflow-visible animate-[fadeIn_300ms_ease-in]">
          <div className="group relative">
            <button onClick={() => setIsAgentCollapsed(false)} className="p-2 rounded-lg hover:bg-[#2A2A2A] text-[#8b8b8b] hover:text-[#E0E0E0] transition-colors">
              <i className="fa-solid fa-robot text-lg"></i>
            </button>
            <div className="absolute right-full mr-3 top-1/2 -translate-y-1/2 px-2 py-1 bg-[#2A2A2A] text-[#E0E0E0] text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
              Agent Sidebar
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col gap-3 animate-[fadeIn_300ms_ease-in]">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[10px] font-semibold uppercase tracking-widest text-[#666666] mb-1">Agent Chat</h2>
              <p className="text-sm font-medium text-[#E0E0E0] leading-snug">Urban Planner</p>
            </div>
            <span className="text-[11px] uppercase tracking-wide text-[#8b8b8b]">{agentConnection}</span>
          </div>

          <div className="flex-1 min-h-0 rounded-xl border border-[#2A2A2A] bg-[#0D0D0D]/60 p-3 text-xs text-[#8b8b8b] flex flex-col gap-2 overflow-y-auto custom-scrollbar">
            {agentMessages.map((message, index) => (
              message.role === 'user' ? (
                <div
                  key={`user-${index}`}
                  className="self-end max-w-[90%] rounded-lg border border-[#333333] bg-[#1A1A1A] px-2.5 py-2 text-[#E0E0E0] whitespace-pre-wrap"
                >
                  {message.text}
                </div>
              ) : message.role === 'error' ? (
                <div
                  key={`error-${index}`}
                  className="self-start max-w-[90%] rounded-lg border border-[#5a2b2b] bg-[#1f1212] px-2.5 py-2 text-[#ffb2b2] whitespace-pre-wrap"
                >
                  {message.text}
                </div>
              ) : (() => {
                const visibleToolEvents = getVisibleToolEvents(message.toolEvents)
                const summaryText = message.summary?.trim() || ''

                return (
                  <Fragment key={`run-${message.requestId || index}`}>
                    {visibleToolEvents.map((toolEvent, toolIndex) => (
                      toolEvent.name === 'message' && typeof toolEvent.args?.text === 'string' ? (
                        <div
                          key={`tool-message-${message.requestId || index}-${toolIndex}`}
                          className="self-start max-w-[90%] rounded-lg border border-[#2A2A2A] bg-[#111111] px-2.5 py-2 text-[#E0E0E0] whitespace-pre-wrap"
                        >
                          {toolEvent.args.text}
                        </div>
                      ) : (
                        <details key={`tool-${message.requestId || index}-${toolIndex}`} className="self-start w-full rounded-md border border-[#252525] bg-[#0c0c0c] px-2 py-1.5">
                          <summary className="list-none cursor-pointer">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-[10px] text-[#6f6f6f] shrink-0">{toolIndex + 1}.</span>
                              <span className="font-mono text-[11px] text-[#9a9a9a] truncate min-w-0 flex-1">{toolEvent.eventLine}</span>
                              <span className="text-[10px] text-[#5f5f5f] shrink-0">expand</span>
                            </div>
                          </summary>
                          <div className="mt-2 grid gap-1 border-t border-[#222222] pt-2">
                            <div className="text-[10px] uppercase tracking-wide text-[#595959]">args</div>
                            <pre className="font-mono text-[11px] leading-relaxed text-[#9a9a9a] whitespace-pre-wrap break-words">{stringifyPretty(toolEvent.args)}</pre>
                            <div className="text-[10px] uppercase tracking-wide text-[#595959]">output</div>
                            <pre className="font-mono text-[11px] leading-relaxed text-[#9a9a9a] whitespace-pre-wrap break-words">{stringifyPretty(toolEvent.output)}</pre>
                          </div>
                        </details>
                      )
                    ))}

                    {summaryText ? (
                      <div className="self-start max-w-[90%] rounded-lg border border-[#2A2A2A] bg-[#111111] px-2.5 py-2 text-[#E0E0E0] whitespace-pre-wrap">
                        {summaryText}
                      </div>
                    ) : null}

                    {visibleToolEvents.length === 0 && !summaryText ? (
                      <div className="self-start text-[#8b8b8b]">Waiting for tool calls...</div>
                    ) : null}
                  </Fragment>
                )
              })()
            ))}

            {isSubmitting && (
              <div className="self-start max-w-[90%] rounded-lg border border-[#2A2A2A] bg-[#111111] px-2.5 py-2 text-[#8b8b8b]">Running agent...</div>
            )}
          </div>

          {pinnedTodoItems.length > 0 && (
            <div className="shrink-0 rounded-xl border border-[#2A2A2A] bg-[#0D0D0D]/65 p-3">
              <div className="text-[10px] uppercase tracking-wide text-[#8b8b8b] mb-2">Todo</div>
              <div className="space-y-1 max-h-24 overflow-y-auto custom-scrollbar">
                {pinnedTodoItems.map((item, index) => (
                  <div key={`pinned-todo-${index}`} className="flex gap-2 text-xs">
                    <span className={item.status === 'done' ? 'text-[#8b8b8b]' : 'text-[#E0E0E0]'}>
                      •
                    </span>
                    <span className={item.status === 'done' ? 'text-[#8b8b8b] line-through decoration-2' : 'text-[#E0E0E0]'}>{item.task}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="shrink-0">
            <div className="rounded-xl border border-[#2A2A2A] bg-[#0D0D0D]/60 p-3">
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  const prompt = agentPrompt.trim()
                  if (!prompt) {
                    setStatus('Type a prompt to send to the agent.')
                    return
                  }

                  const websocket = socketRef.current
                  if (!websocket || websocket.readyState !== WebSocket.OPEN || agentConnection !== 'ready') {
                    setStatus('Agent is not connected yet.')
                    return
                  }

                  const requestId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

                  appendMessage({ role: 'user', text: prompt })
                  appendMessage(makeRunMessage(requestId))

                  setIsSubmitting(true)
                  setStatus(`Sending agent prompt for ${activeLocation}...`)
                  websocket.send(
                    JSON.stringify({
                      requestId,
                      prompt,
                      memory: buildAgentMemory({
                        location: activeLocation,
                      }),
                    }),
                  )

                  setAgentPrompt('')
                }}
              >
                <input
                  value={agentPrompt}
                  onChange={(event) => setAgentPrompt(event.target.value)}
                  placeholder="Ask agent to generate buildings..."
                  className="flex-1 h-9 rounded-lg border border-[#2A2A2A] bg-[#0D0D0D] px-3 text-sm text-[#E0E0E0] outline-none focus:border-[#555555] transition-colors placeholder:text-[#666666]"
                  aria-label="Agent Prompt"
                />
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="h-9 w-9 grid place-items-center rounded-lg bg-[#2A2A2A] text-[#E0E0E0] border border-[#333333] hover:bg-[#333333] hover:border-[#444444] transition-colors"
                  title="Send"
                  aria-label="Send Agent Prompt"
                >
                  <i className="fa-solid fa-paper-plane text-xs"></i>
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      <div className={`flex ${isAgentCollapsed ? 'justify-center mt-auto' : 'justify-start mt-2'} w-full`}>
        <button
          onClick={() => setIsAgentCollapsed(!isAgentCollapsed)}
          className="h-8 w-8 grid place-items-center rounded-full border border-[#333333] bg-[#1A1A1A] hover:bg-[#242424] text-[#8b8b8b] hover:text-[#E0E0E0] transition-colors"
          title={isAgentCollapsed ? 'Expand Agent Sidebar' : 'Collapse Agent Sidebar'}
          aria-label={isAgentCollapsed ? 'Expand Agent Sidebar' : 'Collapse Agent Sidebar'}
        >
          {isAgentCollapsed ? <i className="fa-solid fa-circle-chevron-left text-sm"></i> : <i className="fa-solid fa-circle-chevron-right text-sm"></i>}
        </button>
      </div>
    </div>
  )
}
