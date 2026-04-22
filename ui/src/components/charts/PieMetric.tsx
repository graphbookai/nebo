import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import type { MetricEntry } from '@/lib/api'
import { chartHiddenWrapper } from './chartStyles'
import { PortalTooltip } from './PortalTooltip'

const COLORS = ['#60a5fa', '#f472b6', '#34d399', '#facc15', '#a78bfa', '#22d3ee', '#f87171']

export function PieMetric({ entry }: { entry: MetricEntry }) {
  const value = entry.value as Record<string, number> | undefined
  if (!value) return null
  const data = Object.entries(value).map(([name, v]) => ({
    name,
    value: typeof v === 'number' ? v : Number(v) || 0,
  }))
  return (
    <ResponsiveContainer width="100%" height={180}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} label={false}>
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
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
}
