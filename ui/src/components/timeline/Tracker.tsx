import { useCallback, useMemo, useRef, useState } from 'react'
import { useStore } from '@/store'
import { useStreams } from '@/hooks/useStreams'
import { useAxisTransform } from '@/hooks/useAxisTransform'
import { StreamTree } from './StreamTree'
import { TrackerControls } from './TrackerControls'
import { TimelineRuler, TimelineRows } from './TimelineGrid'
import { generateTicks } from './ticks'
import { Input } from '@/components/ui/input'
import { flattenRows, type StreamModality } from '@/lib/streams'

const HEIGHT_KEY = 'nebo_tracker_height'
const ROW_H = 22
const HEADER_H = 26
const TREE_W = 220
const PAD = 12  // horizontal inset (px) so edge ticks/datapoints aren't clipped
const MODALITIES: StreamModality[] = ['text', 'image', 'audio']

function loadHeight(): number {
  const v = Number(localStorage.getItem(HEIGHT_KEY))
  return Number.isFinite(v) && v >= 120 ? v : 220
}

export function Tracker({ runId }: { runId: string }) {
  const model = useStreams(runId)
  const timeline = useStore(s => s.timeline)
  const setSelectedStream = useStore(s => s.setSelectedStream)
  const setStep = useStore(s => s.setTimelineStep)
  const setTime = useStore(s => s.setTimelineTime)
  const isStep = timeline.mode === 'step'

  const [height, setHeight] = useState(loadHeight)
  const heightRef = useRef(height)
  const [collapsed, setCollapsed] = useState(false)
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(() => new Set())
  const [query, setQuery] = useState('')
  const [activeModalities, setActiveModalities] = useState<Set<StreamModality>>(() => new Set(MODALITIES))

  // X domain from modality-visible leaves (independent of search/collapse so
  // the zoom range doesn't jump while typing or collapsing).
  const domainLeaves = useMemo(
    () => model.leaves.filter(l => activeModalities.has(l.modality)),
    [model.leaves, activeModalities],
  )
  const [min, max] = useMemo(() => {
    let lo = Infinity, hi = -Infinity
    for (const l of domainLeaves) {
      if (isStep) {
        if (l.minStep != null) lo = Math.min(lo, l.minStep)
        if (l.maxStep != null) hi = Math.max(hi, l.maxStep)
      } else {
        lo = Math.min(lo, l.minTime); hi = Math.max(hi, l.maxTime)
      }
    }
    if (lo === Infinity) { lo = 0; hi = 0 }
    return [lo, hi]
  }, [domainLeaves, isStep])
  const minTime = useMemo(() => {
    let m = Infinity
    for (const l of domainLeaves) m = Math.min(m, l.minTime)
    return m === Infinity ? 0 : m
  }, [domainLeaves])

  const axis = useAxisTransform(min, max, PAD)

  // One flattened row list drives BOTH the tree column and the canvas, so
  // they render identical rows at identical heights in one shared scroll.
  const rows = useMemo(
    () => flattenRows(model.tree, collapsedNodes, query, activeModalities),
    [model.tree, collapsedNodes, query, activeModalities],
  )

  const range = max - min
  const ticks = useMemo(() => {
    if (range <= 0) return []
    const [a, b] = axis.visibleRange
    const vMin = min + (a / 100) * range
    const vMax = min + (b / 100) * range
    const raw = generateTicks(Math.max(min, vMin), Math.min(max, vMax))
    return isStep ? raw.map(Math.round) : raw
  }, [min, max, range, isStep, axis.visibleRange])

  const playhead = isStep ? timeline.step : timeline.time
  const playheadPct = playhead != null && range > 0 ? axis.toPercent(playhead) : null

  const onResetZoom = useCallback(() => axis.reset(), [axis])
  const onClearFilters = useCallback(() => {
    setStep(null)
    setTime(null)
    setSelectedStream(null)
    setQuery('')
    setActiveModalities(new Set(MODALITIES))
  }, [setStep, setTime, setSelectedStream])
  const toggleModality = useCallback((m: StreamModality) => setActiveModalities(prev => {
    const next = new Set(prev); if (next.has(m)) next.delete(m); else next.add(m); return next
  }), [])
  const onToggleNode = useCallback((path: string) => setCollapsedNodes(prev => {
    const next = new Set(prev); if (next.has(path)) next.delete(path); else next.add(path); return next
  }), [])

  // Selecting a stream highlights it and scrolls the main view to the owning
  // loggable card — it does NOT filter the content panels.
  const onSelect = useCallback((path: string) => {
    const next = timeline.selectedStream === path ? null : path
    setSelectedStream(next)
    const leaf = model.byPath.get(path)
    if (next && leaf) document.getElementById(`loggable-card-${leaf.loggableId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [timeline.selectedStream, setSelectedStream, model.byPath])

  // Drag-to-resize the panel height.
  const dragging = useRef(false)
  const onHandleDown = (e: React.PointerEvent) => { dragging.current = true; (e.target as HTMLElement).setPointerCapture(e.pointerId) }
  const onHandleMove = (e: React.PointerEvent) => {
    if (!dragging.current) return
    const h = Math.max(120, Math.min(window.innerHeight * 0.7, window.innerHeight - e.clientY))
    heightRef.current = h
    setHeight(h)
  }
  const onHandleUp = () => { if (dragging.current) { dragging.current = false; localStorage.setItem(HEIGHT_KEY, String(heightRef.current)) } }

  // Scrub the playhead (left-drag) / pan (middle-drag) on the canvas.
  const gridRef = useRef<HTMLDivElement | null>(null)
  const scrubbing = useRef(false)
  const setGrid = useCallback((el: HTMLDivElement | null) => { gridRef.current = el; axis.setContainer(el) }, [axis])
  const fromPixel = useCallback((clientX: number) => {
    const el = gridRef.current
    if (!el || range <= 0) return min
    const rect = el.getBoundingClientRect()
    const innerLeft = rect.left + PAD
    const innerWidth = Math.max(1, rect.width - 2 * PAD)
    const trackX = (clientX - innerLeft - axis.panX) / axis.scale
    const frac = Math.max(0, Math.min(1, trackX / innerWidth))
    const v = min + frac * range
    return isStep ? Math.round(v) : v
  }, [min, range, isStep, axis.panX, axis.scale])
  const scrub = useCallback((clientX: number) => {
    const v = fromPixel(clientX); if (isStep) setStep(v); else setTime(v)
  }, [fromPixel, isStep, setStep, setTime])
  const onCanvasDown = (e: React.PointerEvent<HTMLDivElement>) => {
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* capture is best-effort */ }
    if (e.button === 1) axis.beginPan(e.clientX)
    else { scrubbing.current = true; scrub(e.clientX) }
  }
  const onCanvasMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (scrubbing.current) scrub(e.clientX); else axis.onPanMove(e.clientX)
  }
  const onCanvasUp = () => { scrubbing.current = false; axis.endPan() }

  const minStep = isStep ? min : 0
  const maxStep = isStep ? max : 0
  const hasSteps = isStep && max > min

  return (
    <div className="shrink-0 border-t border-border bg-background flex flex-col" style={collapsed ? undefined : { height }}>
      {/* resize handle (only when expanded) */}
      {!collapsed && (
        <div
          className="h-1 w-full shrink-0 cursor-ns-resize hover:bg-primary/40"
          onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={onHandleUp}
        />
      )}
      {/* Controls row is always visible so the collapse toggle stays reachable. */}
      <TrackerControls
        minStep={minStep} maxStep={maxStep} hasSteps={hasSteps}
        activeModalities={activeModalities} onToggleModality={toggleModality}
        onResetZoom={onResetZoom} onClearFilters={onClearFilters}
        collapsed={collapsed} onToggleCollapse={() => setCollapsed(c => !c)}
      />
      {/* items-start so columns size to their CONTENT height (not stretched to
          the visible height); otherwise their content overflows the box — the
          tree border-r stops short and the sticky ruler unsticks once you
          scroll past one viewport. min-h-full keeps them filling the panel when
          there are few streams. */}
      {!collapsed && (
        <div className="flex flex-1 items-start overflow-x-hidden overflow-y-auto">
          {/* Tree column — sticky search header + rows. Capped at 15% of the
              tracker width so it never dominates on narrow viewports. */}
          <div className="min-h-full shrink-0 border-r border-border" style={{ width: TREE_W, maxWidth: '15%' }}>
            <div className="sticky top-0 z-10 border-b border-border bg-background p-1" style={{ height: HEADER_H }}>
              <Input placeholder="Search streams…" value={query} onChange={e => setQuery(e.target.value)} className="h-[18px] text-[11px]" />
            </div>
            <StreamTree
              rows={rows} rowHeight={ROW_H} collapsed={collapsedNodes}
              selectedPath={timeline.selectedStream} onSelect={onSelect} onToggle={onToggleNode}
            />
          </div>
          {/* Canvas column — sticky ruler + rows. Uses overflow-x:clip (NOT
              hidden) to clip the zoom transform: `hidden` on one axis forces
              the other to `auto`, which would make this column its own
              vertical scroller (breaking shared scroll + ruler stickiness).
              `clip` leaves overflow-y visible so the single outer container
              scrolls both columns together. */}
          <div
            ref={setGrid}
            className="relative min-h-full flex-1 cursor-crosshair select-none overflow-x-clip"
            onPointerDown={onCanvasDown} onPointerMove={onCanvasMove} onPointerUp={onCanvasUp} onPointerLeave={onCanvasUp}
          >
            {range <= 0 ? (
              <div className="sticky top-0 flex h-full items-center justify-center text-[11px] text-muted-foreground">
                {isStep ? 'No step data' : 'No time data'}
              </div>
            ) : (
              <>
                <TimelineRuler ticks={ticks} axis={axis} isStep={isStep} minTime={minTime} height={HEADER_H} pad={PAD} playheadPct={playheadPct} />
                <TimelineRows rows={rows} rowHeight={ROW_H} isStep={isStep} axis={axis} ticks={ticks} pad={PAD} playheadPct={playheadPct} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
