import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import type { MetricEntry } from '@/lib/api'
import {
  chartAxisTick,
  chartGridStroke,
  chartHiddenWrapper,
  chartScatterCursor,
} from './chartStyles'
import { PortalTooltip } from './PortalTooltip'

// recharts' 7 built-in scatter shapes; recycled modulo length when more
// steps are present. All points share the run color — shape distinguishes
// step within a run.
const SCATTER_SHAPES = [
  'circle',
  'cross',
  'diamond',
  'square',
  'star',
  'triangle',
  'wye',
] as const
type ScatterShape = (typeof SCATTER_SHAPES)[number]

export function ScatterMetric({ entries, color }: { entries: MetricEntry[]; color: string }) {
  const valid = entries
    .map((e, idx) => ({ e, idx }))
    .filter(({ e }) => {
      const v = e.value as { x?: unknown; y?: unknown } | undefined
      return !!v && Array.isArray(v.x) && Array.isArray(v.y)
    })
  if (valid.length === 0) return null

  return (
    <ResponsiveContainer width="100%" height={200}>
      <ScatterChart>
        <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
        <XAxis dataKey="x" type="number" tick={chartAxisTick} tickLine={false} axisLine={false} />
        <YAxis dataKey="y" type="number" tick={chartAxisTick} tickLine={false} axisLine={false} width={40} />
        <Tooltip cursor={chartScatterCursor} wrapperStyle={chartHiddenWrapper} content={<PortalTooltip />} />
        {valid.map(({ e, idx }, j) => {
          const v = e.value as { x: number[]; y: number[] }
          const data = v.x.map((x, i) => ({ x, y: v.y[i] }))
          const shape: ScatterShape = SCATTER_SHAPES[j % SCATTER_SHAPES.length]
          const step = e.step ?? idx
          return (
            <Scatter
              key={`step-${step}-${idx}`}
              name={`step ${step}`}
              data={data}
              fill={color}
              shape={shape}
            />
          )
        })}
      </ScatterChart>
    </ResponsiveContainer>
  )
}
