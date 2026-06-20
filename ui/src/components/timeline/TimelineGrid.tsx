import { useCallback, useMemo, useRef } from 'react'
import { useStore } from '@/store'
import type { AxisTransform } from '@/hooks/useAxisTransform'
import type { StreamLeaf, StreamModality } from '@/lib/streams'

const DOT_COLOR: Record<StreamModality, string> = { text: '#3b82f6', image: '#22c55e', audio: '#f97316' }

function generateTicks(min: number, max: number, target = 8): number[] {
  const range = max - min
  if (range <= 0) return []
  const raw = range / target
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const step = norm <= 1.5 ? mag : norm <= 3.5 ? 2 * mag : norm <= 7.5 ? 5 * mag : 10 * mag
  const ticks: number[] = []
  let t = Math.ceil(min / step) * step
  while (t <= max + step * 0.001) { ticks.push(t); t += step }
  return ticks
}

interface Props {
  leaves: StreamLeaf[]
  rowHeight: number
  headerHeight: number
  min: number
  max: number
  isStep: boolean
  minTime: number
  axis: AxisTransform
}

export function TimelineGrid({ leaves, rowHeight, headerHeight, min, max, isStep, minTime, axis }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const timeline = useStore(s => s.timeline)
  const setStep = useStore(s => s.setTimelineStep)
  const setTime = useStore(s => s.setTimelineTime)

  const playhead = isStep ? timeline.step : timeline.time
  const range = max - min

  // pixel → domain value (account for zoom/pan)
  const fromPixel = useCallback((clientX: number) => {
    const el = containerRef.current
    if (!el || range <= 0) return min
    const rect = el.getBoundingClientRect()
    const trackX = (clientX - rect.left - axis.panX) / axis.scale
    const frac = Math.max(0, Math.min(1, trackX / rect.width))
    const v = min + frac * range
    return isStep ? Math.round(v) : v
  }, [min, range, isStep, axis.panX, axis.scale])

  const setPlayhead = useCallback((clientX: number) => {
    const v = fromPixel(clientX)
    if (isStep) setStep(v); else setTime(v)
  }, [fromPixel, isStep, setStep, setTime])

  const ticks = useMemo(() => {
    const [vMinPct, vMaxPct] = axis.visibleRange
    const vMin = min + (vMinPct / 100) * range
    const vMax = min + (vMaxPct / 100) * range
    const raw = generateTicks(Math.max(min, vMin), Math.min(max, vMax))
    return isStep ? raw.map(Math.round) : raw
  }, [min, max, range, isStep, axis.visibleRange])

  const fmt = (t: number) => {
    if (isStep) return String(t)
    const off = t - minTime
    return off < 60 ? `${off.toFixed(1)}s` : `${(off / 60).toFixed(1)}m`
  }

  if (range <= 0) {
    return <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">{isStep ? 'No step data' : 'No time data'}</div>
  }

  const playheadPct = playhead != null ? axis.toPercent(playhead) : null

  return (
    <div
      ref={(el) => { containerRef.current = el; axis.setContainer(el) }}
      className="relative h-full w-full overflow-hidden bg-background"
      onWheel={axis.onWheel}
      onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); if (e.button === 1) axis.beginPan(e.clientX); else setPlayhead(e.clientX) }}
      onPointerMove={(e) => axis.onPanMove(e.clientX)}
      onPointerUp={axis.endPan}
    >
      {/* scaled/panned inner layer */}
      <div className="absolute top-0 left-0 h-full" style={axis.innerStyle}>
        {/* header ruler */}
        <div className="relative w-full" style={{ height: headerHeight }}>
          {ticks.map((t, i) => (
            <div key={i} className="absolute top-0 -translate-x-1/2 text-[9px] text-muted-foreground" style={{ left: `${axis.toPercent(t)}%` }}>
              {fmt(t)}
            </div>
          ))}
        </div>
        {/* vertical tick guides */}
        <svg className="pointer-events-none absolute left-0 w-full" style={{ top: headerHeight, height: leaves.length * rowHeight }} preserveAspectRatio="none">
          {ticks.map((t, i) => (
            <line key={i} x1={`${axis.toPercent(t)}%`} x2={`${axis.toPercent(t)}%`} y1="0" y2="100%" stroke="currentColor" className="text-foreground/10" strokeWidth={1} strokeDasharray="4 4" />
          ))}
        </svg>
        {/* per-stream rows */}
        {leaves.map((leaf, r) => (
          <svg key={leaf.path} className="absolute left-0 w-full overflow-visible" style={{ top: headerHeight + r * rowHeight, height: rowHeight }} preserveAspectRatio="none">
            {leaf.datapoints.map((dp, i) => {
              const v = isStep ? dp.step : dp.timestamp
              if (v == null) return null
              return (
                <circle key={i} cx={`${axis.toPercent(v)}%`} cy="50%" r={2.5} fill={DOT_COLOR[leaf.modality]} opacity={0.85} />
              )
            })}
          </svg>
        ))}
        {/* playhead line */}
        {playheadPct != null && (
          <div className="absolute top-0 w-0.5 -translate-x-1/2 bg-primary" style={{ left: `${playheadPct}%`, height: headerHeight + leaves.length * rowHeight }} />
        )}
      </div>
    </div>
  )
}
