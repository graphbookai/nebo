const BASE = ''

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`)
  return res.json()
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${path}: ${res.status}`)
  return res.json()
}

export interface RunSummary {
  id: string
  script_path: string
  args: string[]
  status: 'starting' | 'running' | 'completed' | 'crashed' | 'stopped'
  started_at: string | null
  ended_at: string | null
  exit_code: number | null
  node_count: number
  edge_count: number
  log_count: number
  error_count: number
  run_name: string | null
}

export interface GraphData {
  nodes: Record<string, {
    name: string
    func_name: string
    docstring: string | null
    exec_count: number
    is_source: boolean
    pausable: boolean
    params: Record<string, unknown>
    progress: { current: number; total: number; name?: string } | null
    group: string | null
    ui_hints: Record<string, unknown> | null
  }>
  edges: { source: string; target: string }[]
  workflow_description: string | null
  has_pausable: boolean
  paused: boolean
  ui_config?: UiConfig | null
  run_config?: Record<string, unknown> | null
}

export interface UiConfig {
  layout?: 'horizontal' | 'vertical'
  view?: 'dag' | 'grid'
  collapsed?: boolean
  minimap?: boolean
  theme?: 'dark' | 'light'
  tracker?: 'time' | 'step'
}

export interface LogEntry {
  timestamp: number
  node: string | null
  message: string
  level: string
  step: number | null
}

export interface ErrorEntry {
  timestamp: number
  node_name: string
  node_docstring: string | null
  exception_type: string
  exception_message: string
  traceback: string
  execution_count: number
  params: Record<string, unknown>
  last_logs: string[]
}

export interface BitmaskEntry {
  width: number
  height: number
  data: string  // base64 PNG, grayscale; nonzero pixels are mask-on
}

export type MetricType = 'line' | 'bar' | 'scatter' | 'pie' | 'histogram'

export interface MetricEntry {
  step: number | null
  value: unknown
  tags: string[]
  timestamp: number
}

export interface LoggableMetricSeries {
  type: MetricType
  entries: MetricEntry[]
}

export interface LabelsPayload {
  points?: number[][]       // each: [x, y]
  boxes?: number[][]        // each: [x1, y1, x2, y2]
  circles?: number[][]      // each: [x, y, r]
  polygons?: number[][][]   // each: list of [x, y]
  bitmask?: BitmaskEntry[]
}

export interface NodeDetail {
  name: string
  func_name: string
  docstring: string | null
  exec_count: number
  is_source: boolean
  params: Record<string, unknown>
  recent_logs: unknown[]
  errors: unknown[]
  metrics: Record<string, LoggableMetricSeries>
  progress: { current: number; total: number; name?: string } | null
}

// Loggable = node-or-global addressable thing that can receive logs, metrics,
// images, audio, etc. `graph.nodes` only contains node-kind loggables; the
// per-run store slices (loggableMetrics, etc.) are keyed by loggableId and may
// contain either kind.
export type LoggableState = NodeDetail & {
  kind: 'node' | 'global'
  loggable_id: string
}

export interface LoggableRegistration {
  loggable_id: string
  kind: 'node' | 'global'
  func_name?: string
  docstring?: string | null
  group?: string | null
  ui_hints?: Record<string, unknown> | null
}

export const api = {
  health: () => get<{ status: string; active_run: string | null; total_runs: number }>('/health'),

  listRuns: () => get<{ runs: RunSummary[]; active_run: string | null }>('/runs'),
  getRun: (id: string) => get<RunSummary>(`/runs/${id}`),
  getRunGraph: (id: string) => get<GraphData>(`/runs/${id}/graph`),
  getRunLogs: (id: string, opts?: { loggable_id?: string; limit?: number }) => {
    const params = new URLSearchParams()
    if (opts?.loggable_id) params.set('loggable_id', opts.loggable_id)
    if (opts?.limit) params.set('limit', String(opts.limit))
    const qs = params.toString()
    return get<{ logs: LogEntry[] }>(`/runs/${id}/logs${qs ? `?${qs}` : ''}`)
  },
  getRunErrors: (id: string) => get<{ errors: ErrorEntry[] }>(`/runs/${id}/errors`),
  getRunMetrics: (id: string) => get<{ metrics: Record<string, Record<string, LoggableMetricSeries>> }>(`/runs/${id}/metrics`),
  getRunImages: (id: string) => get<{ images: Record<string, Array<{ node: string; media_id: string; name: string; step: number | null; timestamp: number; labels?: LabelsPayload | null }>> }>(`/runs/${id}/images`),
  getRunAudio: (id: string) => get<{ audio: Record<string, Array<{ node: string; media_id: string; name: string; sr: number; step: number | null; timestamp: number }>> }>(`/runs/${id}/audio`),
  getMedia: (runId: string, mediaId: string) => get<{ data: string }>(`/runs/${runId}/media/${mediaId}`),

  stopRun: (id: string) => post<{ run_id: string; status: string }>(`/runs/${id}/stop`, {}),
  startRun: (scriptPath: string, args?: string[]) =>
    post<{ run_id: string; pid: number; status: string }>('/run', { script_path: scriptPath, args: args ?? [] }),

  getRunAsks: (id: string) => get<{ pending: Array<{
    ask_id: string; node?: string; node_name?: string; question?: string;
    options?: string[] | null; timeout_seconds?: number | null;
  }> }>(`/runs/${id}/asks`),

  respondToAsk: (runId: string, askId: string, response: string) =>
    post(`/runs/${runId}/ask/${askId}/respond`, { response }),

  getPauseState: (runId: string) =>
    get<{ paused: boolean }>(`/runs/${runId}/pause`),
  pauseRun: (runId: string) =>
    post<{ status: string; paused: boolean }>(`/runs/${runId}/pause`, {}),
  unpauseRun: (runId: string) =>
    post<{ status: string; paused: boolean }>(`/runs/${runId}/unpause`, {}),
}
