import { useEffect, useState } from 'react'

export type EmbeddedKind =
  | 'run'
  | 'nodes'
  | 'node'
  | 'logs'
  | 'metrics'
  | 'images'
  | 'audio'

export interface EmbeddedView {
  kind: EmbeddedKind
  runId: string
  // Optional: a node identifier — accepts either the canonical loggable_id
  // (e.g. "module.Class.method") or a bare function name. The view resolves
  // to the matching loggable at render time.
  nodeRef: string | null
  // Optional: a metric/image/audio item name filter.
  name: string | null
}

const VALID: ReadonlySet<EmbeddedKind> = new Set([
  'run', 'nodes', 'node', 'logs', 'metrics', 'images', 'audio',
])

function parse(): EmbeddedView | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const view = params.get('view')
  if (!view || !VALID.has(view as EmbeddedKind)) return null
  // Accept either ?run= or the legacy ?run_id= for the run identifier.
  const runId = params.get('run') ?? params.get('run_id')
  if (!runId) return null
  return {
    kind: view as EmbeddedKind,
    runId,
    nodeRef: params.get('node'),
    name: params.get('name'),
  }
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
