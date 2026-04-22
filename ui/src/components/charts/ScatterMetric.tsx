import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import type { MetricEntry } from '@/lib/api'
import {
  chartAxisTick,
  chartGridStroke,
  chartHiddenWrapper,
  chartScatterCursor,
} from './chartStyles'
import { PortalTooltip } from './PortalTooltip'

export function ScatterMetric({ entry }: { entry: MetricEntry }) {
  const value = entry.value as { x: number[]; y: number[] } | undefined
  if (!value || !Array.isArray(value.x) || !Array.isArray(value.y)) return null
  const data = value.x.map((x, i) => ({ x, y: value.y[i] }))
  return (
    <ResponsiveContainer width="100%" height={160}>
      <ScatterChart>
        <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
        <XAxis dataKey="x" type="number" tick={chartAxisTick} tickLine={false} axisLine={false} />
        <YAxis dataKey="y" type="number" tick={chartAxisTick} tickLine={false} axisLine={false} width={40} />
        <Tooltip cursor={chartScatterCursor} wrapperStyle={chartHiddenWrapper} content={<PortalTooltip />} />
        <Scatter data={data} fill="#f472b6" />
      </ScatterChart>
    </ResponsiveContainer>
  )
}
