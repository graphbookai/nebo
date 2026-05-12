import { memo, type CSSProperties } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useStore } from '@/store'
import { LoggableTabContainer } from '@/components/node-tabs/LoggableTabContainer'
import { useLoggableHasContent } from '@/hooks/useLoggableHasContent'
import type { ExportOptions } from './types'

interface ExportNodeData {
  nodeId: string
  runId: string
  options: ExportOptions
  direction: 'TB' | 'LR'
}

const NODE_WIDTH = 360

export const ExportNode = memo(function ExportNode({ data }: NodeProps) {
  const { nodeId, runId, options, direction } = data as unknown as ExportNodeData

  const nodeInfo = useStore(s => s.runs.get(runId)?.graph?.nodes[nodeId] ?? null)
  const hasContent = useLoggableHasContent(runId, nodeId)

  if (!nodeInfo) return null

  const uiHints = (nodeInfo.ui_hints ?? null) as { color?: string } | null
  const hintColor = uiHints?.color
  const params = nodeInfo.params

  const showTabs = options.tabbedContent === 'active' && hasContent
  const paramEntries = Object.entries(params)
  const showConfig = options.configStyle !== 'none' && paramEntries.length > 0

  const style: CSSProperties = {
    width: NODE_WIDTH,
    minWidth: NODE_WIDTH,
    ...(options.showColorHints && hintColor ? { borderColor: hintColor } : {}),
  }

  return (
    <div
      data-export-atom="node"
      data-node-id={nodeId}
      className="bg-card rounded-lg border-2 border-border shadow-sm flex flex-col"
      style={style}
    >
      {!nodeInfo.is_source && (
        <Handle
          type="target"
          position={direction === 'TB' ? Position.Top : Position.Left}
          className="!bg-muted-foreground !w-2 !h-2"
        />
      )}

      {/* Header */}
      <div className="px-3 py-2 select-none shrink-0">
        <div className="flex items-center gap-1.5">
          <span data-export-atom="title" className="text-sm font-medium truncate flex-1">
            {nodeInfo.func_name}
          </span>
          {options.showExecCount && nodeInfo.exec_count > 0 && (
            <span data-export-atom="exec-count" className="text-xs text-muted-foreground shrink-0">
              x{nodeInfo.exec_count.toLocaleString()}
            </span>
          )}
        </div>
        {options.showDocstring && nodeInfo.docstring && (
          <p
            data-export-atom="docstring"
            className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap"
          >
            {nodeInfo.docstring}
          </p>
        )}

        {showConfig && options.configStyle === 'chips' && (
          <ExportConfigChips params={params} />
        )}
        {showConfig && options.configStyle === 'complete' && (
          <ExportConfigComplete params={params} />
        )}
      </div>

      {showTabs && (
        // pointer-events disabled so the offscreen tree can't be clicked
        // and the user-selected tab from the live UI is the one rendered.
        <div className="border-t border-border flex-1 min-h-0" style={{ pointerEvents: 'none' }}>
          <LoggableTabContainer runId={runId} loggableId={nodeId} fillParent />
        </div>
      )}

      <Handle
        type="source"
        position={direction === 'TB' ? Position.Bottom : Position.Right}
        className="!bg-muted-foreground !w-2 !h-2"
      />
    </div>
  )
})

// Mirror ConfigChips's chip layout but tag each chip with
// `data-export-atom="config-row"` so the drawio walker can lift each
// key=value into its own mxCell.
function ExportConfigChips({ params }: { params: Record<string, unknown> }) {
  const entries = Object.entries(params)
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {entries.slice(0, 3).map(([k, v]) => (
        <span
          key={k}
          data-export-atom="config-row"
          className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground max-w-[140px] truncate"
        >
          {k}: {formatValue(v)}
        </span>
      ))}
      {entries.length > 3 && (
        <span className="text-[10px] text-muted-foreground self-center">+{entries.length - 3}</span>
      )}
    </div>
  )
}

function ExportConfigComplete({ params }: { params: Record<string, unknown> }) {
  return (
    <div className="mt-1.5 space-y-0.5 font-mono text-[10px]">
      {Object.entries(params).map(([k, v]) => (
        <div key={k} data-export-atom="config-row" className="flex justify-between gap-3">
          <span className="text-muted-foreground shrink-0">{k}</span>
          <span className="text-foreground break-all text-right">{formatValue(v)}</span>
        </div>
      ))}
    </div>
  )
}

function formatValue(v: unknown): string {
  if (typeof v === 'object' && v !== null) return JSON.stringify(v)
  return String(v)
}
