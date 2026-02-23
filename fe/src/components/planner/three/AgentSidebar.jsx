import { useState } from 'react'

const AGENT_MODES = [
  { value: 'single', label: 'Single Building' },
  { value: 'block', label: 'City Block' },
  { value: 'district', label: 'District Fill' },
]

const AGENT_MODELS = [
  { value: 'gpt-5.3-codex', label: 'GPT-5.3-Codex' },
  { value: 'planner-fast', label: 'Planner Fast' },
  { value: 'planner-balanced', label: 'Planner Balanced' },
  { value: 'planner-quality', label: 'Planner Quality' },
]

export function AgentSidebar({ setStatus }) {
  const [isAgentCollapsed, setIsAgentCollapsed] = useState(true)
  const [agentMode, setAgentMode] = useState(AGENT_MODES[0].value)
  const [agentModel, setAgentModel] = useState(AGENT_MODELS[0].value)
  const [agentPrompt, setAgentPrompt] = useState('')
  const [openPicker, setOpenPicker] = useState(null)

  return (
    <div
      aria-label="Agent Sidebar"
      className={`absolute top-5 right-5 bottom-5 z-30 rounded-[15px] border border-[#2A2A2A] bg-[#141414]/90 shadow-2xl backdrop-blur-md flex flex-col pointer-events-auto transition-all duration-300 ease-in-out ${isAgentCollapsed ? 'w-16 p-3 items-center gap-4 overflow-hidden' : 'w-80 p-5 gap-6 overflow-visible'}`}
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

          <div className="group relative">
            <button onClick={() => setIsAgentCollapsed(false)} className="p-2 rounded-lg hover:bg-[#2A2A2A] text-[#8b8b8b] hover:text-[#E0E0E0] transition-colors">
              <i className="fa-solid fa-sliders text-lg"></i>
            </button>
            <div className="absolute right-full mr-3 top-1/2 -translate-y-1/2 px-2 py-1 bg-[#2A2A2A] text-[#E0E0E0] text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
              Mode: {AGENT_MODES.find((option) => option.value === agentMode)?.label || agentMode}
            </div>
          </div>

          <div className="group relative">
            <button onClick={() => setIsAgentCollapsed(false)} className="p-2 rounded-lg hover:bg-[#2A2A2A] text-[#8b8b8b] hover:text-[#E0E0E0] transition-colors">
              <i className="fa-solid fa-microchip text-lg"></i>
            </button>
            <div className="absolute right-full mr-3 top-1/2 -translate-y-1/2 px-2 py-1 bg-[#2A2A2A] text-[#E0E0E0] text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
              Model: {AGENT_MODELS.find((option) => option.value === agentModel)?.label || agentModel}
            </div>
          </div>

          <div className="w-8 h-px bg-[#2A2A2A] my-1" />

          <div className="group relative">
            <button onClick={() => setIsAgentCollapsed(false)} className="p-2 rounded-lg hover:bg-[#2A2A2A] text-[#8b8b8b] hover:text-[#E0E0E0] transition-colors">
              <i className="fa-solid fa-wand-magic-sparkles text-lg"></i>
            </button>
            <div className="absolute right-full mr-3 top-1/2 -translate-y-1/2 px-2 py-1 bg-[#2A2A2A] text-[#E0E0E0] text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
              Building Generation
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col gap-4 animate-[fadeIn_300ms_ease-in]">
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar flex flex-col gap-6 pr-1">
            <div>
              <h2 className="text-[10px] font-semibold uppercase tracking-widest text-[#666666] mb-1.5">Agent Controls</h2>
              <p className="text-sm font-medium text-[#E0E0E0] leading-snug">Building Generator</p>
              <p className="text-xs text-[#8b8b8b] mt-1">Chat-driven generation UI with quick mode/model picks.</p>
            </div>

            <div className="space-y-2">
              <h2 className="text-[10px] font-semibold uppercase tracking-widest text-[#666666] mb-1.5">Session</h2>
              <div className="rounded-xl border border-[#2A2A2A] bg-[#0D0D0D]/50 p-3.5 space-y-2 text-xs text-[#8b8b8b]">
                <div className="flex justify-between"><span className="text-[#666666]">Mode</span><span className="text-[#E0E0E0] font-medium">{AGENT_MODES.find((option) => option.value === agentMode)?.label}</span></div>
                <div className="flex justify-between"><span className="text-[#666666]">Model</span><span className="text-[#E0E0E0] font-medium">{AGENT_MODELS.find((option) => option.value === agentModel)?.label}</span></div>
                <div className="flex justify-between"><span className="text-[#666666]">State</span><span className="text-[#E0E0E0] font-medium">Ready</span></div>
              </div>
            </div>

            <div className="space-y-2">
              <h2 className="text-[10px] font-semibold uppercase tracking-widest text-[#666666] mb-1.5">Agent Chat</h2>
              <div className="rounded-xl border border-[#2A2A2A] bg-[#0D0D0D]/50 p-3.5 text-xs text-[#8b8b8b] flex flex-col gap-2 min-h-[160px]">
                <div className="self-end max-w-[85%] rounded-lg border border-[#333333] bg-[#1A1A1A] px-2.5 py-2 text-[#E0E0E0]">Generate a mixed-use block near the selected streets.</div>
                <div className="self-start max-w-[85%] rounded-lg border border-[#2A2A2A] bg-[#111111] px-2.5 py-2 text-[#8b8b8b]">Agent response preview appears here after wiring backend.</div>
              </div>
            </div>
          </div>

          <div className="pt-2 shrink-0">
            <div className="rounded-xl border border-[#2A2A2A] bg-[#0D0D0D]/60 p-3 space-y-2.5">
              <form
                className="flex flex-col gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  setStatus(agentPrompt.trim() ? `Agent prompt queued: ${agentPrompt}` : 'Type a prompt to send to the agent.')
                  setAgentPrompt('')
                  setOpenPicker(null)
                }}
              >
                <div className="flex items-center gap-2">
                  <input
                    value={agentPrompt}
                    onChange={(event) => setAgentPrompt(event.target.value)}
                    placeholder="Ask agent to generate buildings..."
                    className="flex-1 h-9 rounded-lg border border-[#2A2A2A] bg-[#0D0D0D] px-3 text-sm text-[#E0E0E0] outline-none focus:border-[#555555] transition-colors placeholder:text-[#666666]"
                    aria-label="Agent Prompt"
                  />
                  <button
                    type="submit"
                    className="h-9 w-9 grid place-items-center rounded-lg bg-[#2A2A2A] text-[#E0E0E0] border border-[#333333] hover:bg-[#333333] hover:border-[#444444] transition-colors"
                    title="Send"
                    aria-label="Send Agent Prompt"
                  >
                    <i className="fa-solid fa-paper-plane text-xs"></i>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => setOpenPicker(openPicker === 'mode' ? null : 'mode')}
                      className="h-7 w-full rounded-md border border-[#2A2A2A] bg-[#141414] px-2 text-[11px] text-[#E0E0E0] hover:bg-[#1c1c1c] transition-colors text-left flex items-center justify-between"
                      aria-label="Generation Mode"
                    >
                      <span className="truncate">Mode: {AGENT_MODES.find((option) => option.value === agentMode)?.label}</span>
                      <i className={`fa-solid ${openPicker === 'mode' ? 'fa-chevron-up' : 'fa-chevron-down'} text-[9px] text-[#8b8b8b] ml-2`}></i>
                    </button>

                    {openPicker === 'mode' && (
                      <div className="absolute left-0 right-0 bottom-full mb-1 rounded-lg border border-[#333333] bg-[#141414] shadow-2xl p-1.5 z-50 min-w-[180px]">
                        <div className="max-h-44 overflow-y-auto custom-scrollbar space-y-1">
                          {AGENT_MODES.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => {
                                setAgentMode(option.value)
                                setOpenPicker(null)
                              }}
                              className={`w-full h-8 px-2 rounded-md text-xs text-left transition-colors ${agentMode === option.value ? 'bg-[#2A2A2A] text-[#E0E0E0]' : 'text-[#8b8b8b] hover:bg-[#1F1F1F] hover:text-[#E0E0E0]'}`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="relative min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => setOpenPicker(openPicker === 'model' ? null : 'model')}
                      className="h-7 w-full rounded-md border border-[#2A2A2A] bg-[#141414] px-2 text-[11px] text-[#E0E0E0] hover:bg-[#1c1c1c] transition-colors text-left flex items-center justify-between"
                      aria-label="Agent Model"
                    >
                      <span className="truncate">Model: {AGENT_MODELS.find((option) => option.value === agentModel)?.label}</span>
                      <i className={`fa-solid ${openPicker === 'model' ? 'fa-chevron-up' : 'fa-chevron-down'} text-[9px] text-[#8b8b8b] ml-2`}></i>
                    </button>

                    {openPicker === 'model' && (
                      <div className="absolute left-0 right-0 bottom-full mb-1 rounded-lg border border-[#333333] bg-[#141414] shadow-2xl p-1.5 z-50 min-w-[180px]">
                        <div className="max-h-44 overflow-y-auto custom-scrollbar space-y-1">
                          {AGENT_MODELS.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => {
                                setAgentModel(option.value)
                                setOpenPicker(null)
                              }}
                              className={`w-full h-8 px-2 rounded-md text-xs text-left transition-colors ${agentModel === option.value ? 'bg-[#2A2A2A] text-[#E0E0E0]' : 'text-[#8b8b8b] hover:bg-[#1F1F1F] hover:text-[#E0E0E0]'}`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
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
