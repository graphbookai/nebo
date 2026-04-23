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
import { entryTag, shapeForTag } from './scatterShape'

// All points share the run color. Shape is keyed by the entry's
// representative tag so the same tag uses the same shape across runs.
export const ScatterMetric = memo(function ScatterMetric({
  entries,
  color,
  allTags,
}: {
  entries: MetricEntry[]
  color: string
  allTags: string[]
}) {
  const valid = useMemo(
    () =>
      entries
        .map((e, idx) => ({ e, idx }))
        .filter(({ e }) => {
          const v = e.value as { x?: unknown; y?: unknown } | undefined
          return !!v && Array.isArray(v.x) && Array.isArray(v.y)
        }),
    [entries],
  )
  if (valid.length === 0) return null

  return (
    <ResponsiveContainer width="100%" height={200}>
      <ScatterChart>
        <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
        <XAxis dataKey="x" type="number" tick={chartAxisTick} tickLine={false} axisLine={false} />
        <YAxis dataKey="y" type="number" tick={chartAxisTick} tickLine={false} axisLine={false} width={40} />
        {/* ZAxis range in px^2; small points keep dense clouds readable. */}
        <ZAxis range={[18, 18]} />
        <Tooltip cursor={chartScatterCursor} wrapperStyle={chartHiddenWrapper} content={<PortalTooltip />} />
        {valid.map(({ e, idx }) => {
          const v = e.value as { x: number[]; y: number[] }
          const data = v.x.map((x, i) => ({ x, y: v.y[i] }))
          const tag = entryTag(e)
          const shape = shapeForTag(tag, allTags)
          const step = e.step ?? idx
          return (
            <Scatter
              key={`step-${step}-${idx}`}
              name={`step ${step}`}
              data={data}
              fill={color}
              stroke="var(--color-popover-foreground)"
              strokeWidth={0.5}
              strokeOpacity={0.5}
              shape={shape}
            />
          )
        })}
      </ScatterChart>
    </ResponsiveContainer>
  )
})
