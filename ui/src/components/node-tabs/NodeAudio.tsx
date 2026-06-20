// Renders a single loggable's tab; works for node- and global-kind loggables.
import { useMemo } from 'react'
import { useStore, type AudioEntry } from '@/store'
import { useTimelineFilter, useStreamSelection } from '@/hooks/useTimelineFilter'
import { useMedia } from '@/hooks/useMedia'
import { formatTimestamp } from '@/lib/utils'
import { ComparisonGrid } from '@/components/shared/ComparisonGrid'
import { cn } from '@/lib/utils'

interface NodeAudioProps {
  runId: string
  loggableId: string
  comparisonRunIds?: string[]
  // When true, fill the parent's height and scroll internally instead
  // of letting the audio list stack at its natural intrinsic height.
  // Used inside fixed-height DAG nodes.
  fillParent?: boolean
}

export function NodeAudio({ runId, loggableId, comparisonRunIds, fillParent }: NodeAudioProps) {
  if (comparisonRunIds) {
    return (
      <ComparisonGrid runIds={comparisonRunIds} fillParent={fillParent}>
        {(cellRunId) => <ComparisonAudioCell runId={cellRunId} loggableId={loggableId} fillParent={fillParent} />}
      </ComparisonGrid>
    )
  }

  return <SingleRunAudio runId={runId} loggableId={loggableId} fillParent={fillParent} />
}

export function AudioItem({ runId, entry, showTimestamp }: { runId: string; entry: AudioEntry; showTimestamp?: boolean }) {
  const { data, loading } = useMedia(runId, entry.mediaId)

  return (
    <div data-export-atom="audio" className="space-y-1">
      <div className="flex items-center justify-between">
        <span className={`${showTimestamp ? 'text-xs' : 'text-[10px]'} font-medium`}>{entry.name}</span>
        <span className="text-[10px] text-muted-foreground">
          {entry.sr}Hz
          {showTimestamp && ` · ${formatTimestamp(entry.timestamp)}`}
        </span>
      </div>
      {loading ? (
        <div className="rounded border border-border bg-muted/50 animate-pulse h-8 w-full" />
      ) : data ? (
        <audio
          controls
          src={`data:audio/wav;base64,${data}`}
          className="w-full h-8"
        />
      ) : (
        <div className="rounded border border-border bg-muted/30 h-8 w-full flex items-center justify-center">
          <span className="text-[10px] text-muted-foreground">Failed to load</span>
        </div>
      )}
    </div>
  )
}

function ComparisonAudioCell({ runId, loggableId, fillParent }: { runId: string; loggableId: string; fillParent?: boolean }) {
  const allAudioEntries = useStore(s => s.runs.get(runId)?.loggableAudio[loggableId]) ?? []
  const timelineFilter = useTimelineFilter()
  const { isSelected } = useStreamSelection(runId)

  const audioEntries = useMemo(() => {
    let out = timelineFilter ? allAudioEntries.filter(entry => timelineFilter.matchEntry(entry)) : allAudioEntries
    out = out.filter(e => isSelected(e.node, 'audio', e.name))
    return out
  }, [allAudioEntries, timelineFilter, isSelected])

  if (audioEntries.length === 0) {
    return <p className="text-xs text-muted-foreground p-2">No audio</p>
  }

  return (
    <div className={cn('p-1', fillParent && 'h-full overflow-auto')}>
      <div className="space-y-2">
        {audioEntries.map((entry) => (
          <AudioItem key={entry.mediaId} runId={runId} entry={entry} />
        ))}
      </div>
    </div>
  )
}

function SingleRunAudio({ runId, loggableId, fillParent }: { runId: string; loggableId: string; fillParent?: boolean }) {
  const allAudioEntries = useStore(s => s.runs.get(runId)?.loggableAudio[loggableId]) ?? []
  const exportLimit = useStore(s => s.exportEntryLimit)
  const timelineFilter = useTimelineFilter()
  const { isSelected } = useStreamSelection(runId)

  const audioEntries = useMemo(() => {
    let out = timelineFilter ? allAudioEntries.filter(e => timelineFilter.matchEntry(e)) : allAudioEntries
    out = out.filter(e => isSelected(e.node, 'audio', e.name))
    if (exportLimit) out = out.slice(0, exportLimit)
    return out
  }, [allAudioEntries, timelineFilter, exportLimit, isSelected])

  if (audioEntries.length === 0) {
    return <p className="text-xs text-muted-foreground">No audio for this node</p>
  }

  // In fillParent mode the list scrolls inside its own flex-1 box so
  // the parent's overflow-auto doesn't double up on us.
  return (
    <div className={cn(fillParent ? 'h-full overflow-auto' : undefined)}>
      <div className="space-y-3">
        {audioEntries.map((entry) => (
          <AudioItem key={entry.mediaId} runId={runId} entry={entry} showTimestamp />
        ))}
      </div>
    </div>
  )
}
