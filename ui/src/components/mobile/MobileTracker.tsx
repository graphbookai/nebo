import { useMemo, useState } from 'react'
import { useStore } from '@/store'
import { useStreams } from '@/hooks/useStreams'
import type { StreamLeaf, StreamModality } from '@/lib/streams'
import { MobileSheet } from './MobileSheet'
import { elapsedLabel } from './util'
import { ChevronLeft, ChevronRight, ChevronUp, GitBranch, Rows3 } from 'lucide-react'
import { cn } from '@/lib/utils'

// Persistent bottom tracker: a heat-strip of event density with the
// DAG ⇄ Feed view toggle in the collapsed bar; tapping the strip expands
// a sheet with per-stream dot rows and a large scrubber.

const HEAT_BUCKETS = 48
const MODALITIES: { key: StreamModality; label: string; color: string }[] = [
  { key: 'text', label: 'text', color: '#60a5fa' },
  { key: 'image', label: 'image', color: '#34d399' },
  { key: 'audio', label: 'audio', color: '#fbbf24' },
]
const MODALITY_COLOR: Record<StreamModality, string> = {
  text: '#60a5fa', image: '#34d399', audio: '#fbbf24',
}

function DotRow({
  leaf,
  isStep,
  min,
  range,
  scrubPct,
}: {
  leaf: StreamLeaf
  isStep: boolean
  min: number
  range: number
  scrubPct: number
}) {
  // Dedupe datapoints to one dot per ~0.5% of track width — dense streams
  // would otherwise render thousands of coincident spans.
  const pcts = useMemo(() => {
    const seen = new Set<number>()
    const out: number[] = []
    for (const d of leaf.datapoints) {
      const v = isStep ? d.step : d.timestamp
      if (v == null) continue
      const pct = ((v - min) / range) * 100
      const bucket = Math.round(pct * 2)
      if (seen.has(bucket)) continue
      seen.add(bucket)
      out.push(pct)
    }
    return out
  }, [leaf.datapoints, isStep, min, range])

  return (
    <div className="relative h-[30px] border-b border-border/60">
      {pcts.map(pct => (
        <span
          key={pct}
          className="absolute top-3 h-1.5 w-1.5 -translate-x-1/2 rounded-full opacity-85"
          style={{ left: `${pct}%`, background: MODALITY_COLOR[leaf.modality] }}
        />
      ))}
      <span className="absolute left-0.5 top-0 max-w-[70%] truncate text-[11px] leading-[30px] text-foreground/85 [text-shadow:0_0_4px_var(--color-background),0_0_4px_var(--color-background)]">
        {leaf.path}
      </span>
      <span
        className="absolute bottom-0 top-0 w-0.5 -translate-x-1/2 bg-foreground"
        style={{ left: `${scrubPct}%` }}
      />
    </div>
  )
}

