import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import type { MetricEntry } from '@/lib/api'
import {
  chartAxisTick,
  chartGridStroke,
  chartTooltipContent,
  chartTooltipLabel,
  chartTooltipWrapper,
  chartTooltipAllowEscape,
} from './chartStyles'

export function ScatterMetric({ entries }: { entries: MetricEntry[] }) {
  if (entries.length === 0) return null
  const latest = entries[entries.length - 1].value as { x: number[]; y: number[] }
  if (!Array.isArray(latest?.x) || !Array.isArray(latest?.y)) return null
  const data = latest.x.map((x, i) => ({ x, y: latest.y[i] }))
  return (
    <ResponsiveContainer width="100%" height={160}>
      <ScatterChart>
        <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} />
        <XAxis dataKey="x" type="number" tick={chartAxisTick} tickLine={false} axisLine={false} />
        <YAxis dataKey="y" type="number" tick={chartAxisTick} tickLine={false} axisLine={false} width={40} />
        <Tooltip
          cursor={{ strokeDasharray: '3 3' }}
          contentStyle={chartTooltipContent}
          labelStyle={chartTooltipLabel}
          wrapperStyle={chartTooltipWrapper}
          allowEscapeViewBox={chartTooltipAllowEscape}
        />
        <Scatter data={data} fill="#f472b6" />
      </ScatterChart>
    </ResponsiveContainer>
  )
}
