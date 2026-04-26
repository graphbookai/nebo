// Renders a single loggable's tab; works for node- and global-kind loggables.
import { useMemo } from 'react'
import { useStore, type ImageEntry } from '@/store'
import { useTimelineFilter } from '@/hooks/useTimelineFilter'
import { useMedia } from '@/hooks/useMedia'
import { formatTimestamp } from '@/lib/utils'
import { ComparisonGrid } from '@/components/shared/ComparisonGrid'
import { ImageWithLabels } from '@/components/shared/ImageWithLabels'

interface NodeImagesProps {
  runId: string
  loggableId: string
  comparisonRunIds?: string[]
}

export function NodeImages({ runId, loggableId, comparisonRunIds }: NodeImagesProps) {
  if (comparisonRunIds) {
    return (
      <ComparisonGrid runIds={comparisonRunIds}>
        {(cellRunId) => <ComparisonImageCell runId={cellRunId} loggableId={loggableId} />}
      </ComparisonGrid>
    )
  }

  return <SingleRunImages runId={runId} loggableId={loggableId} />
}

export function ImageItem({ runId, loggableId, img, showTimestamp }: { runId: string; loggableId: string; img: ImageEntry; showTimestamp?: boolean }) {
  const { data, loading } = useMedia(runId, img.mediaId)

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className={`${showTimestamp ? 'text-xs' : 'text-[10px]'} font-medium`}>{img.name}</span>
        <span className="text-[10px] text-muted-foreground">
          {img.step != null && `step ${img.step}`}
          {showTimestamp && img.step != null && ' · '}
          {showTimestamp && formatTimestamp(img.timestamp)}
        </span>
      </div>
      {loading ? (
        <div className="rounded border border-border bg-muted/50 animate-pulse h-32 w-full" />
      ) : data ? (
        <ImageWithLabels
          src={`data:image/png;base64,${data}`}
          labels={img.labels}
          loggableName={loggableId}
          imageName={img.name ?? ''}
          alt={img.name}
        />
      ) : (
        <div className="rounded border border-border bg-muted/30 h-32 w-full flex items-center justify-center">
          <span className="text-xs text-muted-foreground">Failed to load</span>
        </div>
      )}
    </div>
  )
}

function ComparisonImageCell({ runId, loggableId }: { runId: string; loggableId: string }) {
  const allImages = useStore(s => s.runs.get(runId)?.loggableImages[loggableId]) ?? []
  const timelineFilter = useTimelineFilter()

  const images = useMemo(() => {
    if (!timelineFilter) return allImages
    return allImages.filter(img => timelineFilter.matchEntry(img))
  }, [allImages, timelineFilter])

  if (images.length === 0) {
    return <p className="text-xs text-muted-foreground p-2">No images</p>
  }

  return (
    <div className="space-y-2 p-1">
      {images.map((img) => (
        <ImageItem key={img.mediaId} runId={runId} loggableId={loggableId} img={img} />
      ))}
    </div>
  )
}

function SingleRunImages({ runId, loggableId }: { runId: string; loggableId: string }) {
  const allImages = useStore(s => s.runs.get(runId)?.loggableImages[loggableId]) ?? []
  const timelineFilter = useTimelineFilter()

  const images = useMemo(() => {
    if (!timelineFilter) return allImages
    return allImages.filter(img => timelineFilter.matchEntry(img))
  }, [allImages, timelineFilter])

  if (images.length === 0) {
    return <p className="text-xs text-muted-foreground">No images for this node</p>
  }

  return (
    <div className="space-y-3">
      {images.map((img) => (
        <ImageItem key={img.mediaId} runId={runId} loggableId={loggableId} img={img} showTimestamp />
      ))}
    </div>
  )
}
