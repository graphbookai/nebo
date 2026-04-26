import { create } from 'zustand'
import type { RunSummary, GraphData, LogEntry, ErrorEntry, LabelsPayload, MetricType, MetricEntry, LoggableMetricSeries } from '@/lib/api'
import type { WsEvent } from '@/lib/ws'
import { assignColor } from '@/lib/colors'

export interface NodeState {
  name: string
  funcName: string
  docstring: string | null
  params: Record<string, unknown>
  executionCount: number
  isSource: boolean
  progress: { current: number; total: number; name?: string } | null
  inDag: boolean
  hasPendingAsk: boolean
}

export interface LoggableState extends NodeState {
  kind: 'node' | 'global'
  loggableId: string
}

export interface AskPrompt {
  askId: string
  nodeName: string
  question: string
  options: string[] | null
  timeoutSeconds: number | null
  receivedAt: Date
}

export interface Settings {
  theme: 'dark' | 'light'
  showMinimap: boolean
  showControls: boolean
  hideTabsOnDrag: boolean
  hideUncalledFunctions: boolean
}

const SETTINGS_KEY = 'gb_settings'

const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  showMinimap: true,
  showControls: true,
  hideTabsOnDrag: false,
  hideUncalledFunctions: true,
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return { ...DEFAULT_SETTINGS, ...parsed }
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS }
}

function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch { /* ignore */ }
}

const initialSettings = loadSettings()

// Apply persisted theme on load
document.documentElement.classList.toggle('dark', initialSettings.theme === 'dark')

export type NodeTab = 'logs' | 'metrics' | 'images' | 'audio' | 'ask'

export type RightPanelTab = 'trace' | 'chat' | 'settings'

export interface PinnedPanel {
  id: string
  runId: string
  nodeId: string
  tab: NodeTab
  title: string
}

export interface ImageEntry {
  node: string
  mediaId: string
  name: string
  step: number | null
  timestamp: number
  labels?: LabelsPayload | null
}

export interface LabelKeySetting {
  visible: boolean
  opacity: number  // 0-100
}

const LABEL_SETTINGS_KEY = 'nebo_label_settings'

