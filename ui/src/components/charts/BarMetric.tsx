import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { MetricEntry } from '@/lib/api'

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
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'oklch(0.556 0 0)' }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 10, fill: 'oklch(0.556 0 0)' }} tickLine={false} axisLine={false} width={40} />
        <Tooltip
          contentStyle={{ backgroundColor: 'oklch(0.205 0 0)', border: '1px solid oklch(0.3 0 0)', borderRadius: 6, fontSize: 11 }}
          labelStyle={{ color: 'oklch(0.708 0 0)' }}
        />
        <Bar dataKey="value" fill="#22d3ee" />
      </BarChart>
    </ResponsiveContainer>
  )
}
