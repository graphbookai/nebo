import { useCallback, useMemo, useRef, useState } from 'react'
import { useStore } from '@/store'
import { useStreams } from '@/hooks/useStreams'
import { useAxisTransform } from '@/hooks/useAxisTransform'
import { StreamTree } from './StreamTree'
import { TrackerControls } from './TrackerControls'
import { TimelineGrid } from './TimelineGrid'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { StreamModality, StreamLeaf } from '@/lib/streams'

const HEIGHT_KEY = 'nebo_tracker_height'
const ROW_H = 22
const HEADER_H = 18
const TREE_W = 220
const MODALITIES: StreamModality[] = ['text', 'image', 'audio']

function loadHeight(): number {
  const v = Number(localStorage.getItem(HEIGHT_KEY))
  return Number.isFinite(v) && v >= 120 ? v : 200
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
  const [activeModalities, setActiveModalities] = useState<Set<StreamModality>>(() => new Set(MODALITIES))

  // Filter leaves by active modality; keep tree order (depth-first by path).
  const visibleLeaves: StreamLeaf[] = useMemo(
    () => model.leaves
      .filter(l => activeModalities.has(l.modality))
      .sort((a, b) => a.path.localeCompare(b.path)),
    [model.leaves, activeModalities],
  )
  const visibleTree = model.tree // StreamTree filters by its own search; modality filter applies to grid rows

  // Shared X domain across all rows.
  const [min, max] = useMemo(() => {
    let lo = Infinity, hi = -Infinity
    for (const l of visibleLeaves) {
      if (isStep) {
        if (l.minStep != null) lo = Math.min(lo, l.minStep)
        if (l.maxStep != null) hi = Math.max(hi, l.maxStep)
      } else {
        lo = Math.min(lo, l.minTime); hi = Math.max(hi, l.maxTime)
      }
    }
    if (lo === Infinity) { lo = 0; hi = 0 }
    return [lo, hi]
  }, [visibleLeaves, isStep])
  const minTime = useMemo(() => {
    let m = Infinity
    for (const l of visibleLeaves) m = Math.min(m, l.minTime)
    return m === Infinity ? 0 : m
  }, [visibleLeaves])

  const axis = useAxisTransform(min, max)

  const onReset = useCallback(() => { axis.reset(); if (isStep) setStep(null); else setTime(null) }, [axis, isStep, setStep, setTime])
  const toggleModality = useCallback((m: StreamModality) => setActiveModalities(prev => {
    const next = new Set(prev); next.has(m) ? next.delete(m) : next.add(m); return next
  }), [])

  // Stream selection → focus the owning loggable card in the main view.
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

  const minStep = isStep ? min : 0
  const maxStep = isStep ? max : 0
  const hasSteps = isStep && max > min

  return (
    <div className="shrink-0 border-t border-border bg-background" style={{ height: collapsed ? 32 : height }}>
      {/* resize handle (hidden when collapsed) */}
      {!collapsed && (
        <div
          className="h-1 w-full cursor-ns-resize hover:bg-primary/40"
          onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={onHandleUp}
        />
      )}
      <div className="flex items-center justify-between px-2 h-7 border-b border-border">
        <span className="text-[11px] font-medium text-muted-foreground">Streams</span>
        <Button variant="ghost" className="h-6 w-6 p-0" onClick={() => setCollapsed(c => !c)} title={collapsed ? 'Expand tracker' : 'Collapse tracker'}>
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </Button>
      </div>
      {!collapsed && (
        <div className="flex flex-col" style={{ height: height - 32 - 4 }}>
          <TrackerControls
            minStep={minStep} maxStep={maxStep} hasSteps={hasSteps}
            activeModalities={activeModalities} onToggleModality={toggleModality} onReset={onReset}
          />
          <div className="flex flex-1 overflow-hidden">
            <div className="shrink-0 border-r border-border" style={{ width: TREE_W }}>
              <StreamTree nodes={visibleTree} rowHeight={ROW_H} onSelect={onSelect} />
            </div>
            <div className="flex-1 overflow-auto">
              <TimelineGrid
                leaves={visibleLeaves} rowHeight={ROW_H} headerHeight={HEADER_H}
                min={min} max={max} isStep={isStep} minTime={minTime} axis={axis}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
