import { authHeaders, setUnauthorized } from './auth'

const BASE = ''

function noteAuthStatus(status: number): void {
  // 401 means the daemon enforces auth and our token (if any) didn't
  // match. Surface it so the UI can swap the "Reconnecting" banner for
  // a token prompt. A successful response clears the flag — covers the
  // case where the user just submitted a fresh token.
  if (status === 401) {
    setUnauthorized(true)
  } else if (status >= 200 && status < 300) {
    setUnauthorized(false)
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { ...authHeaders() },
  })
  noteAuthStatus(res.status)
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`)
  return res.json()
}

export interface RunSummary {
  id: string
  script_path: string
  args: string[]
  started_at: string | null
  ended_at: string | null
  node_count: number
  edge_count: number
  log_count: number
  error_count: number
  run_name: string | null
  run_config?: Record<string, unknown>
  metric_series_count?: number
  latest_step?: number | null
}

export interface GraphData {
  nodes: Record<string, {
    name: string
    func_name: string
    docstring: string | null
    exec_count: number
    is_source: boolean
    params: Record<string, unknown>
    progress: { current: number; total: number; name?: string } | null
    group: string | null
    ui_hints: Record<string, unknown> | null
  }>
  edges: { source: string; target: string }[]
  workflow_description: string | null
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
  // Set on log_scatter / log_histogram emissions when the user passed
  // colors=True. The chart components read this to decide whether to
  // distinguish labels by palette color (true) or by shape only (false).
  colors?: boolean
}

export interface LoggableMetricSeries {
  type: MetricType
  entries: MetricEntry[]
}

export interface LabelGroup<T> {
  data: T
  color: string
}

export interface PolygonsLabelGroup extends LabelGroup<number[][][]> {
  // True (default): fill the interior of each polygon with `color` at
  // the rendered opacity. False: stroke the outline only.
  fill?: boolean
}

export interface LabelsPayload {
  points?: LabelGroup<number[][]>[]       // each entry: list of [x, y]
  boxes?: LabelGroup<number[][]>[]        // each entry: list of [x1, y1, x2, y2]
  circles?: LabelGroup<number[][]>[]      // each entry: list of [x, y, r]
  polygons?: PolygonsLabelGroup[]         // each entry: list of polygons
  bitmasks?: LabelGroup<BitmaskEntry[]>[]
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

// Loggable = node-or-non-node addressable thing that can receive logs, metrics,
// images, audio, etc. `graph.nodes` only contains node-kind loggables; the
// per-run store slices (loggableMetrics, etc.) are keyed by loggableId and may
// contain any kind. Non-node kinds: `global` (user logs outside any node),
// `agent` (entries authored over MCP by an external agent).
export type LoggableState = NodeDetail & {
  kind: 'node' | 'global' | 'agent'
  loggable_id: string
}

export interface LoggableRegistration {
  loggable_id: string
  kind: 'node' | 'global' | 'agent'
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
}
