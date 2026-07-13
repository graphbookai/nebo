import { useStore } from '@/store'
import { RunCard } from './RunCard'
import { cn } from '@/lib/utils'
import { ChevronRight, Folder, FolderOpen, FileText } from 'lucide-react'
import type { RunSummary } from '@/lib/api'

function byStartedDesc(a: RunSummary, b: RunSummary): number {
  const at = a.started_at ? new Date(a.started_at).getTime() : 0
  const bt = b.started_at ? new Date(b.started_at).getTime() : 0
  return bt - at
}

/** The sidebar's group hierarchy: collapsible groups with their member runs,
 *  plus root (ungrouped) runs. Read-only — reorganization is via the CLI/MCP. */
export function RunTree() {
  const runs = useStore(s => s.runs)
  const runTree = useStore(s => s.runTree)
  const selectedRunId = useStore(s => s.selectedRunId)
  const selectRun = useStore(s => s.selectRun)

  const summaries = Array.from(runs.values(), r => r.summary)
  const byId = new Map(summaries.map(s => [s.id, s] as [string, RunSummary]))
  const placements = runTree.runs

  const topGroups = Object.keys(runTree.groups)
    .filter(g => !g.includes('/'))
    .sort()
  const rootRuns = summaries.filter(s => !(s.id in placements)).sort(byStartedDesc)

  return (
    <>
      {topGroups.map(g => (
        <GroupBranch key={g} path={g} depth={0} byId={byId} />
      ))}
      {rootRuns.map(s => (
        <RunCard
          key={s.id}
          run={s}
          selected={s.id === selectedRunId}
          onClick={() => selectRun(s.id)}
        />
      ))}
    </>
  )
}

function GroupBranch({
  path,
  depth,
  byId,
}: {
  path: string
  depth: number
  byId: Map<string, RunSummary>
}) {
  const runTree = useStore(s => s.runTree)
  const expanded = useStore(s => s.expandedGroups.has(path))
  const toggle = useStore(s => s.toggleGroupExpanded)
  const selectGroup = useStore(s => s.selectGroup)
  const selectedGroup = useStore(s => s.selectedGroup)
  const selectRun = useStore(s => s.selectRun)
  const selectedRunId = useStore(s => s.selectedRunId)

  const leaf = path.split('/').pop() ?? path
  const docs = runTree.groups[path]?.docs ?? []
  const prefix = path + '/'
  const childGroups = Object.keys(runTree.groups)
    .filter(g => g.startsWith(prefix) && !g.slice(prefix.length).includes('/'))
    .sort()
  const memberRuns = Object.entries(runTree.runs)
    .filter(([, g]) => g === path)
    .map(([id]) => byId.get(id))
    .filter((s): s is RunSummary => Boolean(s))
    .sort(byStartedDesc)

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 rounded px-1.5 py-1 text-xs',
          selectedGroup === path && 'bg-muted',
        )}
        style={{ paddingLeft: 6 + depth * 12 }}
      >
        <button
          onClick={() => toggle(path)}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={expanded ? 'Collapse group' : 'Expand group'}
        >
          <ChevronRight
            className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-90')}
          />
        </button>
        <button
          onClick={() => selectGroup(path)}
          className="flex items-center gap-1 min-w-0 flex-1 text-left hover:text-foreground"
          title={path}
        >
          {expanded ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate font-medium">{leaf}</span>
          {docs.length > 0 && (
            <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
          )}
        </button>
      </div>
      {expanded && (
        <div>
          {childGroups.map(g => (
            <GroupBranch key={g} path={g} depth={depth + 1} byId={byId} />
          ))}
          <div className="space-y-1" style={{ paddingLeft: 6 + (depth + 1) * 12 }}>
            {memberRuns.map(s => (
              <RunCard
                key={s.id}
                run={s}
                selected={s.id === selectedRunId}
                onClick={() => selectRun(s.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
