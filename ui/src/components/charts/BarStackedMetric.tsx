import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import type { MetricEntry } from '@/lib/api'
import {
  chartAxisTick,
  chartBarCursor,
  chartHiddenWrapper,
  METRIC_COLORS,
} from './chartStyles'
import { PortalTooltip } from './PortalTooltip'

// Stacked bars: x-axis is step, each step's dict gets stacked vertically so
// every category shares a column and the running total reads from the y-axis.
export function BarStackedMetric({ entries }: { entries: MetricEntry[] }) {
  if (entries.length === 0) return null

  const allKeys = new Set<string>()
  for (const e of entries) {
    const v = e.value
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const k of Object.keys(v)) allKeys.add(k)
    }
  }
  const keys = [...allKeys]

  const data = entries.map((e, i) => {
    const step = e.step ?? i
    const value = (e.value ?? {}) as Record<string, unknown>
    const row: Record<string, number | string> = { step }
    for (const k of keys) {
      const v = value[k]
      row[k] = typeof v === 'number' ? v : Number(v) || 0
    }
    return row
  })

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data}>
        <XAxis dataKey="step" tick={chartAxisTick} tickLine={false} axisLine={false} />
        <YAxis tick={chartAxisTick} tickLine={false} axisLine={false} width={40} />
        <Tooltip cursor={chartBarCursor} wrapperStyle={chartHiddenWrapper} content={<PortalTooltip />} />
        <Legend
          verticalAlign="bottom"
          wrapperStyle={{ fontSize: 10 }}
          formatter={(v) => (
            <span style={{ color: 'var(--color-popover-foreground)' }}>{v}</span>
          )}
        />
        {keys.map((k, i) => (
          <Bar key={k} dataKey={k} stackId="stack" fill={METRIC_COLORS[i % METRIC_COLORS.length]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
