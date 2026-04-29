import { memo, useCallback, useContext, useEffect, type CSSProperties } from 'react'
import { Handle, NodeResizer, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'
import { Maximize2 } from 'lucide-react'
import { LoggableTabContainer } from '@/components/node-tabs/LoggableTabContainer'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useContextMenu } from '@/hooks/useContextMenu'
import { ContextMenu } from '@/components/shared/ContextMenu'
import { ContextMenuItem } from '@/components/shared/ContextMenuItem'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { ConfigChips } from '@/components/shared/ConfigChips'
import { useLoggableHasContent } from '@/hooks/useLoggableHasContent'
import { DragContext } from './DagGraph'

interface NeboNodeData {
  nodeId: string
  runId: string
  inDag: boolean
}

export const NeboNode = memo(function NeboNode({ data, id }: NodeProps) {
  const { nodeId, runId, inDag } = data as unknown as NeboNodeData

  // Granular selectors — only re-render when THIS node's data changes, not on every log/metric append
  const nodeInfo = useStore(s => s.runs.get(runId)?.graph?.nodes[nodeId] ?? null)
  const hasErrors = useStore(s => (s.runs.get(runId)?.errors ?? []).some(e => e.node_name === nodeId))
  const runStatus = useStore(s => s.runs.get(runId)?.summary.status ?? null)
  const hasPendingAsk = useStore(s => {
    const asks = s.runs.get(runId)?.pendingAsks
    if (!asks || asks.size === 0) return false
    for (const a of asks.values()) { if (a.nodeName === nodeId) return true }
    return false
  })
  const dagDirection = useStore(s => s.dagDirection)
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => { updateNodeInternals(id) }, [dagDirection, id, updateNodeInternals])
  const resizingNodeId = useStore(s => s.resizingNodeId)
  const toggleNodeResize = useStore(s => s.toggleNodeResize)
  const updateNodeSize = useStore(s => s.updateNodeSize)
  const hideTabsOnDrag = useStore(s => s.settings.hideTabsOnDrag)
  const draggingNodeId = useContext(DragContext)
  const isDragging = draggingNodeId === id
  const isResizing = resizingNodeId === id
  const storedSize = useStore(s => s.nodeSizes.get(runId)?.get(nodeId))
  const contextMenu = useContextMenu()
  const hasContent = useLoggableHasContent(runId, nodeId)

  const onResize = useCallback((_event: unknown, params: { width: number; height: number }) => {
    updateNodeSize(runId, nodeId, { width: params.width, height: params.height })
  }, [runId, nodeId, updateNodeSize])

  if (!nodeInfo) return null

  const isRunning = runStatus === 'running' && nodeInfo.exec_count > 0
  const progress = nodeInfo.progress

  const borderColor = hasErrors
    ? 'border-red-500'
    : hasPendingAsk
    ? 'border-amber-500'
    : isRunning
    ? 'border-blue-500'
    : !inDag
    ? 'border-dashed border-muted-foreground/40'
    : 'border-border'

  // Per-node ui_hints (from @nb.fn(ui=...)) — currently we honor `color`
  // as an explicit border color override so the hint has a visible effect
  // in the graph. Status colors (errors/running/ask) still win because they
  // are derived from live run state.
  const uiHints = (nodeInfo.ui_hints ?? null) as { color?: string } | null
  const hintColor = uiHints?.color
  const hasStatusColor = hasErrors || hasPendingAsk || isRunning
  // The store already carries both width and height (set by NodeResizer's
  // onResize callback). Earlier we only applied `width` to nodeStyle, so
  // dragging the south handle bumped the stored height but the DOM never
  // grew — height appeared "stuck". Apply both axes here.
  const nodeStyle: CSSProperties = {
    ...(storedSize
      ? {
          width: storedSize.width,
          minWidth: storedSize.width,
          height: storedSize.height,
          minHeight: storedSize.height,
        }
      : {}),
    ...(hintColor && !hasStatusColor ? { borderColor: hintColor } : {}),
  }

  return (
    <div
      className={cn(
        'bg-card rounded-lg border-2 shadow-sm transition-all',
        !storedSize && !isResizing && 'min-w-[240px] max-w-[320px]',
        borderColor,
        hasErrors && 'animate-shake',
        isRunning && !hasErrors && 'shadow-blue-500/20',
        hasPendingAsk && 'shadow-amber-500/30',
      )}
      style={nodeStyle}
      {...contextMenu.handlers}
    >
      {isResizing && (
        <NodeResizer minWidth={200} minHeight={80} onResize={onResize} />
      )}
      <ContextMenu isOpen={contextMenu.isOpen} position={contextMenu.position} onClose={contextMenu.close}>
        <ContextMenuItem
          label="Resize"
          icon={<Maximize2 className="w-4 h-4" />}
          onClick={() => { toggleNodeResize(id); contextMenu.close() }}
        />
      </ContextMenu>
      {!nodeInfo.is_source && (
        <Handle type="target" position={dagDirection === 'TB' ? Position.Top : Position.Left} className="!bg-muted-foreground !w-2 !h-2" />
      )}

      {/* Node header */}
      <div className="px-3 py-2 select-none">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium truncate flex-1">{nodeInfo.func_name}</span>
          {nodeInfo.exec_count > 0 && (
            <span className="text-xs text-muted-foreground shrink-0">
              x{nodeInfo.exec_count.toLocaleString()}
            </span>
          )}
        </div>
        {nodeInfo.docstring && (
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1 cursor-help">
                {nodeInfo.docstring.split('\n')[0]}
              </p>
            </TooltipTrigger>
            <TooltipContent side="top" align="start">
              {nodeInfo.docstring}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Config params */}
        <ConfigChips params={nodeInfo.params} />

        {/* Progress bar */}
        {progress && (
          <div className="mt-2">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-0.5">
              <span>{progress.name ?? 'Progress'}</span>
              <span>
                {progress.current}/{progress.total}
                {progress.total > 0 && (
                  <span className="ml-1 text-muted-foreground/70">
                    ({Math.round((progress.current / progress.total) * 100)}%)
                  </span>
                )}
              </span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Non-DAG indicator */}
        {!inDag && (
          <span className="text-[10px] text-muted-foreground mt-1 block">Not in DAG</span>
        )}
      </div>

      {/* Tab content — rendered only when this node has data to show, and
          temporarily hidden during drag for performance. */}
      {hasContent && !(isDragging && hideTabsOnDrag) && (
        <div className="border-t border-border" onWheelCapture={e => e.stopPropagation()}>
          <ErrorBoundary label={`Node ${nodeId}`}>
            <LoggableTabContainer runId={runId} loggableId={nodeId} />
          </ErrorBoundary>
        </div>
      )}
      {hasContent && isDragging && hideTabsOnDrag && (
        <div className="border-t border-border h-[40px]" />
      )}

      <Handle type="source" position={dagDirection === 'TB' ? Position.Bottom : Position.Right} className="!bg-muted-foreground !w-2 !h-2" />
    </div>
  )
})
