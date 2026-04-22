import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { MetricEntry } from '@/lib/api'
import {
  chartAxisTick,
  chartTooltipContent,
  chartTooltipLabel,
  chartTooltipWrapper,
  chartTooltipAllowEscape,
} from './chartStyles'

function fdBins(samples: number[]): { x: number; count: number }[] {
  if (samples.length < 2) return samples.map(s => ({ x: s, count: 1 }))
  const sorted = [...samples].sort((a, b) => a - b)
  const q1 = sorted[Math.floor(sorted.length * 0.25)]
  const q3 = sorted[Math.floor(sorted.length * 0.75)]
  const iqr = q3 - q1 || 1
  const width = (2 * iqr) / Math.cbrt(sorted.length)
  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  const range = max - min || 1
  const numBins = Math.min(50, Math.max(20, Math.ceil(range / (width || 1))))
  const size = range / numBins
  const counts = new Array(numBins).fill(0)
  for (const s of samples) {
    const i = Math.min(numBins - 1, Math.floor((s - min) / (size || 1)))
    counts[i]++
  }
  return counts.map((c, i) => ({ x: min + (i + 0.5) * size, count: c }))
}

export function HistogramMetric({ entries }: { entries: MetricEntry[] }) {
  if (entries.length === 0) return null
  const latest = entries[entries.length - 1].value
  let data: { x: number; count: number }[]
  if (Array.isArray(latest)) {
    data = fdBins(latest as number[])
  } else if (
    latest &&
    typeof latest === 'object' &&
    'bins' in latest &&
    'counts' in latest
  ) {
    const v = latest as { bins: number[]; counts: number[] }
    data = v.bins.map((x, i) => ({ x, count: v.counts[i] ?? 0 }))
  } else {
    return null
  }
  return (
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart data={data}>
        <XAxis
          dataKey="x"
          type="number"
          tick={chartAxisTick}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => Number(v).toFixed(2)}
        />
        <YAxis tick={chartAxisTick} tickLine={false} axisLine={false} width={40} />
        <Tooltip
          contentStyle={chartTooltipContent}
          labelStyle={chartTooltipLabel}
          wrapperStyle={chartTooltipWrapper}
          allowEscapeViewBox={chartTooltipAllowEscape}
          labelFormatter={(v) => `x≈${Number(v).toFixed(2)}`}
        />
        <Area type="monotone" dataKey="count" stroke="#60a5fa" fill="#60a5fa" fillOpacity={0.3} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}
