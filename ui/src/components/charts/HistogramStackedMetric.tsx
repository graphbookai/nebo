import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import type { MetricEntry } from '@/lib/api'
import {
  chartAxisTick,
  chartBarCursor,
  chartHiddenWrapper,
  METRIC_COLORS,
} from './chartStyles'
import { PortalTooltip } from './PortalTooltip'

const NUM_BINS = 30

function binSamples(samples: number[], edges: number[]): number[] {
  const counts = new Array(edges.length - 1).fill(0)
  const last = edges.length - 2
  const size = edges[1] - edges[0]
  const min = edges[0]
  for (const s of samples) {
    let i = Math.floor((s - min) / size)
    if (i < 0) i = 0
    if (i > last) i = last
    counts[i]++
  }
  return counts
}

// Overlaid area histograms: one Area per step, all sharing the same global
// x-binning so they visually layer on the same axes. Each Area gets a fixed
// palette color with alpha fill so overlaps remain legible.
export function HistogramStackedMetric({ entries }: { entries: MetricEntry[] }) {
  if (entries.length === 0) return null

  const rawSamples: number[][] = entries.map((e) =>
    Array.isArray(e.value) ? (e.value as number[]) : [],
  )
  const flat = rawSamples.flat()
  if (flat.length === 0) return null

  const min = Math.min(...flat)
  const max = Math.max(...flat)
  const range = max - min || 1
  const size = range / NUM_BINS
  const edges = Array.from({ length: NUM_BINS + 1 }, (_, i) => min + i * size)

  const perStepCounts = rawSamples.map((s) => binSamples(s, edges))

  const keys = entries.map((e, j) => `step${e.step ?? j}`)

  const data = edges.slice(0, NUM_BINS).map((binStart, i) => {
    const row: Record<string, number> = { x: binStart + size / 2 }
    keys.forEach((k, j) => {
      row[k] = perStepCounts[j][i] ?? 0
    })
    return row
  })

  return (
    <ResponsiveContainer width="100%" height={220}>
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
        <Legend
          verticalAlign="bottom"
          wrapperStyle={{ fontSize: 10 }}
          formatter={(v) => (
            <span style={{ color: 'var(--color-popover-foreground)' }}>{v}</span>
          )}
        />
        {keys.map((k, j) => {
          const color = METRIC_COLORS[j % METRIC_COLORS.length]
          return (
            <Area
              key={k}
              dataKey={k}
              type="monotone"
              stroke={color}
              fill={color}
              fillOpacity={0.3}
              isAnimationActive={false}
            />
          )
        })}
      </AreaChart>
    </ResponsiveContainer>
  )
}
