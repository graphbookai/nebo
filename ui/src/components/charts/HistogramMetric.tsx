import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { MetricEntry } from '@/lib/api'
import { chartAxisTick, chartBarCursor, chartHiddenWrapper } from './chartStyles'
import { PortalTooltip } from './PortalTooltip'

const NUM_BINS = 30

function extractSamples(value: unknown): number[] {
  if (Array.isArray(value)) return value as number[]
  return []
}

function binCounts(samples: number[], min: number, size: number, bins: number): number[] {
  const counts = new Array(bins).fill(0)
  for (const s of samples) {
    let i = Math.floor((s - min) / size)
    if (i < 0) i = 0
    if (i > bins - 1) i = bins - 1
    counts[i]++
  }
  return counts
}

// All entries combined in one area chart. Every Area gets the same color so a
// single run's multi-step histograms read as one series; overlaps naturally
// darken via alpha compositing. Pre-binned entries ({bins, counts}) are
// displayed as-is as a single Area (no overlap computation).
export function HistogramMetric({ entries, color }: { entries: MetricEntry[]; color: string }) {
  if (entries.length === 0) return null

  // If any entry is pre-binned, render just the latest one (single area).
  const latest = entries[entries.length - 1].value
  if (
    latest &&
    typeof latest === 'object' &&
    !Array.isArray(latest) &&
    'bins' in latest &&
    'counts' in latest
  ) {
    const v = latest as { bins: number[]; counts: number[] }
    const data = v.bins.map((x, i) => ({ x, count: v.counts[i] ?? 0 }))
    return (
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={data}>
          <XAxis dataKey="x" type="number" tick={chartAxisTick} tickLine={false} axisLine={false} tickFormatter={(v) => Number(v).toFixed(2)} />
          <YAxis tick={chartAxisTick} tickLine={false} axisLine={false} width={40} />
          <Tooltip cursor={chartBarCursor} wrapperStyle={chartHiddenWrapper} content={<PortalTooltip labelFormatter={(v) => `x≈${Number(v).toFixed(2)}`} />} />
          <Area type="monotone" dataKey="count" stroke={color} fill={color} fillOpacity={0.35} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    )
  }

  // Raw samples: bin all entries against a shared global range so they layer
  // on the same axes.
  const perEntrySamples = entries.map(e => extractSamples(e.value))
  const flat = perEntrySamples.flat()
  if (flat.length === 0) return null
  const min = Math.min(...flat)
  const max = Math.max(...flat)
  const range = max - min || 1
  const size = range / NUM_BINS

  const keys = entries.map((e, j) => `step${e.step ?? j}`)
  const counts = perEntrySamples.map(s => binCounts(s, min, size, NUM_BINS))

  const data = Array.from({ length: NUM_BINS }, (_, i) => {
    const row: Record<string, number> = { x: min + (i + 0.5) * size }
    keys.forEach((k, j) => {
      row[k] = counts[j][i] ?? 0
    })
    return row
  })

  return (
    <ResponsiveContainer width="100%" height={200}>
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
          cursor={chartBarCursor}
          wrapperStyle={chartHiddenWrapper}
          content={<PortalTooltip labelFormatter={(v) => `x≈${Number(v).toFixed(2)}`} />}
        />
        {keys.map(k => (
          <Area
            key={k}
            dataKey={k}
            type="monotone"
            stroke={color}
            fill={color}
            fillOpacity={0.22}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  )
}
