import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useContextMenu } from '@/hooks/useContextMenu'
import { useStore } from '@/store'
import { RunContextMenu } from './RunContextMenu'
import { RunHoverInfo } from './RunHoverInfo'
import type { RunSummary } from '@/lib/api'

interface RunCardProps {
  run: RunSummary
  selected: boolean
  onClick: () => void
}

export function RunCard({ run, selected, onClick }: RunCardProps) {
  const scriptName = run.script_path.split('/').pop() ?? run.script_path
  const customName = useStore(s => s.runNames.get(run.id))
  const setRunName = useStore(s => s.setRunName)
  const getOrAssignRunColor = useStore(s => s.getOrAssignRunColor)
  const runColor = useStore(s => s.runColors.get(run.id))
  const isSelectedForCompare = useStore(s => s.selectedForCompare.has(run.id))
  const selectedRunId = useStore(s => s.selectedRunId)
  const comparisonGroups = useStore(s => s.comparisonGroups)

  // When viewing a comparison group, check if a comparison is active and whether this run is in it
  const comparisonActive = selectedRunId?.startsWith('cmp:') ?? false
  const isInActiveComparison = useMemo(() => {
    if (!comparisonActive || !selectedRunId) return false
    const group = comparisonGroups.get(selectedRunId)
    return group?.runIds.includes(run.id) ?? false
  }, [comparisonActive, selectedRunId, comparisonGroups, run.id])
  const contextMenu = useContextMenu()

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const displayName = customName || run.run_name || scriptName

  const startEditing = useCallback(() => {
    setDraft(displayName)
    setEditing(true)
  }, [displayName])

  const commitEdit = useCallback(() => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed && trimmed !== scriptName) {
      setRunName(run.id, trimmed)
    } else if (!trimmed || trimmed === scriptName) {
      setRunName(run.id, '') // clear custom name, revert to default
    }
  }, [draft, scriptName, run.id, setRunName])

  useEffect(() => {
    getOrAssignRunColor(run.id)
  }, [run.id, getOrAssignRunColor])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const startedAt = run.started_at
    ? new Date(run.started_at).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      })
    : null

  return (
    <RunHoverInfo runId={run.id} side="right">
      {/* div with button semantics instead of <button>: the card body can
          host interactive children (the rename input), and buttons can't
          nest. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick()
          }
        }}
        {...contextMenu.handlers}
        className={cn(
          'w-full text-left px-4 py-3 rounded-lg transition-colors relative cursor-pointer',
          'hover:bg-accent/50',
          selected && 'bg-accent border border-accent-foreground/10',
          !selected && 'border border-transparent',
          isSelectedForCompare && 'ring-2 ring-primary/40',
          comparisonActive && !isInActiveComparison && 'opacity-40',
        )}
        style={{ borderLeft: `3px solid ${runColor ?? 'transparent'}` }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {editing ? (
              <input
                ref={inputRef}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitEdit()
                  if (e.key === 'Escape') setEditing(false)
                }}
                onClick={e => e.stopPropagation()}
                className="w-full text-sm font-medium bg-background border border-border rounded px-1 py-0 outline-none focus:ring-1 focus:ring-ring"
              />
            ) : (
              <div
                className="text-sm font-medium truncate cursor-text"
                onDoubleClick={(e) => { e.stopPropagation(); startEditing() }}
                title="Double-click to rename"
              >
                {displayName}
              </div>
            )}
            {startedAt && <div className="text-xs text-muted-foreground mt-0.5">{startedAt}</div>}
          </div>
        </div>
        {isSelectedForCompare && (
          <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-primary" title="Selected for compare" />
        )}
        <RunContextMenu
          runId={run.id}
          isOpen={contextMenu.isOpen}
          position={contextMenu.position}
          onClose={contextMenu.close}
        />
      </div>
    </RunHoverInfo>
  )
}