export function MobileTracker({ runId }: { runId: string }) {
  const timeline = useStore(s => s.timeline)
  const setStep = useStore(s => s.setTimelineStep)
  const setTime = useStore(s => s.setTimelineTime)
  const setMode = useStore(s => s.setTimelineMode)
  const viewMode = useStore(s => s.viewMode)
  const setViewMode = useStore(s => s.setViewMode)

  const [open, setOpen] = useState(false)
  const [activeModalities, setActiveModalities] = useState<Set<StreamModality>>(
    () => new Set(MODALITIES.map(m => m.key)),
  )

  const isStep = timeline.mode === 'step'
  const model = useStreams(runId, true)

  const leaves = useMemo(
    () => model.leaves.filter(l => activeModalities.has(l.modality)),
    [model.leaves, activeModalities],
  )

  const [min, max] = useMemo(() => {
    let lo = Infinity
    let hi = -Infinity
    for (const l of leaves) {
      if (isStep) {
        if (l.minStep != null) lo = Math.min(lo, l.minStep)
        if (l.maxStep != null) hi = Math.max(hi, l.maxStep)
      } else {
        lo = Math.min(lo, l.minTime)
        hi = Math.max(hi, l.maxTime)
      }
    }
    if (lo === Infinity) {
      lo = 0
      hi = 0
    }
    return [lo, hi]
  }, [leaves, isStep])
  const range = max - min

  // Event-density buckets for the heat strip.
  const heat = useMemo(() => {
    const counts = new Array<number>(HEAT_BUCKETS).fill(0)
    if (range <= 0) return counts
    for (const l of leaves) {
      for (const d of l.datapoints) {
        const v = isStep ? d.step : d.timestamp
        if (v == null) continue
        const idx = Math.min(HEAT_BUCKETS - 1, Math.max(0, Math.floor(((v - min) / range) * HEAT_BUCKETS)))
        counts[idx]++
      }
    }
    return counts
  }, [leaves, isStep, min, range])
  const maxCount = Math.max(1, ...heat)

  const playhead = isStep ? timeline.step : timeline.time
  const effective = playhead ?? max
  const scrubPct = range > 0 ? Math.max(0, Math.min(100, ((effective - min) / range) * 100)) : 100

  const posLabel = range <= 0
    ? '—'
    : isStep
      ? `step ${Math.round(effective)}`
      : `+${elapsedLabel(effective - min)}`

  const commit = (v: number) => {
    if (isStep) setStep(Math.round(v))
    else setTime(v)
  }
  const nudge = (dir: 1 | -1) => {
    if (range <= 0) return
    const delta = isStep ? 1 : range / 100
    commit(Math.max(min, Math.min(max, effective + dir * delta)))
  }

  const filtering = playhead != null

  return (
    <>
      <div className="shrink-0 border-t border-border bg-muted/30 px-4 pb-[max(env(safe-area-inset-bottom),10px)] pt-2.5">
        <div className="flex items-center gap-3">
          <div className="flex shrink-0 rounded-full bg-muted p-0.5">
            <button
              onClick={() => setViewMode('graph')}
              aria-label="DAG view"
              className={cn(
                'flex h-7 w-9 items-center justify-center rounded-full',
                viewMode === 'graph' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
              )}
            >
              <GitBranch className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setViewMode('flat')}
              aria-label="Feed view"
              className={cn(
                'flex h-7 w-9 items-center justify-center rounded-full',
                viewMode === 'flat' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
              )}
            >
              <Rows3 className="h-3.5 w-3.5" />
            </button>
          </div>
          <button
            onClick={() => setOpen(true)}
            className="flex min-w-0 flex-1 items-center gap-2.5 py-1.5"
            aria-label="Open timeline"
          >
            <div className="relative flex h-3.5 flex-1 items-end gap-px">
              {heat.map((c, i) => (
                <span
                  key={i}
                  className="flex-1 rounded-[1px] bg-primary"
                  style={{
                    height: `${c === 0 ? 8 : 20 + Math.sqrt(c / maxCount) * 80}%`,
                    opacity: c === 0 ? 0.12 : 0.3 + 0.7 * Math.sqrt(c / maxCount),
                  }}
                />
              ))}
              <span
                className="absolute -bottom-0.5 -top-0.5 w-0.5 -translate-x-1/2 rounded bg-foreground"
                style={{ left: `${scrubPct}%` }}
              />
            </div>
            <span className={cn('shrink-0 text-[11px] tabular-nums', filtering ? 'text-foreground' : 'text-muted-foreground')}>
              {posLabel}
            </span>
            <ChevronUp className="h-3 w-3 shrink-0 text-muted-foreground" />
          </button>
        </div>
      </div>

      <MobileSheet open={open} onClose={() => setOpen(false)}>
        <div className="px-4 pb-6">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-baseline gap-2.5">
              <span className="text-[15px] font-semibold">Timeline</span>
              {filtering && (
                <button
                  onClick={() => {
                    setStep(null)
                    setTime(null)
                  }}
                  className="text-[11px] text-muted-foreground underline underline-offset-2"
                >
                  clear
                </button>
              )}
            </div>
            <div className="flex rounded-lg bg-muted p-0.5">
              {(['step', 'time'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cn(
                    'rounded-md px-3 py-0.5 text-[11px] font-medium capitalize',
                    timeline.mode === m ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-3.5 flex gap-1.5">
            {MODALITIES.map(m => {
              const active = activeModalities.has(m.key)
              return (
                <button
                  key={m.key}
                  onClick={() =>
                    setActiveModalities(prev => {
                      const next = new Set(prev)
                      if (next.has(m.key)) next.delete(m.key)
                      else next.add(m.key)
                      return next
                    })
                  }
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium',
                    active
                      ? 'border-primary/40 bg-primary/10 text-foreground'
                      : 'border-border text-muted-foreground',
                  )}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: active ? m.color : 'var(--color-muted-foreground)' }} />
                  {m.label}
                </button>
              )
            })}
          </div>

          {range <= 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              {isStep ? 'No step data yet' : 'No time data yet'}
            </div>
          ) : (
            <>
              <div className="no-scrollbar mb-1.5 max-h-[32vh] overflow-y-auto">
                {leaves
                  .slice()
                  .sort((a, b) => a.path.localeCompare(b.path))
                  .map(leaf => (
                    <DotRow
                      key={leaf.path}
                      leaf={leaf}
                      isStep={isStep}
                      min={min}
                      range={range}
                      scrubPct={scrubPct}
                    />
                  ))}
              </div>

              <input
                type="range"
                min={min}
                max={max}
                step={isStep ? 1 : range / 500 || 1}
                value={effective}
                onInput={e => commit(Number((e.target as HTMLInputElement).value))}
                className="my-1 h-9 w-full accent-primary"
                aria-label="Scrub timeline"
              />
              <div className="flex items-center justify-center gap-3.5">
                <button
                  onClick={() => nudge(-1)}
                  aria-label={isStep ? 'Previous step' : 'Back'}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-muted"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="min-w-[110px] text-center text-base font-semibold tabular-nums">
                  {isStep
                    ? `${Math.round(effective)} / ${Math.round(max)}`
                    : `${elapsedLabel(effective - min)} / ${elapsedLabel(range)}`}
                </span>
                <button
                  onClick={() => nudge(1)}
                  aria-label={isStep ? 'Next step' : 'Forward'}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-muted"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </>
          )}
        </div>
      </MobileSheet>
    </>
  )
}
