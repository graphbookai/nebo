import { useEffect, useMemo, useState } from 'react'
import { useStore } from '@/store'
import { api } from '@/lib/api'
import type { RunSummary } from '@/lib/api'
import { membersOf } from '@/lib/runTree'
import { NeboMarkdown } from '@/components/shared/NeboMarkdown'
import { MobileRunCard } from './MobileRunList'
import { ArrowLeft } from 'lucide-react'

// Full-page render of one group: its docs (README first) then member
// runs. Mobile counterpart of layout/GroupPage.
export function MobileGroupPage({ path }: { path: string }) {
  const runTree = useStore(s => s.runTree)
  const runs = useStore(s => s.runs)
  const selectGroup = useStore(s => s.selectGroup)

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

  const byId = useMemo(
    () => new Map(Array.from(runs.values(), r => [r.summary.id, r.summary] as [string, RunSummary])),
    [runs],
  )
  const members = membersOf(runTree.runs, path, byId)
  const exists = path in runTree.groups
  const leaf = path.split('/').pop() ?? path

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-border px-4 pb-2.5 pt-3">
        <button
          onClick={() => selectGroup(null)}
          aria-label="Back to runs"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">{leaf}</div>
          <div className="truncate text-[11px] text-muted-foreground">{path}</div>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-10 pt-3.5">
        {!exists && (
          <div className="text-sm text-muted-foreground">This group no longer exists.</div>
        )}

        {docNames.map(name =>
          docs[name] != null ? (
            <div key={name} className="rounded-xl border border-border bg-card px-4 py-3.5">
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
          <div className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Runs in this group
          </div>
          {members.length === 0 && (
            <div className="px-1 text-xs text-muted-foreground">No runs in this group.</div>
          )}
          {members.map(s => (
            <MobileRunCard key={s.id} run={s} />
          ))}
        </div>
      </div>
    </div>
  )
}
