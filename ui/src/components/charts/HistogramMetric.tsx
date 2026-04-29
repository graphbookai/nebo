import { memo, useMemo } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { MetricEntry } from '@/lib/api'
import { chartAxisTick, chartBarCursor, chartHiddenWrapper } from './chartStyles'
import { PortalTooltip } from './PortalTooltip'
import { RUN_COLOR_PALETTE } from '@/lib/colors'

const NUM_BINS = 30

function minMax(xs: number[]): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (const x of xs) {
    if (x < min) min = x
    if (x > max) max = x
  }
  return { min, max }
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

// Snapshot histogram. Each emission's value is `{label: list[number]}`;
// every label becomes its own Area, all binned against a shared min/max so
// overlaps line up. After the v3 metric model, histograms overwrite on
// re-emission, so `entries` always carries at most one snapshot.
//
// `colors=false` (default) draws every Area in the run color and lets
// alpha compositing carry the overlap story. `colors=true` switches to
// the shared palette so individual labels can be picked out — useful in
// single-run views, ambiguous in comparison views (where the palette is
// reserved for run identity).
export const HistogramMetric = memo(function HistogramMetric({
  entries,
  color,
  fill,
  activeLabels,
  allLabels,
}: {
  entries: MetricEntry[]
  color: string
  // Fill the parent's height instead of the default 200 px (grid card mode).
  fill?: boolean
  // Optional set of labels the user has toggled on via the chip row.
  // When omitted, every label renders.
  activeLabels?: Set<string>
  // Full label vocabulary (every label that has ever appeared on this
  // metric, in stable order). Used to assign palette colors so a
  // label's color doesn't shift when other labels are toggled off via
  // the chip row. When omitted, the rendered (filtered) label list is
  // used as a fallback.
  allLabels?: string[]
}) {
  const latest = entries.length > 0 ? entries[entries.length - 1] : null
  const colorsByLabel = latest?.colors === true

  const view = useMemo(() => {
    if (!latest) return null
    const value = latest.value
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null

    // Filter to the labels the user has chip-selected. Falling back to
    // "all labels" when the chip set is undefined keeps the chart usable
    // outside MetricBlock.
    const labels = Object.keys(value as Record<string, unknown>).filter(
      l => !activeLabels || activeLabels.has(l),
    )
    if (labels.length === 0) return null

    // Bin every label against a shared global range so overlapping
    // distributions remain comparable on the same axes.
    const samplesByLabel: Record<string, number[]> = {}
    let min = Infinity
    let max = -Infinity
    for (const label of labels) {
      const raw = (value as Record<string, unknown>)[label]
      const samples = Array.isArray(raw) ? (raw as number[]) : []
      samplesByLabel[label] = samples
      const mm = minMax(samples)
      if (mm.min < min) min = mm.min
      if (mm.max > max) max = mm.max
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null
    const range = max - min || 1
    const size = range / NUM_BINS

    const counts = labels.map(l => binCounts(samplesByLabel[l], min, size, NUM_BINS))
    const data = Array.from({ length: NUM_BINS }, (_, i) => {
      const row: Record<string, number> = { x: min + (i + 0.5) * size }
      labels.forEach((l, j) => {
        row[l] = counts[j][i] ?? 0
      })
      return row
    })
    return { data, labels }
  }, [latest, activeLabels])

  if (!view) return null

  const containerProps = fill
    ? { width: '100%' as const, height: '100%' as const }
    : { width: '100%' as const, height: 200 }

  return (
    <ResponsiveContainer {...containerProps}>
      <AreaChart data={view.data}>
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
        {view.labels.map((label) => {
          // Color index is the label's position in the full vocabulary,
          // not in the filtered list — otherwise toggling a chip off
          // would re-index every remaining label's color.
          const paletteIdx = allLabels ? allLabels.indexOf(label) : view.labels.indexOf(label)
          const labelColor = colorsByLabel
            ? RUN_COLOR_PALETTE[(paletteIdx < 0 ? 0 : paletteIdx) % RUN_COLOR_PALETTE.length]
            : color
          return (
            <Area
              key={label}
              dataKey={label}
              name={label}
              type="monotone"
              stroke={labelColor}
              fill={labelColor}
              fillOpacity={0.22}
              isAnimationActive={false}
            />
          )
        })}
      </AreaChart>
    </ResponsiveContainer>
  )
})
