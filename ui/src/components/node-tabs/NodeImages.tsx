// Renders a single loggable's tab; works for node- and global-kind loggables.
import { useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
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

// Only the items inside the viewport (plus overscan) are mounted, so a tab with
// thousands of images stays cheap to switch into and to scroll through. Without
// virtualization, mounting every ImageItem creates one useMedia subscription per
// image (which re-fires on every mediaCache update) plus a real <img>+SVG tree.
export function VirtualizedImageList({
  runId,
  loggableId,
  images,
  showTimestamp,
  maxHeight,
  itemGap = 12,
  estimateSize = 240,
}: {
  runId: string
  loggableId: string
  images: ImageEntry[]
  showTimestamp?: boolean
  maxHeight: number
  itemGap?: number
  estimateSize?: number
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: images.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateSize + itemGap,
    overscan: 3,
    getItemKey: (index) => images[index].mediaId,
  })

  return (
    <div ref={scrollRef} className="overflow-auto" style={{ maxHeight }}>
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map(vi => {
          const img = images[vi.index]
          return (
            <div
              key={vi.key}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vi.start}px)`,
                paddingBottom: itemGap,
              }}
            >
              <ImageItem runId={runId} loggableId={loggableId} img={img} showTimestamp={showTimestamp} />
            </div>
          )
        })}
      </div>
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
    <VirtualizedImageList
      runId={runId}
      loggableId={loggableId}
      images={images}
      maxHeight={280}
    />
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
    <VirtualizedImageList
      runId={runId}
      loggableId={loggableId}
      images={images}
      showTimestamp
      maxHeight={380}
    />
  )
}
