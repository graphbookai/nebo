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

// Each entry's `value` is `{label: {x: [...], y: [...]}}`. Every label
// becomes its own Scatter series; shape is keyed by label so the same
// label uses the same shape across runs and across emissions. The
// enclosing chip row in NodeMetrics filters which labels reach us.
export const ScatterMetric = memo(function ScatterMetric({
  entries,
  color,
  allLabels,
}: {
  entries: MetricEntry[]
  color: string
  allLabels: string[]
}) {
  const slots = useMemo(() => {
    type Slot = { label: string; step: number; data: { x: number; y: number }[] }
    const out: Slot[] = []
    entries.forEach((e, idx) => {
      const v = e.value as Record<string, { x?: unknown; y?: unknown }> | undefined
      if (!v || typeof v !== 'object') return
      const step = e.step ?? idx
      for (const [label, series] of Object.entries(v)) {
        if (!series || !Array.isArray(series.x) || !Array.isArray(series.y)) continue
        const xs = series.x as number[]
        const ys = series.y as number[]
        const data = xs.map((x, i) => ({ x, y: ys[i] }))
        out.push({ label, step, data })
      }
    })
    return out
  }, [entries])
  if (slots.length === 0) return null

  return (
    <ResponsiveContainer width="100%" height={200}>
      <ScatterChart>
        <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
        <XAxis dataKey="x" type="number" tick={chartAxisTick} tickLine={false} axisLine={false} />
        <YAxis dataKey="y" type="number" tick={chartAxisTick} tickLine={false} axisLine={false} width={40} />
        {/* ZAxis range in px^2; small points keep dense clouds readable. */}
        <ZAxis range={[18, 18]} />
        <Tooltip cursor={chartScatterCursor} wrapperStyle={chartHiddenWrapper} content={<PortalTooltip />} />
        {slots.map((slot, i) => (
          <Scatter
            key={`${slot.label}-${slot.step}-${i}`}
            name={`${slot.label} · step ${slot.step}`}
            data={slot.data}
            fill={color}
            stroke="var(--color-popover-foreground)"
            strokeWidth={0.5}
            strokeOpacity={0.5}
            shape={shapeForLabel(slot.label, allLabels)}
          />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  )
})
