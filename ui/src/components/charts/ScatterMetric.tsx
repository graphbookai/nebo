import { memo, useMemo } from 'react'
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import type { MetricEntry } from '@/lib/api'
import {
  chartAxisTick,
  chartGridStroke,
  chartHiddenWrapper,
  chartScatterCursor,
} from './chartStyles'
import { PortalTooltip } from './PortalTooltip'
import { shapeForLabel } from './scatterShape'
import { RUN_COLOR_PALETTE } from '@/lib/colors'

// Each entry's `value` is `{label: {x: [...], y: [...]}}`. Every label
// becomes its own Scatter series; shape is keyed by label so the same
// label uses the same shape across runs and across emissions. The
// enclosing chip row in NodeMetrics filters which labels reach us.
//
// `colors=false` (default, set per emission via `nb.log_scatter(...,
// colors=False)`) draws every series in the run color and lets shapes
// carry the label distinction. `colors=true` switches to the shared
// palette so labels can be distinguished by color too — useful for
// single-run scatters, ambiguous in comparison views (where the
// palette is reserved for run identity).
export const ScatterMetric = memo(function ScatterMetric({
  entries,
  color,
  allLabels,
  fill,
}: {
  entries: MetricEntry[]
  color: string
  allLabels: string[]
  // Fill the parent's height instead of the default 200 px (grid card mode).
  fill?: boolean
}) {
  // Snapshot semantics: scatter overwrites on re-emission, so only the
  // latest entry carries data. Earlier entries (if any survived from a
  // pre-overwrite era) are ignored.
  const latest = entries.length > 0 ? entries[entries.length - 1] : null
  const colorsByLabel = latest?.colors === true
  const slots = useMemo(() => {
    type Slot = { label: string; data: { x: number; y: number }[] }
    const out: Slot[] = []
    if (!latest) return out
    const v = latest.value as Record<string, { x?: unknown; y?: unknown }> | undefined
    if (!v || typeof v !== 'object') return out
    for (const [label, series] of Object.entries(v)) {
      if (!series || !Array.isArray(series.x) || !Array.isArray(series.y)) continue
      const xs = series.x as number[]
      const ys = series.y as number[]
      const data = xs.map((x, i) => ({ x, y: ys[i] }))
      out.push({ label, data })
    }
    return out
  }, [latest])
  if (slots.length === 0) return null

  const containerProps = fill
    ? { width: '100%' as const, height: '100%' as const }
    : { width: '100%' as const, height: 200 }
  return (
    <ResponsiveContainer {...containerProps}>
      <ScatterChart>
        <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
        <XAxis dataKey="x" type="number" tick={chartAxisTick} tickLine={false} axisLine={false} />
        <YAxis dataKey="y" type="number" tick={chartAxisTick} tickLine={false} axisLine={false} width={40} />
        {/* ZAxis range in px^2; small points keep dense clouds readable. */}
        <ZAxis range={[18, 18]} />
        <Tooltip cursor={chartScatterCursor} wrapperStyle={chartHiddenWrapper} content={<PortalTooltip />} />
        {slots.map((slot, i) => {
          const labelColor = colorsByLabel
            ? RUN_COLOR_PALETTE[allLabels.indexOf(slot.label) % RUN_COLOR_PALETTE.length]
            : color
          return (
            <Scatter
              key={`${slot.label}-${i}`}
              name={slot.label}
              data={slot.data}
              fill={labelColor}
              stroke="var(--color-popover-foreground)"
              strokeWidth={0.5}
              strokeOpacity={0.5}
              shape={shapeForLabel(slot.label, allLabels)}
            />
          )
        })}
      </ScatterChart>
    </ResponsiveContainer>
  )
})
