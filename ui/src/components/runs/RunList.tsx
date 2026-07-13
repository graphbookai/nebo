import { useStore } from '@/store'
import { RunTree } from './RunTree'
import { ComparisonGroupCard } from './ComparisonGroupCard'
import { ScrollArea } from '@/components/ui/scroll-area'

export function RunList() {
  const runs = useStore(s => s.runs)
  const selectedRunId = useStore(s => s.selectedRunId)
  const selectRun = useStore(s => s.selectRun)
  const comparisonGroups = useStore(s => s.comparisonGroups)

  // Comparison groups sorted by creation time (newest first)
  const sortedGroups = Array.from(comparisonGroups.values()).sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  )

  if (runs.size === 0 && sortedGroups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-6">
        <p className="text-sm">No runs yet</p>
        <p className="text-xs mt-1">Start a pipeline with <code className="text-xs bg-muted px-1 py-0.5 rounded">nebo run</code></p>
      </div>
    )
  }

  return (
    <ScrollArea className="h-full [&>div>div]:!block">
      <div className="p-2 space-y-1">
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
        <RunTree />
      </div>
    </ScrollArea>
  )
}
