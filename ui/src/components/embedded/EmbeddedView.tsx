import { useEffect, useMemo } from 'react'
import { useStore } from '@/store'
import { useRunData } from '@/hooks/useRunData'
import { useEmbeddedView, resolveNodeRef, type EmbeddedView as EmbeddedSpec } from '@/hooks/useEmbeddedView'
import { DagGraph } from '@/components/graph/DagGraph'
import { LoggableTabContainer } from '@/components/node-tabs/LoggableTabContainer'
import { MetricBlock } from '@/components/node-tabs/NodeMetrics'
import { ImageItem } from '@/components/node-tabs/NodeImages'
import { AudioItem } from '@/components/node-tabs/NodeAudio'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { ConfigChips } from '@/components/shared/ConfigChips'
import { ScrollArea } from '@/components/ui/scroll-area'
import { DEFAULT_RUN_COLOR } from '@/lib/colors'
import { TimelineScrubber } from '@/components/timeline/TimelineScrubber'

/**
 * Top-level dispatcher for `?view=<kind>&run=<id>...` URLs. Renders only the
 * requested slice of a run with no sidebar / app header — designed for
 * iframe embeds.
 */
export function EmbeddedView({ spec }: { spec: EmbeddedSpec }) {
  // Make sure the requested run is the selected one so existing components
  // that read selectedRunId behave consistently inside the embed.
  const selectRun = useStore(s => s.selectRun)
  useEffect(() => {
    selectRun(spec.runId)
  }, [spec.runId, selectRun])

  const run = useRunData(spec.runId)

  if (!run) {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground">
        <p className="text-sm">Loading run…</p>
      </div>
    )
  }

  switch (spec.kind) {
    case 'run':
      return <EmbeddedRun runId={spec.runId} />
    case 'nodes':
      return <EmbeddedNodes runId={spec.runId} />
    case 'node':
      return <EmbeddedNode spec={spec} />
    case 'logs':
      return <EmbeddedLogs spec={spec} />
    case 'metrics':
      return <EmbeddedMetrics spec={spec} />
    case 'images':
      return <EmbeddedImages spec={spec} />
    case 'audio':
      return <EmbeddedAudio spec={spec} />
  }
}

function EmbeddedRun({ runId }: { runId: string }) {
  return (
    <div className="flex flex-col h-screen">
      <div className="flex-1 overflow-hidden">
        <DagGraph runId={runId} />
      </div>
      <TimelineScrubber runId={runId} />
    </div>
  )
}

function EmbeddedNodes({ runId }: { runId: string }) {
  return (
    <div className="h-screen">
      <DagGraph runId={runId} />
    </div>
  )
}

function EmbeddedNode({ spec }: { spec: EmbeddedSpec }) {
  const graph = useStore(s => s.runs.get(spec.runId)?.graph)
  const nodeId = useMemo(
    () => resolveNodeRef(spec.nodeRef, graph?.nodes),
    [spec.nodeRef, graph?.nodes],
  )
  const node = nodeId ? graph?.nodes[nodeId] : null

  if (!nodeId || !node) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Node not found: <code>{spec.nodeRef ?? '(no node param)'}</code>
      </div>
    )
  }

  return (
    <ScrollArea className="h-screen">
      <div className="border-2 border-border rounded-lg m-3">
        <div className="px-3 py-2.5 border-b border-border">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium truncate">{node.func_name}</span>
            {node.exec_count > 0 && (
              <span className="text-xs text-muted-foreground shrink-0">
                x{node.exec_count.toLocaleString()}
              </span>
            )}
          </div>
          {node.docstring && (
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1 cursor-help">
                  {node.docstring.split('\n')[0]}
                </p>
              </TooltipTrigger>
              <TooltipContent side="top" align="start">{node.docstring}</TooltipContent>
            </Tooltip>
          )}
          <ConfigChips params={node.params} />
        </div>
        <div className="p-3">
          <LoggableTabContainer runId={spec.runId} loggableId={nodeId} />
        </div>
      </div>
    </ScrollArea>
  )
}

