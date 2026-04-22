import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { MetricEntry } from '@/lib/api'
import { chartAxisTick, chartBarCursor, chartHiddenWrapper, METRIC_COLORS } from './chartStyles'
import { PortalTooltip } from './PortalTooltip'

export function BarMetric({ entry }: { entry: MetricEntry }) {
  const value = entry.value as Record<string, number> | undefined
  if (!value) return null
  const data = Object.entries(value).map(([label, v]) => ({
    label,
    value: typeof v === 'number' ? v : Number(v) || 0,
  }))
  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={data}>
        <XAxis dataKey="label" tick={chartAxisTick} tickLine={false} axisLine={false} />
        <YAxis tick={chartAxisTick} tickLine={false} axisLine={false} width={40} />
        <Tooltip cursor={chartBarCursor} wrapperStyle={chartHiddenWrapper} content={<PortalTooltip />} />
        <Bar dataKey="value" fill={METRIC_COLORS[0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
