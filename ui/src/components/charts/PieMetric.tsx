import { memo, useMemo } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import type { MetricEntry } from '@/lib/api'
import { chartHiddenWrapper } from './chartStyles'
import { RUN_COLOR_PALETTE } from '@/lib/colors'
import { PortalTooltip } from './PortalTooltip'

// Pie inherently displays one slice per dict key, so we use the shared palette
// for readable slice distinction — color here represents categories within a
// snapshot, not runs. Comparing multiple pies across runs renders multiple
// independent pies (handled by the enclosing dispatcher).
export const PieMetric = memo(function PieMetric({ entry }: { entry: MetricEntry }) {
  const data = useMemo(() => {
    const value = entry.value as Record<string, number> | undefined
    if (!value) return null
    return Object.entries(value).map(([name, v]) => ({
      name,
      value: typeof v === 'number' ? v : Number(v) || 0,
    }))
  }, [entry.value])
  if (!data) return null
  return (
    <ResponsiveContainer width="100%" height={180}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} label={false}>
          {data.map((_, i) => (
            <Cell key={i} fill={RUN_COLOR_PALETTE[i % RUN_COLOR_PALETTE.length]} />
          ))}
        </Pie>
        <Tooltip wrapperStyle={chartHiddenWrapper} content={<PortalTooltip />} />
        <Legend
          verticalAlign="bottom"
          wrapperStyle={{ fontSize: 10, color: 'var(--color-muted-foreground)' }}
          formatter={(value) => (
            <span style={{ color: 'var(--color-popover-foreground)' }}>{value}</span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  )
})
