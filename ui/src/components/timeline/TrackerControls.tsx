import { useCallback, useEffect } from 'react'
import { useStore } from '@/store'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ChevronLeft, ChevronRight, Maximize, ChevronDown, ChevronUp } from 'lucide-react'
import type { StreamModality } from '@/lib/streams'

const MODALITY_COLORS: Record<StreamModality, string> = {
  text: '#3b82f6', image: '#22c55e', audio: '#f97316',
}
const MODALITY_LABELS: Record<StreamModality, string> = {
  text: 'Text', image: 'Images', audio: 'Audio',
}
const MODALITIES: StreamModality[] = ['text', 'image', 'audio']

interface Props {
  minStep: number
  maxStep: number
  hasSteps: boolean
  activeModalities: Set<StreamModality>
  onToggleModality: (m: StreamModality) => void
  onResetZoom: () => void
  onClearFilters: () => void
  collapsed: boolean
  onToggleCollapse: () => void
}

export function TrackerControls({ minStep, maxStep, hasSteps, activeModalities, onToggleModality, onResetZoom, onClearFilters, collapsed, onToggleCollapse }: Props) {
  const timeline = useStore(s => s.timeline)
  const setMode = useStore(s => s.setTimelineMode)
  const setStep = useStore(s => s.setTimelineStep)
  const isStep = timeline.mode === 'step'

  const stepBy = useCallback((d: number) => {
    if (!hasSteps) return
    const cur = timeline.step ?? minStep
    setStep(Math.max(minStep, Math.min(maxStep, cur + d)))
  }, [hasSteps, timeline.step, minStep, maxStep, setStep])

  // Ctrl/⌘ + Left/Right steps the playhead (skips when typing in a field).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (!hasSteps) return
      e.preventDefault()
      stepBy(e.key === 'ArrowRight' ? 1 : -1)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [hasSteps, stepBy])

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 border-b border-border bg-background flex-wrap shrink-0">
      {/* Modality chips — left, near the stream filter. */}
      <div className="flex items-center gap-1">
        {MODALITIES.map(m => {
          const active = activeModalities.has(m)
          return (
            <Badge
              key={m}
              variant={active ? 'default' : 'outline'}
              className="cursor-pointer select-none gap-1 px-2 py-0.5 text-[10px]"
              style={active ? { backgroundColor: MODALITY_COLORS[m], borderColor: MODALITY_COLORS[m] } : undefined}
              onClick={() => onToggleModality(m)}
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: active ? '#fff' : MODALITY_COLORS[m] }} />
              {MODALITY_LABELS[m]}
            </Badge>
          )
        })}
      </div>

      <Select value={timeline.mode} onValueChange={(v) => setMode(v as 'time' | 'step')}>
        <SelectTrigger className="h-7 w-[88px] text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="step">Step</SelectItem>
          <SelectItem value="time">Time</SelectItem>
        </SelectContent>
      </Select>

      <div className="flex items-center gap-0.5">
        <Button variant="ghost" className="h-7 w-7 p-0" disabled={!hasSteps} title="Previous step" onClick={() => stepBy(-1)}>
          <ChevronLeft size={15} />
        </Button>
        <Button variant="ghost" className="h-7 w-7 p-0" disabled={!hasSteps} title="Next step" onClick={() => stepBy(1)}>
          <ChevronRight size={15} />
        </Button>
      </div>

      {isStep && (
        <Input
          type="number"
          className="h-7 w-20"
          value={timeline.step ?? ''}
          min={minStep}
          max={maxStep}
          placeholder="step"
          onChange={(e) => {
            const v = e.target.value
            setStep(v === '' ? null : Math.max(minStep, Math.min(maxStep, Number(v))))
          }}
        />
      )}

      <Button variant="ghost" className="h-7 w-7 p-0" title="Reset zoom" onClick={onResetZoom}>
        <Maximize size={14} />
      </Button>

      <Button variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" title="Clear all filters" onClick={onClearFilters}>
        Clear all filters
      </Button>

      <Button variant="ghost" className="ml-auto h-7 w-7 p-0" onClick={onToggleCollapse} title={collapsed ? 'Expand tracker' : 'Collapse tracker'}>
        {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </Button>
    </div>
  )
}
