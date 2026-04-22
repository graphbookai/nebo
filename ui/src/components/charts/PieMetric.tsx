import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import type { MetricEntry } from '@/lib/api'
import { chartHiddenWrapper } from './chartStyles'
import { PortalTooltip } from './PortalTooltip'

const COLORS = ['#60a5fa', '#f472b6', '#34d399', '#facc15', '#a78bfa', '#22d3ee', '#f87171']

export function PieMetric({ entries }: { entries: MetricEntry[] }) {
  if (entries.length === 0) return null
  const latest = entries[entries.length - 1].value as Record<string, number>
  const data = Object.entries(latest).map(([name, value]) => ({
    name,
    value: typeof value === 'number' ? value : Number(value) || 0,
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
