import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { MetricEntry } from '@/lib/api'
import {
  chartAxisTick,
  chartTooltipContent,
  chartTooltipLabel,
  chartTooltipWrapper,
  chartTooltipAllowEscape,
} from './chartStyles'

export function BarMetric({ entries }: { entries: MetricEntry[] }) {
  if (entries.length === 0) return null
  const latest = entries[entries.length - 1].value as Record<string, number>
  const data = Object.entries(latest).map(([label, value]) => ({
    label,
    value: typeof value === 'number' ? value : Number(value) || 0,
  }))
  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={data}>
        <XAxis dataKey="label" tick={chartAxisTick} tickLine={false} axisLine={false} />
        <YAxis tick={chartAxisTick} tickLine={false} axisLine={false} width={40} />
        <Tooltip
          contentStyle={chartTooltipContent}
          labelStyle={chartTooltipLabel}
          wrapperStyle={chartTooltipWrapper}
          allowEscapeViewBox={chartTooltipAllowEscape}
        />
        <Bar dataKey="value" fill="#22d3ee" />
      </BarChart>
    </ResponsiveContainer>
  )
}
