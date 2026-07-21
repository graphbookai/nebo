import { useEffect, useMemo, useState } from 'react'
import { useStore } from '@/store'
import type { RunSummary } from '@/lib/api'
import { isRunLive } from '@/lib/api'
import {
  byStartedDesc,
  childGroupsOf,
  filterRunTree,
  membersOf,
  runDisplayName,
  type TreeFilter,
} from '@/lib/runTree'
import { Sparkline } from './Sparkline'
import { firstLineSeriesValues, shortId, timeAgo } from './util'
import {
  ArrowLeft, ChevronDown, ChevronRight, FileText, Folder, Search,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// Mobile home screen: search + the run tree as cards. Groups expand one
// level inline; deeper subgroups render as drill cards that replace the
// list with that group's contents behind a breadcrumb row.
export function MobileRunList() {
  const runs = useStore(s => s.runs)
  const runTree = useStore(s => s.runTree)
  const runNames = useStore(s => s.runNames)
  const connected = useStore(s => s.connected)
  const [query, setQuery] = useState('')
  // Group path the list is currently drilled into (null = root). A
  // drilled-into group can disappear (deleted via CLI/MCP) — derive the
  // effective value so an orphaned crumb falls back to the root.
  const [drillRaw, setDrill] = useState<string | null>(null)

  const summaries = useMemo(() => Array.from(runs.values(), r => r.summary), [runs])
  const byId = useMemo(
    () => new Map(summaries.map(s => [s.id, s] as [string, RunSummary])),
    [summaries],
  )
  const filter = filterRunTree(runTree, byId, s => runDisplayName(s, runNames.get(s.id)), query)
  const searching = filter !== null

  const drill = drillRaw != null && drillRaw in runTree.groups ? drillRaw : null

  const groupsHere = (drill == null
    ? Object.keys(runTree.groups).filter(g => !g.includes('/'))
    : childGroupsOf(runTree.groups, drill)
  )
    .filter(g => !filter || filter.groups.has(g))
    .sort()
  const runsHere = (drill == null
    ? summaries.filter(s => !(s.id in runTree.runs))
    : membersOf(runTree.runs, drill, byId)
  )
    .filter(s => !filter || filter.runs.has(s.id))
    .sort(byStartedDesc)

  const empty = runs.size === 0 && Object.keys(runTree.groups).length === 0

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-end justify-between px-5 pb-1 pt-4">
        <span className="text-[26px] font-bold tracking-tight">Runs</span>
        <span
          className={cn(
            'mb-1.5 flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px]',
            connected
              ? 'border-green-500/25 bg-green-500/10 text-green-500'
              : 'border-border bg-muted text-muted-foreground',
          )}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', connected ? 'bg-green-500' : 'bg-muted-foreground')} />
          {connected ? 'connected' : 'offline'}
        </span>
      </div>

      <div className="px-4 pb-1 pt-2">
        <div className="flex items-center gap-2 rounded-[10px] border border-border bg-muted/60 px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search runs"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full border-none bg-transparent py-2.5 text-[13px] outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-10 pt-2">
        {empty && (
          <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
            <p className="text-sm">No runs yet</p>
            <p className="mt-1 text-xs">
              Start a pipeline with <code className="rounded bg-muted px-1 py-0.5 text-xs">nebo run</code>
            </p>
          </div>
        )}

        {drill != null && (
          <button
            onClick={() => setDrill(drill.includes('/') ? drill.slice(0, drill.lastIndexOf('/')) : null)}
            className="mb-2 flex min-h-8 w-full items-center gap-2 px-1 text-left"
          >
            <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
            <span className="font-mono text-xs text-muted-foreground">
              {drill.includes('/') ? drill.slice(0, drill.lastIndexOf('/') + 1) : ''}
            </span>
            <span className="font-mono text-xs font-semibold">
              {drill.split('/').pop()}
            </span>
          </button>
        )}

        {searching && groupsHere.length === 0 && runsHere.length === 0 && !empty && (
          <div className="px-1 py-2 text-xs text-muted-foreground">No matching runs</div>
        )}

        {groupsHere.map(g => (
          <GroupCard
            key={g}
            path={g}
            byId={byId}
            filter={filter}
            searching={searching}
            onDrill={setDrill}
          />
        ))}
        {runsHere.map(s => (
          <MobileRunCard key={s.id} run={s} />
        ))}
      </div>
    </div>
  )
}

