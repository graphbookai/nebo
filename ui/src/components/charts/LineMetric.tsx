import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import type { MetricEntry } from '@/lib/api'

const MAX_DISPLAY_POINTS = 500

type LinePoint = { step: number; value: number }

function toLinePoints(entries: MetricEntry[]): LinePoint[] {
  const points: LinePoint[] = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const step = e.step ?? i
    const value = typeof e.value === 'number' ? e.value : Number(e.value)
    if (Number.isFinite(value)) {
      points.push({ step, value })
    }
  }
  return points
}

function downsample(series: LinePoint[]): LinePoint[] {
  if (series.length <= MAX_DISPLAY_POINTS) return series
  const step = Math.ceil(series.length / MAX_DISPLAY_POINTS)
  const result: LinePoint[] = []
  for (let i = 0; i < series.length; i += step) {
    result.push(series[i])
  }
  // Always include the last point
  if (result[result.length - 1] !== series[series.length - 1]) {
    result.push(series[series.length - 1])
  }
  return result
}

export function LineMetric({ entries }: { entries: MetricEntry[] }) {
  if (entries.length === 0) return null
  const data = downsample(toLinePoints(entries))
  return (
    <div className="h-[120px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0 0)" />
          <XAxis
            dataKey="step"
            tick={{ fontSize: 10, fill: 'oklch(0.556 0 0)' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'oklch(0.556 0 0)' }}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'oklch(0.205 0 0)',
              border: '1px solid oklch(0.3 0 0)',
              borderRadius: '6px',
              fontSize: '11px',
            }}
            labelStyle={{ color: 'oklch(0.708 0 0)' }}
            formatter={(value) => [(value as number)?.toFixed(4) ?? '', 'value']}
            labelFormatter={(step) => `Step ${step}`}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#3b82f6"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
