import { memo, useCallback, useContext, useEffect, type CSSProperties } from 'react'
import {
  Handle,
  NodeResizer,
  Position,
  useUpdateNodeInternals,
  useStore as useFlowStore,
  type NodeProps,
} from '@xyflow/react'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'
import { Maximize2, ChevronsDownUp, ChevronsUpDown, Link as LinkIcon } from 'lucide-react'
import { LoggableTabContainer } from '@/components/node-tabs/LoggableTabContainer'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useContextMenu } from '@/hooks/useContextMenu'
import { ContextMenu } from '@/components/shared/ContextMenu'
import { ContextMenuItem } from '@/components/shared/ContextMenuItem'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { ConfigChips } from '@/components/shared/ConfigChips'
import { useLoggableHasContent } from '@/hooks/useLoggableHasContent'
import { ChartDprContext } from '@/components/charts/ChartDprContext'
import { buildEmbeddedUrl } from '@/hooks/useEmbeddedView'
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
  // "Live" derives from timestamps: started but no run_completed yet.
  const runIsLive = useStore(s => {
    const summary = s.runs.get(runId)?.summary
    return Boolean(summary?.started_at && !summary?.ended_at)
  })
  const dagDirection = useStore(s => s.dagDirection)
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => { updateNodeInternals(id) }, [dagDirection, id, updateNodeInternals])
  const resizingNodeId = useStore(s => s.resizingNodeId)
  const toggleNodeResize = useStore(s => s.toggleNodeResize)
  const updateNodeSize = useStore(s => s.updateNodeSize)
  const collapseOverride = useStore(s => s.collapsedNodes.get(runId)?.get(nodeId))
  const toggleNodeCollapsed = useStore(s => s.toggleNodeCollapsed)
  const hideTabsOnDrag = useStore(s => s.settings.hideTabsOnDrag)
  const draggingNodeId = useContext(DragContext)
  const isDragging = draggingNodeId === id
  const isResizing = resizingNodeId === id
  const storedSize = useStore(s => s.nodeSizes.get(runId)?.get(nodeId))
  const contextMenu = useContextMenu()
  const hasContent = useLoggableHasContent(runId, nodeId)
  // Drives Chart.js devicePixelRatio inside this node so chart canvases
  // stay sharp when the DAG is zoomed (which CSS-scales every node card).
  const flowZoom = useFlowStore((s) => s.transform[2])

  const onResize = useCallback((_event: unknown, params: { width: number; height: number }) => {
    updateNodeSize(runId, nodeId, { width: params.width, height: params.height })
  }, [runId, nodeId, updateNodeSize])

  if (!nodeInfo) return null

  const isRunning = runIsLive && nodeInfo.exec_count > 0
  const progress = nodeInfo.progress

  const borderColor = hasErrors
    ? 'border-red-500'
    : isRunning
    ? 'border-blue-500'
    : !inDag
    ? 'border-dashed border-muted-foreground/40'
    : 'border-border'

  // Per-node ui_hints (from @nb.fn(ui=...)) — currently we honor `color`
  // as an explicit border color override so the hint has a visible effect
  // in the graph. Status colors (errors/running) still win because they
  // are derived from live run state.
  const uiHints = (nodeInfo.ui_hints ?? null) as { color?: string; collapsed?: boolean } | null
  const hintColor = uiHints?.color
  const hasStatusColor = hasErrors || isRunning
  // Collapsed = explicit user toggle if present, otherwise the SDK's
  // ui_hints.collapsed seed.
  const isCollapsed = collapseOverride ?? uiHints?.collapsed === true
  // Fixed default dimensions. The width is always applied (so children
  // can't push the card wider than the layout intends); the height is
  // applied only when there's content to show and the node isn't
  // collapsed — for header-only or collapsed cards we let the height
  // shrink to the header naturally instead of leaving a tall empty gap.
  // Stored sizes (from a manual resize) override the defaults. This
  // prevents the "snap on Resize click" behavior where opening the
  // resize handles previously dropped a max-w cap and let the chart
  // contents balloon the node to whatever width they wanted.
  const DEFAULT_WIDTH = 360
  const DEFAULT_HEIGHT = 440
  const showsContentArea = hasContent && !isCollapsed
  const effectiveWidth = storedSize?.width ?? DEFAULT_WIDTH
  const effectiveHeight = showsContentArea
    ? storedSize?.height ?? DEFAULT_HEIGHT
    : null
  const nodeStyle: CSSProperties = {
    width: effectiveWidth,
    minWidth: effectiveWidth,
    ...(effectiveHeight !== null
      ? { height: effectiveHeight, minHeight: effectiveHeight }
      : {}),
    ...(hintColor && !hasStatusColor ? { borderColor: hintColor } : {}),
  }

  return (
    <div
      className={cn(
        // Animate only colors / shadow / border so live size changes
        // (drag-resize, default-vs-stored swap) feel immediate.
        // `transition-all` would smooth width/height too and made
        // resizing look laggy.
        'bg-card rounded-lg border-2 shadow-sm transition-colors transition-shadow flex flex-col',
        borderColor,
        hasErrors && 'animate-shake',
        isRunning && !hasErrors && 'shadow-blue-500/20',
      )}
      style={nodeStyle}
      {...contextMenu.handlers}
    >
      {isResizing && !isCollapsed && (
        <NodeResizer minWidth={200} minHeight={80} onResize={onResize} />
      )}
      <ContextMenu isOpen={contextMenu.isOpen} position={contextMenu.position} onClose={contextMenu.close}>
        <ContextMenuItem
          label="Resize"
          icon={<Maximize2 className="w-4 h-4" />}
          disabled={isCollapsed}
          onClick={() => { toggleNodeResize(id); contextMenu.close() }}
        />
        <ContextMenuItem
          label={isCollapsed ? 'Expand' : 'Collapse'}
          icon={isCollapsed
            ? <ChevronsUpDown className="w-4 h-4" />
            : <ChevronsDownUp className="w-4 h-4" />}
          onClick={() => { toggleNodeCollapsed(runId, nodeId); contextMenu.close() }}
        />
        <ContextMenuItem
          label="Copy iframe URL"
          icon={<LinkIcon className="w-4 h-4" />}
          onClick={() => {
            void navigator.clipboard?.writeText(buildEmbeddedUrl({ runId, node: nodeId }))
            contextMenu.close()
          }}
        />
      </ContextMenu>
      {!nodeInfo.is_source && (
        <Handle type="target" position={dagDirection === 'TB' ? Position.Top : Position.Left} className="!bg-muted-foreground !w-2 !h-2" />
      )}

      {/* Node header */}
      <div className="px-3 py-2 select-none shrink-0">
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
          temporarily hidden during drag for performance. The collapsed
          state (from the node context menu, or seeded by ui_hints.collapsed)
          fully suppresses the tab strip too. */}
      {hasContent && !isCollapsed && !(isDragging && hideTabsOnDrag) && (
        // React Flow opt-outs:
        //   `nowheel` — wheel events stay with us (chart zoom + pan)
        //                instead of zooming the DAG viewport.
        //   `nopan`   — left-drag on a chart pans the chart, not the
        //                DAG viewport. Without this, ReactFlow grabs
        //                pointerdown→pointermove and chartjs-plugin-zoom
        //                never sees the drag.
        // Both are class-based so React Flow can detect them by walking
        // the event target's ancestors; using `stopPropagation` here
        // would also kill the chart's native listeners.
        //
        // `flex-1 min-h-0` makes this section absorb the remaining
        // height of the fixed-height node so the LoggableTabContainer
        // can scroll internally instead of growing the card.
        <div className="border-t border-border nowheel nopan flex-1 min-h-0">
          <ErrorBoundary label={`Node ${nodeId}`}>
            <ChartDprContext.Provider value={flowZoom}>
              <LoggableTabContainer runId={runId} loggableId={nodeId} fillParent />
            </ChartDprContext.Provider>
          </ErrorBoundary>
        </div>
      )}
      {hasContent && !isCollapsed && isDragging && hideTabsOnDrag && (
        <div className="border-t border-border flex-1 min-h-0" />
      )}

      <Handle type="source" position={dagDirection === 'TB' ? Position.Bottom : Position.Right} className="!bg-muted-foreground !w-2 !h-2" />
    </div>
  )
})
