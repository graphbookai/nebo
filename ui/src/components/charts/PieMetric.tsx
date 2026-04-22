import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import type { MetricEntry } from '@/lib/api'

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
        <Tooltip
          contentStyle={{ backgroundColor: 'oklch(0.205 0 0)', border: '1px solid oklch(0.3 0 0)', borderRadius: 6, fontSize: 11 }}
        />
        <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 10 }} />
      </PieChart>
    </ResponsiveContainer>
  )
}
