import { memo, useMemo, useState } from 'react'
import { useStore } from '@/store'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { LoggableTabContainer } from '@/components/node-tabs/LoggableTabContainer'
import { topologicalSort } from '@/lib/graph'

// Extracted to module level so React preserves instance identity across parent re-renders.
// This prevents LoggableTabContainer (and its active tab state) from being unmounted/remounted.
const NodeCardHeader = memo(function NodeCardHeader({
  runId,
  loggableId,
  isDag,
  isExpanded,
  onToggle,
}: {
  runId: string
  loggableId: string
  isDag: boolean
  isExpanded: boolean
  onToggle: () => void
}) {
  const node = useStore(s => s.runs.get(runId)?.graph?.nodes[loggableId])
  const hasErrors = useStore(s => (s.runs.get(runId)?.errors ?? []).some(e => e.node_name === loggableId))
  const isRunning = useStore(s => s.runs.get(runId)?.summary.status === 'running') && (node?.exec_count ?? 0) > 0

  if (!node) return null

  const progress = node.progress
  const borderColor = hasErrors
    ? 'border-red-500'
    : isRunning
    ? 'border-blue-500'
    : !isDag
    ? 'border-dashed border-muted-foreground/40'
    : 'border-border'

  return (
    <div
      className={cn(
        'border-2 rounded-lg transition-all cursor-pointer',
        borderColor,
        !isDag && 'opacity-80',
      )}
      onClick={onToggle}
    >
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate flex-1">{node.func_name}</span>
          {node.exec_count > 0 && (
            <span className="text-xs text-muted-foreground shrink-0">
              x{node.exec_count.toLocaleString()}
            </span>
          )}
        </div>

        {node.docstring && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
            {node.docstring.split('\n')[0]}
          </p>
        )}

        {Object.keys(node.params).length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {Object.entries(node.params).slice(0, 3).map(([k, v]) => (
              <span key={k} className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                {k}: {String(v)}
              </span>
            ))}
            {Object.keys(node.params).length > 3 && (
              <span className="text-[10px] text-muted-foreground">
                +{Object.keys(node.params).length - 3}
              </span>
            )}
          </div>
        )}

        {progress && (
          <div className="mt-2">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-0.5">
              <span>{progress.name ?? 'Progress'}</span>
              <span>{Math.round((progress.current / progress.total) * 100)}%</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="border-t border-border" onClick={e => e.stopPropagation()}>
          <LoggableTabContainer runId={runId} loggableId={loggableId} />
        </div>
      )}
    </div>
  )
})

const GlobalCardHeader = memo(function GlobalCardHeader({
  runId,
  isExpanded,
  onToggle,
}: {
  runId: string
  isExpanded: boolean
  onToggle: () => void
}) {
  const desc = useStore(s => s.runs.get(runId)?.graph?.workflow_description) ?? ''
  return (
    <div
      className="border-2 border-l-4 border-l-blue-500 rounded-lg cursor-pointer transition-all"
      onClick={onToggle}
    >
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate flex-1">Global</span>
        </div>
        {desc && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
            {desc.split('\n')[0].replace(/^#\s*/, '')}
          </p>
        )}
      </div>
      {isExpanded && (
        <div className="border-t border-border" onClick={e => e.stopPropagation()}>
          <LoggableTabContainer runId={runId} loggableId="__global__" />
        </div>
      )}
    </div>
  )
})

const LoggableCard = memo(function LoggableCard({
  runId,
  loggableId,
  kind,
  isDag,
  isExpanded,
  onToggle,
}: {
  runId: string
  loggableId: string
  kind: 'node' | 'global'
  isDag: boolean
  isExpanded: boolean
  onToggle: () => void
}) {
  if (kind === 'global') {
    return <GlobalCardHeader runId={runId} isExpanded={isExpanded} onToggle={onToggle} />
  }
  return (
    <NodeCardHeader
      runId={runId}
      loggableId={loggableId}
      isDag={isDag}
      isExpanded={isExpanded}
      onToggle={onToggle}
    />
  )
})

interface LoggableGridViewProps {
  runId: string
}

export function LoggableGridView({ runId }: LoggableGridViewProps) {
  const graph = useStore(s => s.runs.get(runId)?.graph)
  const globalLoggable = useStore(s => s.runs.get(runId)?.globalLoggable)
  const collapseByDefault = useStore(s => s.settings.collapseNodesByDefault)
  const hideUncalled = useStore(s => s.settings.hideUncalledFunctions)

  const allNodeIds = useMemo(() => graph
    ? Object.keys(graph.nodes).filter(id => !hideUncalled || graph.nodes[id].exec_count > 0)
    : [], [graph, hideUncalled])

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    return collapseByDefault ? new Set() : new Set(allNodeIds)
  })

  if (!graph) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">Loading...</p>
      </div>
    )
  }

  const targetSet = new Set(graph.edges.map(e => e.target))
  const sourceSet = new Set(graph.edges.map(e => e.source))
  const dagNodeIds = allNodeIds.filter(id => sourceSet.has(id) || targetSet.has(id) || graph.nodes[id].is_source)
  const nonDagNodeIds = allNodeIds.filter(id => !dagNodeIds.includes(id))
  const sorted = topologicalSort(dagNodeIds, graph.edges)

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <ScrollArea className="h-full">
      {/* Global card first */}
      {globalLoggable && (
        <div className="grid grid-cols-1 gap-3 p-3 pb-0">
          <LoggableCard
            runId={runId}
            loggableId="__global__"
            kind="global"
            isDag={false}
            isExpanded={expanded.has("__global__")}
            onToggle={() => toggle("__global__")}
          />
        </div>
      )}

      {/* DAG nodes */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 p-3">
        {sorted.map(id => (
          <LoggableCard
            key={id}
            runId={runId}
            loggableId={id}
            kind="node"
            isDag={true}
            isExpanded={expanded.has(id)}
            onToggle={() => toggle(id)}
          />
        ))}
      </div>

      {/* Uncalled */}
      {nonDagNodeIds.length > 0 && (
        <>
          <div className="flex items-center gap-2 px-3 pt-2 pb-1">
            <div className="h-px flex-1 bg-border border-dashed" />
            <span className="text-xs text-muted-foreground">Not in DAG</span>
            <div className="h-px flex-1 bg-border border-dashed" />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 p-3 pt-1">
            {nonDagNodeIds.map(id => (
              <LoggableCard
                key={id}
                runId={runId}
                loggableId={id}
                kind="node"
                isDag={false}
                isExpanded={expanded.has(id)}
                onToggle={() => toggle(id)}
              />
            ))}
          </div>
        </>
      )}
    </ScrollArea>
  )
}