function GroupCard({
  path,
  byId,
  filter,
  searching,
  onDrill,
}: {
  path: string
  byId: Map<string, RunSummary>
  filter: TreeFilter | null
  searching: boolean
  onDrill: (path: string) => void
}) {
  const runTree = useStore(s => s.runTree)
  const userExpanded = useStore(s => s.expandedGroups.has(path))
  const toggle = useStore(s => s.toggleGroupExpanded)
  const selectGroup = useStore(s => s.selectGroup)
  const expanded = searching || userExpanded

  const leaf = path.split('/').pop() ?? path
  const docs = runTree.groups[path]?.docs ?? []
  const childGroups = childGroupsOf(runTree.groups, path).filter(
    g => !filter || filter.groups.has(g),
  )
  const memberRuns = membersOf(runTree.runs, path, byId).filter(
    s => !filter || filter.runs.has(s.id),
  )
  const metaParts = [`${memberRuns.length} run${memberRuns.length === 1 ? '' : 's'}`]
  if (childGroups.length > 0) metaParts.push(`${childGroups.length} group${childGroups.length === 1 ? '' : 's'}`)
  if (docs.length > 0) metaParts.push(`${docs.length} doc${docs.length === 1 ? '' : 's'}`)

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => toggle(path)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            toggle(path)
          }
        }}
        className="mb-2 flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3"
      >
        <Folder className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{leaf}</div>
          <div className="mt-px text-[11px] text-muted-foreground">{metaParts.join(' · ')}</div>
        </div>
        <button
          onClick={e => {
            e.stopPropagation()
            selectGroup(path)
          }}
          aria-label={`Open ${leaf} group page`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground"
        >
          <FileText className="h-3.5 w-3.5" />
        </button>
        {expanded
          ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      </div>
      {expanded && (
        <div className="ml-5">
          {childGroups.map(g => (
            <button
              key={g}
              onClick={() => onDrill(g)}
              className="mb-2 flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-2.5 text-left"
            >
              <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                {g.slice(path.length + 1)}
              </span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
          ))}
          {memberRuns.map(s => (
            <MobileRunCard key={s.id} run={s} />
          ))}
        </div>
      )}
    </div>
  )
}

export function MobileRunCard({ run }: { run: RunSummary }) {
  const customName = useStore(s => s.runNames.get(run.id))
  const runColor = useStore(s => s.runColors.get(run.id))
  const getOrAssignRunColor = useStore(s => s.getOrAssignRunColor)
  const runState = useStore(s => s.runs).get(run.id)
  const selectRun = useStore(s => s.selectRun)

  useEffect(() => {
    getOrAssignRunColor(run.id)
  }, [run.id, getOrAssignRunColor])

  const live = isRunLive(run)
  const color = runColor ?? 'transparent'
  const spark = firstLineSeriesValues(runState?.loggableMetrics)

  return (
    <button
      onClick={() => selectRun(run.id)}
      className="mb-2 flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 text-left"
    >
      <span
        className={cn('h-2.5 w-2.5 shrink-0 rounded-full', live && 'animate-pulse-running')}
        style={{ background: color }}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{runDisplayName(run, customName)}</div>
        <div className="mt-px truncate font-mono text-[11px] text-muted-foreground">
          {shortId(run.id)} · {live ? 'live' : timeAgo(run.last_event_at)}
        </div>
      </div>
      {spark && <Sparkline values={spark} color={runColor ?? '#60a5fa'} className="shrink-0" />}
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </button>
  )
}