function EmbeddedLogs({ spec }: { spec: EmbeddedSpec }) {
  const logsRaw = useStore(s => s.runs.get(spec.runId)?.logs)
  const logs = logsRaw ?? EMPTY_LOGS
  const graph = useStore(s => s.runs.get(spec.runId)?.graph)
  const filterNodeId = useMemo(
    () => resolveNodeRef(spec.nodeRef, graph?.nodes),
    [spec.nodeRef, graph?.nodes],
  )
  const filtered = filterNodeId ? logs.filter(l => l.node === filterNodeId) : logs

  return (
    <ScrollArea className="h-screen">
      <div className="font-mono text-xs p-3 space-y-0.5">
        {filtered.length === 0 && (
          <p className="text-muted-foreground">No logs</p>
        )}
        {filtered.map((l, i) => (
          <div key={i} className={l.level === 'error' ? 'text-red-400' : l.level === 'warning' ? 'text-yellow-400' : ''}>
            {l.node && <span className="text-muted-foreground mr-2">[{l.node}]</span>}
            <span>{l.message}</span>
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}

function EmbeddedMetrics({ spec }: { spec: EmbeddedSpec }) {
  const allMetricsRaw = useStore(s => s.runs.get(spec.runId)?.loggableMetrics)
  const allMetrics = allMetricsRaw ?? EMPTY_METRICS_MAP
  const runColor = useStore(s => s.runColors.get(spec.runId)) ?? DEFAULT_RUN_COLOR
  const graph = useStore(s => s.runs.get(spec.runId)?.graph)
  const filterNodeId = resolveNodeRef(spec.nodeRef, graph?.nodes)

  const items = useMemo(() => {
    const out: { loggableId: string; name: string; series: typeof allMetrics[string][string] }[] = []
    for (const [lid, byName] of Object.entries(allMetrics)) {
      if (filterNodeId && lid !== filterNodeId) continue
      for (const [name, series] of Object.entries(byName)) {
        if (spec.name && name !== spec.name) continue
        out.push({ loggableId: lid, name, series })
      }
    }
    return out
  }, [allMetrics, filterNodeId, spec.name])

  return (
    <ScrollArea className="h-screen">
      <div className="p-3 space-y-4">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">No metrics</p>
        ) : (
          items.map(({ loggableId, name, series }) => (
            <MetricBlock key={`${loggableId}:${name}`} name={name} series={series} color={runColor} />
          ))
        )}
      </div>
    </ScrollArea>
  )
}

function EmbeddedImages({ spec }: { spec: EmbeddedSpec }) {
  const allImagesRaw = useStore(s => s.runs.get(spec.runId)?.loggableImages)
  const allImages = allImagesRaw ?? EMPTY_IMAGES_MAP
  const graph = useStore(s => s.runs.get(spec.runId)?.graph)
  const filterNodeId = resolveNodeRef(spec.nodeRef, graph?.nodes)

  const items = useMemo(() => {
    const out: { loggableId: string; img: typeof allImages[string][number] }[] = []
    for (const [lid, list] of Object.entries(allImages)) {
      if (filterNodeId && lid !== filterNodeId) continue
      for (const img of list) {
        if (spec.name && img.name !== spec.name) continue
        out.push({ loggableId: lid, img })
      }
    }
    return out
  }, [allImages, filterNodeId, spec.name])

  return (
    <ScrollArea className="h-screen">
      <div className="p-3 space-y-3">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">No images</p>
        ) : (
          items.map(({ loggableId, img }) => (
            <ImageItem key={img.mediaId} runId={spec.runId} loggableId={loggableId} img={img} showTimestamp />
          ))
        )}
      </div>
    </ScrollArea>
  )
}

function EmbeddedAudio({ spec }: { spec: EmbeddedSpec }) {
  const allAudioRaw = useStore(s => s.runs.get(spec.runId)?.loggableAudio)
  const allAudio = allAudioRaw ?? EMPTY_AUDIO_MAP
  const graph = useStore(s => s.runs.get(spec.runId)?.graph)
  const filterNodeId = resolveNodeRef(spec.nodeRef, graph?.nodes)

  const items = useMemo(() => {
    const out: { loggableId: string; entry: typeof allAudio[string][number] }[] = []
    for (const [lid, list] of Object.entries(allAudio)) {
      if (filterNodeId && lid !== filterNodeId) continue
      for (const entry of list) {
        if (spec.name && entry.name !== spec.name) continue
        out.push({ loggableId: lid, entry })
      }
    }
    return out
  }, [allAudio, filterNodeId, spec.name])

  return (
    <ScrollArea className="h-screen">
      <div className="p-3 space-y-3">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">No audio</p>
        ) : (
          items.map(({ loggableId, entry }) => (
            <AudioItem key={entry.mediaId} runId={spec.runId} entry={entry} showTimestamp />
          ))
        )}
        {/* loggableId currently unused in AudioItem, but we capture it so we
            can support tag/labels per loggable later without re-keying. */}
        <span className="hidden">{items.map(i => i.loggableId).join(',')}</span>
      </div>
    </ScrollArea>
  )
}

// Module-level empty fallbacks: shared references prevent zustand selectors
// from returning a fresh `[]` / `{}` on every render and re-firing the
// subscription.
const EMPTY_LOGS: import('@/lib/api').LogEntry[] = []
const EMPTY_METRICS_MAP: Record<string, Record<string, import('@/lib/api').LoggableMetricSeries>> = {}
const EMPTY_IMAGES_MAP: Record<string, import('@/store').ImageEntry[]> = {}
const EMPTY_AUDIO_MAP: Record<string, import('@/store').AudioEntry[]> = {}

// Re-export for callers that need the parser without the renderer.
export { useEmbeddedView } from '@/hooks/useEmbeddedView'
