import { useEffect, useState } from 'react'
import { useStore } from '@/store'
import { api } from '@/lib/api'
import type { RunSummary } from '@/lib/api'
import { RunCard } from '@/components/runs/RunCard'
import { NeboMarkdown } from '@/components/shared/NeboMarkdown'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ArrowLeft } from 'lucide-react'

/** Read-only page for one group: its docs (README.md first) then member runs.
 *  Shown when `selectedGroup` is set (see App.tsx). */
export function GroupPage({ path }: { path: string }) {
  const runTree = useStore(s => s.runTree)
  const runs = useStore(s => s.runs)
  const selectedRunId = useStore(s => s.selectedRunId)
  const selectRun = useStore(s => s.selectRun)
  const selectGroup = useStore(s => s.selectGroup)

  // docs are README-first as served by the daemon.
  const docNames = runTree.groups[path]?.docs ?? []
  const [docs, setDocs] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    Promise.all(
      docNames.map(name =>
        api
          .getGroupDoc(path, name)
          .then(content => [name, content] as const)
          .catch(() => [name, null] as const),
      ),
    ).then(pairs => {
      if (cancelled) return
      const out: Record<string, string> = {}
      for (const [name, content] of pairs) if (content != null) out[name] = content
      setDocs(out)
    })
    return () => {
      cancelled = true
    }
    // Re-fetch when the group or its doc set changes.
  }, [path, docNames.join('|')])

  const byId = new Map(
    Array.from(runs.values(), r => [r.summary.id, r.summary] as [string, RunSummary]),
  )
  const members = Object.entries(runTree.runs)
    .filter(([, g]) => g === path)
    .map(([id]) => byId.get(id))
    .filter((s): s is RunSummary => Boolean(s))
    .sort((a, b) => {
      const at = a.started_at ? new Date(a.started_at).getTime() : 0
      const bt = b.started_at ? new Date(b.started_at).getTime() : 0
      return bt - at
    })

  const exists = path in runTree.groups

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <button
          onClick={() => selectGroup(null)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> back
        </button>
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">group</div>
          <h1 className="text-lg font-semibold break-all">{path}</h1>
        </div>

        {!exists && (
          <div className="text-sm text-muted-foreground">This group no longer exists.</div>
        )}

        {docNames.map(name =>
          docs[name] != null ? (
            <div key={name} className="rounded-lg border border-border p-4">
              {name.toLowerCase() !== 'readme.md' && (
                <div className="mb-2 font-mono text-xs text-muted-foreground">{name}</div>
              )}
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <NeboMarkdown>{docs[name]}</NeboMarkdown>
              </div>
            </div>
          ) : null,
        )}

        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            Runs ({members.length})
          </div>
          <div className="space-y-1">
            {members.length === 0 && (
              <div className="text-xs text-muted-foreground">No runs in this group.</div>
            )}
            {members.map(s => (
              <RunCard
                key={s.id}
                run={s}
                selected={s.id === selectedRunId}
                onClick={() => selectRun(s.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </ScrollArea>
  )
}
