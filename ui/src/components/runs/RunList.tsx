import { useState } from 'react'
import { useStore } from '@/store'
import { RunTree } from './RunTree'
import { ComparisonGroupCard } from './ComparisonGroupCard'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Search } from 'lucide-react'

export function RunList() {
  const runs = useStore(s => s.runs)
  const selectedRunId = useStore(s => s.selectedRunId)
  const selectRun = useStore(s => s.selectRun)
  const comparisonGroups = useStore(s => s.comparisonGroups)
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()

  // Comparison groups sorted by creation time (newest first)
  const sortedGroups = Array.from(comparisonGroups.values())
    .filter(g => !q || g.title.toLowerCase().includes(q))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  if (runs.size === 0 && comparisonGroups.size === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-6">
        <p className="text-sm">No runs yet</p>
        <p className="text-xs mt-1">Start a pipeline with <code className="text-xs bg-muted px-1 py-0.5 rounded">nebo run</code></p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Pinned above the scroll area so the search bar never scrolls away. */}
      <div className="p-2 pb-1">
        <div className="flex items-center gap-1 bg-muted rounded-md px-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <input
            type="text"
            placeholder="Search runs..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="bg-transparent border-none outline-none text-xs py-1.5 w-full"
          />
        </div>
      </div>

      <ScrollArea className="flex-1 [&>div>div]:!block">
        <div className="p-2 pt-1 space-y-1">
          {/* Comparison groups at top */}
          {sortedGroups.map(group => (
            <ComparisonGroupCard
              key={group.id}
              group={group}
              selected={group.id === selectedRunId}
              onClick={() => selectRun(group.id)}
            />
          ))}

          {/* Run-tree: groups (with member runs) then root runs */}
          <RunTree query={query} />
        </div>
      </ScrollArea>
    </div>
  )
}
