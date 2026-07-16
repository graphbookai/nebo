import { useStore } from '@/store'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'

interface RunHoverInfoProps {
  runId: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  children: React.ReactNode
}

/**
 * Hover card with a run's vitals: run id, node count, metric-series count,
 * start time. Wraps its child as the hover trigger (the whole run row, the
 * run-id chip in the header, ...).
 */
export function RunHoverInfo({ runId, side = 'right', children }: RunHoverInfoProps) {
  const nodeCount = useStore(s => s.runs.get(runId)?.summary.node_count ?? 0)
  const started = useStore(s => s.runs.get(runId)?.summary.started_at)
  // Prefer the live per-loggable metric map (updates as WS events stream
  // in); fall back to the summary count for runs whose metrics haven't
  // been loaded into the store yet.
  const metricCount = useStore(s => {
    const run = s.runs.get(runId)
    if (!run) return 0
    let n = 0
    for (const series of Object.values(run.loggableMetrics)) {
      n += Object.keys(series).length
    }
    return n || (run.summary.metric_series_count ?? 0)
  })

  const startedAt = started
    ? new Date(started).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      })
    : null

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} align="start">
        <div className="font-mono">{runId}</div>
        <div className="text-muted-foreground mt-1">
          {nodeCount} node{nodeCount !== 1 ? 's' : ''}
          {' · '}
          {metricCount} metric{metricCount !== 1 ? 's' : ''}
        </div>
        {startedAt && <div className="text-muted-foreground">{startedAt}</div>}
      </TooltipContent>
    </Tooltip>
  )
}
