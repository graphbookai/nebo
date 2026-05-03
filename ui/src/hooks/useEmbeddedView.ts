import { useEffect, useState } from 'react'

/**
 * Embedded ("iframe-friendly") view kinds. The kind is inferred from
 * which URL params are present — there is no `view=` discriminator:
 *
 *   ?run=X                   → 'run'    (full DAG + timeline)
 *   ?run=X&dag               → 'dag'    (graph only)
 *   ?run=X&node=Y            → 'node'   (single node detail)
 *   ?run=X&logs              → 'logs'   (logs panel; &node=Y filters)
 *   ?run=X&metrics           → 'metrics' (metrics gallery; &node=Y filters)
 *   ?run=X&metric=NAME       → 'metric'  (single metric; &node=Y filters)
 *   ?run=X&images            → 'images'
 *   ?run=X&image=NAME        → 'image'
 *   ?run=X&audios            → 'audios'
 *   ?run=X&audio=NAME        → 'audio'
 */
export type EmbeddedKind =
  | 'run'
  | 'dag'
  | 'node'
  | 'logs'
  | 'metrics'
  | 'metric'
  | 'images'
  | 'image'
  | 'audios'
  | 'audio'

export interface EmbeddedView {
  kind: EmbeddedKind
  runId: string
  // Optional: a node identifier — accepts either the canonical loggable_id
  // (e.g. "module.Class.method") or a bare function name. The view resolves
  // to the matching loggable at render time.
  nodeRef: string | null
  // For single-item kinds (metric / image / audio): the item name.
  name: string | null
}

function parse(): EmbeddedView | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const runId = params.get('run') ?? params.get('run_id')
  if (!runId) return null

  const nodeRef = params.get('node')

  // Singular-name kinds: `?metric=loss` etc. A non-empty value selects one item.
  const metric = params.get('metric')
  if (metric) return { kind: 'metric', runId, nodeRef, name: metric }
  const image = params.get('image')
  if (image) return { kind: 'image', runId, nodeRef, name: image }
  const audio = params.get('audio')
  if (audio) return { kind: 'audio', runId, nodeRef, name: audio }

  // Plural-flag kinds: presence of the key (any value, including empty)
  // activates the gallery / panel. Order matters only for stable kind
  // selection when callers accidentally combine flags.
  if (params.has('metrics')) return { kind: 'metrics', runId, nodeRef, name: null }
  if (params.has('images')) return { kind: 'images', runId, nodeRef, name: null }
  if (params.has('audios')) return { kind: 'audios', runId, nodeRef, name: null }
  if (params.has('logs')) return { kind: 'logs', runId, nodeRef, name: null }
  if (params.has('dag')) return { kind: 'dag', runId, nodeRef, name: null }

  // Bare `?run=X&node=Y` → single-node detail (no slice flag).
  if (nodeRef) return { kind: 'node', runId, nodeRef, name: null }

  // Bare `?run=X` → full run dashboard.
  return { kind: 'run', runId, nodeRef: null, name: null }
}

/**
 * Read the URL query params that activate an embedded ("iframe-friendly")
 * view. When this returns a non-null value, the App should render only the
 * requested slice of a run instead of the full sidebar/detail layout.
 *
 * Listens to popstate so navigation within the SPA is reflected.
 */
export function useEmbeddedView(): EmbeddedView | null {
  const [view, setView] = useState<EmbeddedView | null>(parse)
  useEffect(() => {
    const handler = () => setView(parse())
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [])
  return view
}

/**
 * Resolve a `node` URL param against the live graph. Tries exact loggable_id
 * match first, then falls back to func_name. Returns null if no match.
 */
export function resolveNodeRef(
  nodeRef: string | null,
  nodes: Record<string, { func_name: string }> | undefined,
): string | null {
  if (!nodeRef || !nodes) return null
  if (nodes[nodeRef]) return nodeRef
  for (const [id, n] of Object.entries(nodes)) {
    if (n.func_name === nodeRef) return id
  }
  return null
}
