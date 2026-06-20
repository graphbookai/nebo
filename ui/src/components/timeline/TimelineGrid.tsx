import type { AxisTransform } from '@/hooks/useAxisTransform'
import type { FlatRow, StreamModality } from '@/lib/streams'

const DOT_COLOR: Record<StreamModality, string> = { text: '#3b82f6', image: '#22c55e', audio: '#f97316' }

// Sticky ruler band: tick labels + the playhead (with a downward triangle
// handle). Rendered inside a `left:pad right:pad` plot box so the first/last
// tick aren't clipped; the scaled layer shares the canvas X transform.
export function TimelineRuler({ ticks, axis, isStep, minTime, height, pad, playheadPct }: {
  ticks: number[]
  axis: AxisTransform
  isStep: boolean
  minTime: number
  height: number
  pad: number
  playheadPct: number | null
}) {
  const fmt = (t: number) => {
    if (isStep) return String(t)
    const off = t - minTime
    return off < 60 ? `${off.toFixed(1)}s` : `${(off / 60).toFixed(1)}m`
  }
  return (
    <div className="sticky top-0 z-10 overflow-hidden border-b border-border bg-background" style={{ height }}>
      <div className="absolute inset-y-0" style={{ left: pad, right: pad }}>
        <div className="absolute inset-0" style={axis.innerStyle}>
          {ticks.map((t, i) => (
            <div key={i} className="absolute top-0 -translate-x-1/2 pt-0.5 text-[9px] text-muted-foreground" style={{ left: `${axis.toPercent(t)}%` }}>
              {fmt(t)}
            </div>
          ))}
          {playheadPct != null && (
            <>
              <div className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-primary" style={{ left: `${playheadPct}%` }} />
              <div
                className="absolute top-0 h-0 w-0 -translate-x-1/2 border-l-[5px] border-r-[5px] border-t-[7px] border-l-transparent border-r-transparent border-t-primary"
                style={{ left: `${playheadPct}%` }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// The scrollable canvas: one datapoint row per FlatRow leaf (branch rows are
// blank spacers so rows stay aligned 1:1 with the tree column), tick guides,
// and the playhead — all inside the same `left:pad right:pad` plot box as the
// ruler. SVG layers are pointer-transparent so the parent handles
// scrub/pan/zoom.
export function TimelineRows({ rows, rowHeight, isStep, axis, ticks, pad, playheadPct }: {
  rows: FlatRow[]
  rowHeight: number
  isStep: boolean
  axis: AxisTransform
  ticks: number[]
  pad: number
  playheadPct: number | null
}) {
  const totalH = rows.length * rowHeight
  return (
    <div className="relative" style={{ height: totalH }}>
      <div className="absolute inset-y-0" style={{ left: pad, right: pad }}>
        <div className="absolute inset-0" style={axis.innerStyle}>
          <svg className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none">
            {ticks.map((t, i) => (
              <line key={i} x1={`${axis.toPercent(t)}%`} x2={`${axis.toPercent(t)}%`} y1="0" y2="100%" stroke="currentColor" className="text-foreground/10" strokeWidth={1} strokeDasharray="4 4" />
            ))}
          </svg>
          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" preserveAspectRatio="none">
            {rows.map((row, i) => row.leaf
              ? row.leaf.datapoints.map((dp, j) => {
                  const v = isStep ? dp.step : dp.timestamp
                  if (v == null) return null
                  return (
                    <circle key={j} cx={`${axis.toPercent(v)}%`} cy={i * rowHeight + rowHeight / 2} r={2.5} fill={DOT_COLOR[row.leaf!.modality]} opacity={0.85} />
                  )
                })
              : null)}
          </svg>
          {playheadPct != null && (
            <div className="pointer-events-none absolute top-0 w-0.5 -translate-x-1/2 bg-primary" style={{ left: `${playheadPct}%`, height: totalH }} />
          )}
        </div>
      </div>
    </div>
  )
}