function loadLabelSettings(): Record<string, LabelKeySetting> {
  try {
    const raw = localStorage.getItem(LABEL_SETTINGS_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return {}
}

function saveLabelSettings(s: Record<string, LabelKeySetting>) {
  try {
    localStorage.setItem(LABEL_SETTINGS_KEY, JSON.stringify(s))
  } catch { /* ignore */ }
}

export interface AudioEntry {
  node: string
  mediaId: string
  name: string
  sr: number
  step: number | null
  timestamp: number
}

export type TimelineMode = 'time' | 'step'

export interface TimelineState {
  mode: TimelineMode
  timeStart: number | null
  timeEnd: number | null
  step: number | null
}

export interface ComparisonGroup {
  id: string
  title: string
  runIds: string[]
  createdAt: Date
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface RunState {
  summary: RunSummary
  graph: GraphData | null
  logs: LogEntry[]
  errors: ErrorEntry[]
  loggableMetrics: Record<string, Record<string, LoggableMetricSeries>>
  loggableImages: Record<string, ImageEntry[]>
  loggableAudio: Record<string, AudioEntry[]>
  pendingAsks: Map<string, AskPrompt>
  chatMessages: ChatMessage[]
  paused: boolean
  loaded: boolean
  globalLoggable?: { loggableId: string; kind: 'global' }
}

interface NeboStore {
  // Connection
  connected: boolean
  reconnecting: boolean
  setConnectionStatus: (connected: boolean, reconnecting: boolean) => void

  // Runs
  runs: Map<string, RunState>
  selectedRunId: string | null
  activeRunId: string | null

  runNames: Map<string, string>  // client-side custom display names
  setRunName: (runId: string, name: string) => void

  runColors: Map<string, string>
  nextColorIndex: number
  setRunColor: (runId: string, color: string) => void
  getOrAssignRunColor: (runId: string) => string

  // Comparison
  selectedForCompare: Set<string>
  comparisonGroups: Map<string, ComparisonGroup>
  toggleSelectForCompare: (runId: string) => void
  createComparisonGroup: (runIds: string[]) => string
  removeComparisonGroup: (groupId: string) => void

  // Node interaction (graph view)
  layoutTrigger: number
  dagDirection: 'TB' | 'LR'
  toggleDagDirection: () => void

  // Tracks which runs have already had their server-sent ui_config
  // applied to the UI defaults, so user overrides aren't clobbered
  // on graph refetch.
  appliedUiConfigRuns: Set<string>

  // Pinned panels
  pinnedPanels: PinnedPanel[]

  // Node positions & sizes (per run, session-only)
  nodePositions: Map<string, Map<string, { x: number; y: number }>>
  nodeSizes: Map<string, Map<string, { width: number; height: number }>>
  resizingNodeId: string | null
  toggleNodeResize: (nodeId: string) => void
  updateNodeSize: (runId: string, nodeId: string, size: { width: number; height: number }) => void

  // View mode (desktop preference; mobile defaults to 'grid' at render time)
  viewMode: 'graph' | 'grid'
  setViewMode: (mode: 'graph' | 'grid') => void

  // Right panel (trace + chat + settings)
  rightPanelTab: RightPanelTab
  rightPanelOpen: boolean
  setRightPanelTab: (tab: RightPanelTab) => void
  toggleRightPanel: () => void

  // Timeline
  timeline: TimelineState
  setTimelineMode: (mode: TimelineMode) => void
  setTimeRange: (start: number | null, end: number | null) => void
  setTimelineStep: (step: number | null) => void

  // Settings
  settings: Settings

  // Label-key visibility + opacity, keyed by `${loggableName}|${imageName}|${key}`.
  labelKeySettings: Record<string, LabelKeySetting>
  registerLabelKey: (loggable: string, image: string, key: string) => void
  setLabelKeyVisible: (loggable: string, image: string, key: string, visible: boolean) => void
  setLabelKeyOpacity: (loggable: string, image: string, key: string, opacity: number) => void

  // Actions
  setRuns: (summaries: RunSummary[], activeRunId: string | null) => void
  updateRunSummary: (summary: RunSummary) => void
  setRunGraph: (runId: string, graph: GraphData) => void
  setRunLogs: (runId: string, logs: LogEntry[]) => void
  appendRunLog: (runId: string, log: LogEntry) => void
  setRunErrors: (runId: string, errors: ErrorEntry[]) => void
  appendRunError: (runId: string, error: ErrorEntry) => void
  setRunMetrics: (runId: string, metrics: Record<string, Record<string, LoggableMetricSeries>>) => void
  setRunImages: (runId: string, images: Record<string, ImageEntry[]>) => void
  setRunAudio: (runId: string, audio: Record<string, AudioEntry[]>) => void
  appendMetric: (runId: string, loggableId: string, name: string, entry: MetricEntry, type: MetricType) => void
  updateNodeProgress: (runId: string, nodeId: string, progress: { current: number; total: number; name?: string } | null) => void
  incrementNodeExecCount: (runId: string, loggableId: string) => void
  addEdge: (runId: string, source: string, target: string) => void
  setWorkflowDescription: (runId: string, description: string) => void

  // Media cache (mediaId -> base64 data)
  mediaCache: Map<string, string>
  cacheMedia: (mediaId: string, data: string) => void

  selectRun: (runId: string | null) => void
  requestLayout: () => void
  pinTab: (runId: string, nodeId: string, tab: NodeTab) => void
  unpinPanel: (panelId: string) => void

  updateNodePosition: (runId: string, nodeId: string, pos: { x: number; y: number }) => void
  resetLayout: (runId: string) => void

  addAskPrompt: (runId: string, prompt: AskPrompt) => void
  removeAskPrompt: (runId: string, askId: string) => void
  setPaused: (runId: string, paused: boolean) => void

  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void

  // Chat
  sendChatMessage: (runId: string, question: string) => Promise<void>

  processWsEvents: (runId: string, events: WsEvent[]) => void
}

function ensureRun(state: NeboStore, runId: string): RunState {
  let run = state.runs.get(runId)
  if (!run) {
    run = {
      summary: {
        id: runId,
        script_path: 'direct',
        args: [],
        status: 'running',
        started_at: new Date().toISOString(),
        ended_at: null,
        exit_code: null,
        node_count: 0,
        edge_count: 0,
        log_count: 0,
        error_count: 0,
        run_name: null,
      },
      graph: null,
      logs: [],
      errors: [],
      loggableMetrics: {},
      loggableImages: {},
      loggableAudio: {},
      pendingAsks: new Map(),
      chatMessages: [],
      paused: false,
      loaded: false,
      globalLoggable: undefined,
    }
    state.runs.set(runId, run)
  }
  return run
}

export const useStore = create<NeboStore>((set, get) => ({
  connected: false,
  reconnecting: false,
  setConnectionStatus: (connected, reconnecting) => set({ connected, reconnecting }),

  runs: new Map(),
  selectedRunId: null,
  activeRunId: null,

  runNames: new Map(),
  setRunName: (runId, name) => set(state => {
    const next = new Map(state.runNames)
    if (name.trim()) {
      next.set(runId, name.trim())
    } else {
      next.delete(runId)
    }
    return { runNames: next }
  }),

  runColors: new Map(),
  nextColorIndex: 0,
  setRunColor: (runId, color) => set(state => {
    const next = new Map(state.runColors)
    next.set(runId, color)
    return { runColors: next }
  }),
  getOrAssignRunColor: (runId) => {
    const state = get()
    const existing = state.runColors.get(runId)
    if (existing) return existing
    const color = assignColor(state.nextColorIndex)
    const next = new Map(state.runColors)
    next.set(runId, color)
    set({ runColors: next, nextColorIndex: state.nextColorIndex + 1 })
    return color
  },

  selectedForCompare: new Set<string>(),
  comparisonGroups: new Map(),
  toggleSelectForCompare: (runId) => set(state => {
    const next = new Set(state.selectedForCompare)
    if (next.has(runId)) next.delete(runId)
    else next.add(runId)
    return { selectedForCompare: next }
  }),
  createComparisonGroup: (runIds) => {
    const id = `cmp:${Date.now()}`
    const state = get()
    const names = runIds.map(rid => {
      const custom = state.runNames.get(rid)
      if (custom) return custom
      const run = state.runs.get(rid)
      return run?.summary.script_path.split('/').pop() ?? rid
    })
    const title = names.length <= 2
      ? `Compare: ${names.join(' vs ')}`
      : `Compare: ${names[0]} vs ${names[1]} +${names.length - 2}`
    const group: ComparisonGroup = { id, title, runIds, createdAt: new Date() }
    const next = new Map(state.comparisonGroups)
    next.set(id, group)
    set({ comparisonGroups: next, selectedForCompare: new Set() })
    return id
  },
  removeComparisonGroup: (groupId) => set(state => {
    const next = new Map(state.comparisonGroups)
    next.delete(groupId)
    const updates: Partial<NeboStore> = { comparisonGroups: next }
    if (state.selectedRunId === groupId) updates.selectedRunId = null
    return updates
  }),

  layoutTrigger: 0,
  dagDirection: 'TB',
  toggleDagDirection: () => set(state => ({
    dagDirection: state.dagDirection === 'TB' ? 'LR' : 'TB',
    layoutTrigger: state.layoutTrigger + 1,
  })),

  appliedUiConfigRuns: new Set<string>(),

  pinnedPanels: [],

  nodePositions: new Map(),
  nodeSizes: new Map(),
  resizingNodeId: null,
  toggleNodeResize: (nodeId) => set(state => ({
    resizingNodeId: state.resizingNodeId === nodeId ? null : nodeId,
  })),
  updateNodeSize: (runId, nodeId, size) => set(state => {
    const outer = new Map(state.nodeSizes)
    const inner = new Map(outer.get(runId) ?? [])
    inner.set(nodeId, size)
    outer.set(runId, inner)
    return { nodeSizes: outer }
  }),

  // Default mobile to grid (rendered as "List") since DAG panning is awkward
  // on small screens; desktop defaults to DAG.
  viewMode: (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
    ? 'grid'
    : 'graph') as 'graph' | 'grid',
  setViewMode: (mode) => set({ viewMode: mode }),

  rightPanelTab: 'trace' as const,
  rightPanelOpen: false,
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
  toggleRightPanel: () => set(state => ({ rightPanelOpen: !state.rightPanelOpen })),

  timeline: { mode: 'time', timeStart: null, timeEnd: null, step: null },
  setTimelineMode: (mode) => set(state => ({ timeline: { ...state.timeline, mode } })),
  setTimeRange: (start, end) => set(state => ({ timeline: { ...state.timeline, timeStart: start, timeEnd: end } })),
  setTimelineStep: (step) => set(state => ({ timeline: { ...state.timeline, step } })),

  settings: initialSettings,

  labelKeySettings: loadLabelSettings(),
  registerLabelKey: (loggable, image, key) => set(state => {
    const k = `${loggable}|${image}|${key}`
    if (k in state.labelKeySettings) return state
    const next = { ...state.labelKeySettings, [k]: { visible: true, opacity: 70 } }
    saveLabelSettings(next)
    return { labelKeySettings: next }
  }),
  setLabelKeyVisible: (loggable, image, key, visible) => set(state => {
    const k = `${loggable}|${image}|${key}`
    const prev = state.labelKeySettings[k] ?? { visible: true, opacity: 70 }
    const next = { ...state.labelKeySettings, [k]: { ...prev, visible } }
    saveLabelSettings(next)
    return { labelKeySettings: next }
  }),
  setLabelKeyOpacity: (loggable, image, key, opacity) => set(state => {
    const k = `${loggable}|${image}|${key}`
    const prev = state.labelKeySettings[k] ?? { visible: true, opacity: 70 }
    const next = { ...state.labelKeySettings, [k]: { ...prev, opacity } }
    saveLabelSettings(next)
    return { labelKeySettings: next }
  }),

  setRuns: (summaries, activeRunId) => set(state => {
    const runs = new Map(state.runs)
    for (const s of summaries) {
      const existing = runs.get(s.id)
      if (existing) {
        existing.summary = s
      } else {
        runs.set(s.id, {
          summary: s,
          graph: null,
          logs: [],
          errors: [],
          loggableMetrics: {},
          loggableImages: {},
          loggableAudio: {},
          pendingAsks: new Map(),
          chatMessages: [],
          paused: false,
          loaded: false,
          globalLoggable: undefined,
        })
      }
    }
    // Auto-select the most recent run if none selected
    let selectedRunId = state.selectedRunId
    if (!selectedRunId && summaries.length > 0) {
      selectedRunId = activeRunId ?? summaries[summaries.length - 1].id
    }
    return { runs, activeRunId, selectedRunId }
  }),

  updateRunSummary: (summary) => set(state => {
    const runs = new Map(state.runs)
    const existing = runs.get(summary.id)
    if (existing) {
      existing.summary = summary
    }
    return { runs }
  }),

  setRunGraph: (runId, graph) => set(state => {
    const runs = new Map(state.runs)
    const run = runs.get(runId)
    if (run) {
      run.graph = graph
      run.paused = graph.paused ?? false
      run.loaded = true
    }

    // Apply run-level UI defaults from nb.ui() exactly once per run so the
    // user's subsequent interactive changes are not clobbered on every
    // refetch. We touch only the fields the server explicitly provided.
    const patch: Partial<NeboStore> = { runs }
    const ui = graph.ui_config
    const alreadyApplied = state.appliedUiConfigRuns.has(runId)
    if (ui && !alreadyApplied) {
      const applied = new Set(state.appliedUiConfigRuns)
      applied.add(runId)
      patch.appliedUiConfigRuns = applied

      if (ui.layout === 'horizontal') {
        patch.dagDirection = 'LR'
      } else if (ui.layout === 'vertical') {
        patch.dagDirection = 'TB'
      }

      if (ui.view === 'dag') {
        patch.viewMode = 'graph'
      } else if (ui.view === 'grid') {
        patch.viewMode = 'grid'
      }

      if (ui.theme === 'dark' || ui.theme === 'light') {
        const nextSettings = { ...state.settings, theme: ui.theme }
        saveSettings(nextSettings)
        document.documentElement.classList.toggle('dark', ui.theme === 'dark')
        patch.settings = nextSettings
      }

      if (ui.tracker === 'time' || ui.tracker === 'step') {
        patch.timeline = { ...state.timeline, mode: ui.tracker }
      }

      if (ui.minimap === true || ui.minimap === false) {
        const base = patch.settings ?? state.settings
        const nextSettings = { ...base, showMinimap: ui.minimap }
        saveSettings(nextSettings)
        patch.settings = nextSettings
      }

      // Kick layout to re-run with the new direction.
      patch.layoutTrigger = state.layoutTrigger + 1
    }

    return patch
  }),

  setRunLogs: (runId, logs) => set(state => {
    const runs = new Map(state.runs)
    const run = runs.get(runId)
    if (run) run.logs = logs
    return { runs }
  }),

  appendRunLog: (runId, log) => set(state => {
    const runs = new Map(state.runs)
    const run = runs.get(runId)
    if (run) run.logs = [...run.logs, log]
    return { runs }
  }),

  setRunErrors: (runId, errors) => set(state => {
    const runs = new Map(state.runs)
    const run = runs.get(runId)
    if (run) run.errors = errors
    return { runs }
  }),

  appendRunError: (runId, error) => set(state => {
    const runs = new Map(state.runs)
    const run = runs.get(runId)
    if (run) run.errors = [...run.errors, error]
    return { runs }
  }),

  setRunMetrics: (runId, metrics) => set(state => {
    const runs = new Map(state.runs)
    const run = runs.get(runId)
    if (run) run.loggableMetrics = metrics
    return { runs }
  }),

  setRunImages: (runId, images) => set(state => {
    const runs = new Map(state.runs)
    const run = runs.get(runId)
    if (run) {
      const merged: Record<string, ImageEntry[]> = { ...run.loggableImages }
      for (const [loggableId, entries] of Object.entries(images)) {
        const existing = merged[loggableId] ?? []
        const existingIds = new Set(existing.map(e => e.mediaId))
        const newEntries = entries.filter(e => !existingIds.has(e.mediaId))
        merged[loggableId] = [...existing, ...newEntries]
      }
      run.loggableImages = merged
    }
    return { runs }
  }),

  setRunAudio: (runId, audio) => set(state => {
    const runs = new Map(state.runs)
    const run = runs.get(runId)
    if (run) {
      const merged: Record<string, AudioEntry[]> = { ...run.loggableAudio }
      for (const [loggableId, entries] of Object.entries(audio)) {
        const existing = merged[loggableId] ?? []
        const existingIds = new Set(existing.map(e => e.mediaId))
        const newEntries = entries.filter(e => !existingIds.has(e.mediaId))
        merged[loggableId] = [...existing, ...newEntries]
      }
      run.loggableAudio = merged
    }
    return { runs }
  }),

  appendMetric: (runId, loggableId, name, entry, type) => set(state => {
    const runs = new Map(state.runs)
    const run = runs.get(runId)
    if (run) {
      if (!run.loggableMetrics[loggableId]) run.loggableMetrics[loggableId] = {}
      const existing = run.loggableMetrics[loggableId][name]
      if (!existing) {
        run.loggableMetrics[loggableId][name] = { type, entries: [entry] }
      } else {
        existing.entries = [...existing.entries, entry]
      }
    }
    return { runs }
  }),

  updateNodeProgress: (runId, nodeId, progress) => set(state => {
    const runs = new Map(state.runs)
    const run = runs.get(runId)
    if (run?.graph?.nodes[nodeId]) {
      run.graph = {
        ...run.graph,
        nodes: {
          ...run.graph.nodes,
          [nodeId]: { ...run.graph.nodes[nodeId], progress },
        },
      }
    }
    return { runs }
  }),

  incrementNodeExecCount: (runId, loggableId) => set(state => {
    const runs = new Map(state.runs)
    const run = runs.get(runId)
    if (run?.graph?.nodes[loggableId]) {
      run.graph = {
        ...run.graph,
        nodes: {
          ...run.graph.nodes,
          [loggableId]: {
            ...run.graph.nodes[loggableId],
            exec_count: run.graph.nodes[loggableId].exec_count + 1,
          },
        },
      }
    }
    return { runs }
  }),

  addEdge: (runId, source, target) => set(state => {
    const runs = new Map(state.runs)
    const run = runs.get(runId)
    if (run?.graph) {
      const exists = run.graph.edges.some(e => e.source === source && e.target === target)
      if (!exists) {
        run.graph = {
          ...run.graph,
          edges: [...run.graph.edges, { source, target }],
          nodes: {
            ...run.graph.nodes,
            ...(run.graph.nodes[target] ? {
              [target]: { ...run.graph.nodes[target], is_source: false },
            } : {}),
          },
        }
        run.summary.edge_count = run.graph.edges.length
      }
    }
    return { runs }
  }),

  setWorkflowDescription: (runId, description) => set(state => {
    const runs = new Map(state.runs)
    const run = runs.get(runId)
    if (run?.graph) {
      run.graph = { ...run.graph, workflow_description: description }
    }
    return { runs }
  }),

  // Media cache
  mediaCache: new Map(),
  cacheMedia: (mediaId, data) => set(state => {
    const next = new Map(state.mediaCache)
    next.set(mediaId, data)
    return { mediaCache: next }
  }),

  selectRun: (runId) => set({ selectedRunId: runId }),
  requestLayout: () => set(state => ({ layoutTrigger: state.layoutTrigger + 1 })),
  pinTab: (runId, nodeId, tab) => set(state => {
    const run = state.runs.get(runId)
    const nodeName = run?.graph?.nodes[nodeId]?.func_name || nodeId
    const panel: PinnedPanel = {
      id: `${runId}:${nodeId}:${tab}:${Date.now()}`,
      runId,
      nodeId,
      tab,
      title: `${nodeName} — ${tab.charAt(0).toUpperCase() + tab.slice(1)}`,
    }
    return { pinnedPanels: [...state.pinnedPanels, panel] }
  }),

  unpinPanel: (panelId) => set(state => ({
    pinnedPanels: state.pinnedPanels.filter(p => p.id !== panelId),
  })),

  updateNodePosition: (runId, nodeId, pos) => set(state => {
    const positions = new Map(state.nodePositions)
    if (!positions.has(runId)) positions.set(runId, new Map())
    positions.get(runId)!.set(nodeId, pos)
    return { nodePositions: positions }
  }),

  resetLayout: (runId) => set(state => {
    const positions = new Map(state.nodePositions)
    positions.delete(runId)
    return { nodePositions: positions }
  }),

  addAskPrompt: (runId, prompt) => set(state => {
    const runs = new Map(state.runs)
    const run = runs.get(runId)
    if (run) {
      const asks = new Map(run.pendingAsks)
      asks.set(prompt.askId, prompt)
      run.pendingAsks = asks
    }
    return { runs }
  }),

  removeAskPrompt: (runId, askId) => set(state => {
    const runs = new Map(state.runs)
    const run = runs.get(runId)
    if (run) {
      const asks = new Map(run.pendingAsks)
      asks.delete(askId)
      run.pendingAsks = asks
    }
    return { runs }
  }),

  setPaused: (runId, paused) => set(state => {
    const runs = new Map(state.runs)
    const run = runs.get(runId)
    if (run) {
      run.paused = paused
    }
    return { runs }
  }),

  updateSetting: (key, value) => set(state => {
    const next = { ...state.settings, [key]: value }
    saveSettings(next)
    if (key === 'theme') {
      document.documentElement.classList.toggle('dark', next.theme === 'dark')
    }
    return { settings: next }
  }),

  sendChatMessage: async (runId, question) => {
    set(state => {
      const runs = new Map(state.runs)
      const run = runs.get(runId)
      if (run) {
        run.chatMessages = [...run.chatMessages, {
          role: 'user' as const,
          content: question,
          timestamp: Date.now() / 1000,
        }]
      }
      return { runs }
    })

    try {
      const response = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, run_id: runId }),
      })

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let fullResponse = ''

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const text = decoder.decode(value)
          const lines = text.split('\n')
          for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try {
                const data = JSON.parse(line.slice(6))
                fullResponse += data.text
              } catch { /* skip malformed lines */ }
            }
          }
        }
      }

      set(state => {
        const runs = new Map(state.runs)
        const run = runs.get(runId)
        if (run) {
          run.chatMessages = [...run.chatMessages, {
            role: 'assistant' as const,
            content: fullResponse || 'No response received.',
            timestamp: Date.now() / 1000,
          }]
        }
        return { runs }
      })
    } catch (err) {
      set(state => {
        const runs = new Map(state.runs)
        const run = runs.get(runId)
        if (run) {
          run.chatMessages = [...run.chatMessages, {
            role: 'assistant' as const,
            content: `Error: ${err instanceof Error ? err.message : 'Failed to get response'}`,
            timestamp: Date.now() / 1000,
          }]
        }
        return { runs }
      })
    }
  },

  processWsEvents: (runId, events) => {
    // Single batched set() — avoids N re-renders per WS batch
    set(state => {
      const runs = new Map(state.runs)

      // Ensure the run exists
      let run = runs.get(runId)
      if (!run) {
        run = {
          summary: {
            id: runId,
            script_path: 'direct',
            args: [],
            status: 'running',
            started_at: new Date().toISOString(),
            ended_at: null,
            exit_code: null,
            node_count: 0,
            edge_count: 0,
            log_count: 0,
            error_count: 0,
            run_name: null,
          },
          graph: null,
          logs: [],
          errors: [],
          loggableMetrics: {},
          loggableImages: {},
          loggableAudio: {},
          pendingAsks: new Map(),
          chatMessages: [],
          paused: false,
          loaded: false,
          globalLoggable: undefined,
        }
      }
      // Clone run so selectors see a new reference
      run = { ...run } as RunState
      runs.set(runId, run)

      // Accumulate new logs/errors so we can spread once at the end
      const newLogs: LogEntry[] = []
      const newErrors: ErrorEntry[] = []

      for (const event of events) {
        const etype = event.type
        const loggableId = event.loggable_id as string | undefined
        const data = (event.data ?? event) as Record<string, unknown>

        switch (etype) {
          case 'log':
            newLogs.push({
              timestamp: (event.timestamp as number) ?? Date.now() / 1000,
              node: loggableId ?? null,
              message: (event.message as string) ?? (data.message as string) ?? '',
              level: (event.level as string) ?? 'info',
              step: (event.step as number) ?? null,
            })
            break

          case 'metric': {
            const lid = event.loggable_id as string | undefined
            if (!lid) break
            const mname = (event.name as string) ?? (data.name as string) ?? ''
            const mtype = ((event.metric_type as MetricType) ?? (data.metric_type as MetricType)) ?? 'line'
            const entry: MetricEntry = {
              step: (event.step as number | null) ?? (data.step as number | null) ?? null,
              value: event.value ?? data.value,
              tags: ((event.tags as string[]) ?? (data.tags as string[]) ?? []),
              timestamp: (event.timestamp as number) ?? Date.now() / 1000,
            }
            // Immutable update so `useMemo([series.entries])` downstream fires
            // on every append. Mutating the existing array would leave the
            // reference unchanged and freeze derived chip lists / filters.
            const existing = run.loggableMetrics[lid]?.[mname]
            const nextSeries: LoggableMetricSeries = existing
              ? { ...existing, entries: [...existing.entries, entry] }
              : { type: mtype, entries: [entry] }
            run.loggableMetrics = {
              ...run.loggableMetrics,
              [lid]: { ...(run.loggableMetrics[lid] ?? {}), [mname]: nextSeries },
            }
            break
          }

          case 'progress':
            if (loggableId && run.graph?.nodes[loggableId]) {
              // New node object so primitive selectors detect the change; graph ref stays stable
              run.graph.nodes[loggableId] = {
                ...run.graph.nodes[loggableId],
                progress: data as { current: number; total: number; name?: string },
              }
            }
            break

          case 'error':
            newErrors.push({
              timestamp: (data.timestamp as number) ?? Date.now() / 1000,
              node_name: (data.loggable_id as string) ?? loggableId ?? '',
              node_docstring: (data.docstring as string) ?? null,
              exception_type: (data.type as string) ?? '',
              exception_message: (data.error as string) ?? '',
              traceback: (data.traceback as string) ?? '',
              execution_count: (data.exec_count as number) ?? 0,
              params: (data.params as Record<string, unknown>) ?? {},
              last_logs: (data.last_logs as string[]) ?? [],
            })
            break

          case 'loggable_register': {
            const lid = (data.loggable_id as string) || ''
            const kind = (data.kind as 'node' | 'global') ?? 'node'
            if (kind === 'global') {
              // Globals are not DAG nodes — track separately, do not insert into graph.nodes
              if (!run.globalLoggable) {
                run.globalLoggable = { loggableId: lid, kind: 'global' }
              }
            } else {
              if (!run.graph) {
                run.graph = { nodes: {}, edges: [], workflow_description: null, has_pausable: false, paused: false }
              }
              const isPausable = !!(data.pausable as boolean)
              if (!run.graph.nodes[lid]) {
                // Structural change — new graph object
                run.graph = {
                  ...run.graph,
                  has_pausable: run.graph.has_pausable || isPausable,
                  nodes: {
                    ...run.graph.nodes,
                    [lid]: {
                      name: lid,
                      func_name: (data.func_name as string) || '',
                      docstring: (data.docstring as string) || null,
                      exec_count: 0,
                      is_source: true,
                      pausable: isPausable,
                      params: {},
                      progress: null,
                      group: (data.group as string) || null,
                      ui_hints: (data.ui_hints as Record<string, unknown>) || null,
                    },
                  },
                }
                run.summary.node_count = Object.keys(run.graph.nodes).length
              }
            }
            break
          }

          case 'node_executed': {
            const nid = (data.loggable_id as string) ?? loggableId ?? ''
            if (nid && run.graph?.nodes[nid]) {
              // New node object for selector detection; graph ref stays stable
              run.graph.nodes[nid] = {
                ...run.graph.nodes[nid],
                exec_count: run.graph.nodes[nid].exec_count + 1,
              }
            }
            const caller = data.caller as string | undefined
            if (caller && nid && run.graph) {
              const exists = run.graph.edges.some(e => e.source === caller && e.target === nid)
              if (!exists) {
                // Structural change — new graph object
                run.graph = {
                  ...run.graph,
                  edges: [...run.graph.edges, { source: caller, target: nid }],
                  nodes: {
                    ...run.graph.nodes,
                    ...(run.graph.nodes[nid] ? {
                      [nid]: { ...run.graph.nodes[nid], is_source: false },
                    } : {}),
                  },
                }
                run.summary.edge_count = run.graph.edges.length
              }
            }
            break
          }

          case 'edge': {
            const source = (data.source as string) ?? ''
            const target = (data.target as string) ?? ''
            if (run.graph) {
              const exists = run.graph.edges.some(e => e.source === source && e.target === target)
              if (!exists) {
                run.graph = {
                  ...run.graph,
                  edges: [...run.graph.edges, { source, target }],
                  nodes: {
                    ...run.graph.nodes,
                    ...(run.graph.nodes[target] ? {
                      [target]: { ...run.graph.nodes[target], is_source: false },
                    } : {}),
                  },
                }
                run.summary.edge_count = run.graph.edges.length
              }
            }
            break
          }

          case 'image':
            if (loggableId) {
              const ev = event as Record<string, unknown>
              const prev = run.loggableImages[loggableId] ?? []
              run.loggableImages = { ...run.loggableImages, [loggableId]: [...prev, {
                node: loggableId,
                mediaId: (ev.media_id as string) ?? '',
                name: (ev.name as string) ?? '',
                step: (ev.step as number) ?? null,
                timestamp: (ev.timestamp as number) ?? Date.now() / 1000,
                labels: (ev.labels as LabelsPayload | null | undefined) ?? null,
              }] }
            }
            break

          case 'audio':
            if (loggableId) {
              const ev = event as Record<string, unknown>
              const prev = run.loggableAudio[loggableId] ?? []
              run.loggableAudio = { ...run.loggableAudio, [loggableId]: [...prev, {
                node: loggableId,
                mediaId: (ev.media_id as string) ?? '',
                name: (ev.name as string) ?? '',
                sr: (ev.sr as number) ?? 16000,
                step: (ev.step as number) ?? null,
                timestamp: (ev.timestamp as number) ?? Date.now() / 1000,
              }] }
            }
            break

          case 'text':
            newLogs.push({
              timestamp: (event.timestamp as number) ?? Date.now() / 1000,
              node: loggableId ?? null,
              message: `[${(data.name as string) ?? ''}] ${(data.content as string) ?? (event.content as unknown as string) ?? ''}`,
              level: 'info',
              step: (event.step as number) ?? null,
            })
            break

          case 'config':
            if (loggableId && run.graph?.nodes[loggableId]) {
              run.graph.nodes[loggableId] = {
                ...run.graph.nodes[loggableId],
                params: { ...run.graph.nodes[loggableId].params, ...(data as Record<string, unknown>) },
              }
            }
            break

          case 'description':
            if (run.graph) {
              run.graph = { ...run.graph, workflow_description: (data.description as string) ?? '' }
            }
            break

          case 'ask_prompt': {
            const asks = new Map(run.pendingAsks)
            const askId = (data.ask_id as string) ?? `ask_${Date.now()}`
            asks.set(askId, {
              askId,
              nodeName: (data.node_name as string) ?? loggableId ?? '',
              question: (data.question as string) ?? '',
              options: (data.options as string[]) ?? null,
              timeoutSeconds: (data.timeout_seconds as number) ?? null,
              receivedAt: new Date(),
            })
            run.pendingAsks = asks
            break
          }

          case 'run_start': {
            const scriptPath = (data.script_path as string) ?? ''
            const runName = (data.run_name as string) ?? null
            const patch: Partial<typeof run.summary> = { status: 'running' }
            if (scriptPath) patch.script_path = scriptPath
            if (runName !== null) patch.run_name = runName
            run.summary = { ...run.summary, ...patch }
            break
          }

          case 'run_config': {
            if (run.graph) {
              run.graph = { ...run.graph, run_config: data as Record<string, unknown> }
            }
            break
          }

          case 'run_completed': {
            const exitCode = (data.exit_code as number) ?? 0
            run.summary = {
              ...run.summary,
              status: exitCode === 0 ? 'completed' : 'crashed',
              exit_code: exitCode,
              ended_at: new Date().toISOString(),
            }
            break
          }

          case 'pause_state': {
            const paused = !!(data.paused as boolean)
            run.paused = paused
            if (run.graph) {
              run.graph = { ...run.graph, paused }
            }
            break
          }
        }
      }

      // Batch-append accumulated logs and errors
      if (newLogs.length > 0) {
        run.logs = [...run.logs, ...newLogs]
      }
      if (newErrors.length > 0) {
        run.errors = [...run.errors, ...newErrors]
      }

      return { runs }
    })
  },
}))
