import { memo, useMemo } from 'react'
import type { ChartConfiguration } from 'chart.js'
import type { MetricEntry } from '@/lib/api'
import { useChartJs } from './useChartJs'
import { useChartTokens } from './useChartTokens'
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

// Hex-to-rgba so we can apply 0.22 alpha to the per-label fill — the same
// fillOpacity recharts' AreaChart used.
function withAlpha(hex: string, alpha: number): string {
  const trimmed = hex.trim()
  if (!trimmed.startsWith('#') || (trimmed.length !== 4 && trimmed.length !== 7)) {
    return trimmed
  }
  const expanded =
    trimmed.length === 4
      ? `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`
      : trimmed
  const r = parseInt(expanded.slice(1, 3), 16)
  const g = parseInt(expanded.slice(3, 5), 16)
  const b = parseInt(expanded.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// Snapshot histogram. Each emission's value is `{label: list[number]}`;
// every label becomes its own filled-line series, all binned against a
// shared min/max so overlaps line up. After the v3 metric model,
// histograms overwrite on re-emission, so `entries` always carries at most
// one snapshot.
//
// `colors=false` (default) draws every series in the run color and lets
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
  fill?: boolean
  // Optional set of labels the user has toggled on via the chip row.
  activeLabels?: Set<string>
  // Full label vocabulary (every label that has ever appeared on this
  // metric, in stable order). Used to assign palette colors so a
  // label's color doesn't shift when other labels are toggled off via
  // the chip row.
  allLabels?: string[]
}) {
  const tokens = useChartTokens()
  const latest = entries.length > 0 ? entries[entries.length - 1] : null
  const colorsByLabel = latest?.colors === true

  const view = useMemo(() => {
    if (!latest) return null
    const value = latest.value
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null

    const labels = Object.keys(value as Record<string, unknown>).filter(
      (l) => !activeLabels || activeLabels.has(l),
    )
    if (labels.length === 0) return null

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

    const datasets = labels.map((label) => {
      const counts = binCounts(samplesByLabel[label], min, size, NUM_BINS)
      const data = counts.map((c, i) => ({ x: min + (i + 0.5) * size, y: c }))
      const paletteIdx = allLabels ? allLabels.indexOf(label) : labels.indexOf(label)
      const labelColor = colorsByLabel
        ? RUN_COLOR_PALETTE[(paletteIdx < 0 ? 0 : paletteIdx) % RUN_COLOR_PALETTE.length]
        : color
      return {
        label,
        data,
        borderColor: labelColor,
        backgroundColor: withAlpha(labelColor, 0.22),
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.3,
        fill: 'origin' as const,
      }
    })
    return { datasets, min, max }
  }, [latest, activeLabels, color, colorsByLabel, allLabels])

  const config: ChartConfiguration<'line'> | null = useMemo(() => {
    if (!view) return null
    return {
      type: 'line',
      data: { datasets: view.datasets },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'linear',
            ticks: {
              color: tokens.axisTickColor,
              font: { size: 10 },
              callback: (value) => Number(value).toFixed(2),
            },
            grid: { color: tokens.gridStroke, drawTicks: false },
            border: { display: false },
          },
          y: {
            ticks: { color: tokens.axisTickColor, font: { size: 10 } },
            grid: { color: tokens.gridStroke, drawTicks: false },
            border: { display: false },
          },
        },
        plugins: { legend: { display: false } },
        // Hover anywhere along x picks the nearest bin across all labels —
        // matches recharts' AreaChart cursor behavior. Without this,
        // Chart.js's default 'nearest'+'intersect: true' only fires when the
        // pointer is on a (zero-radius) point.
        interaction: { mode: 'index', intersect: false },
      },
    }
  }, [view, tokens.axisTickColor, tokens.gridStroke])

  const { canvasRef, containerRef } = useChartJs<'line'>({
    config: config ?? { type: 'line', data: { datasets: [] } },
    formatTooltip: (tooltip) => ({
      title: tooltip.dataPoints?.[0]
        ? `x≈${(tooltip.dataPoints[0].parsed as { x: number }).x.toFixed(2)}`
        : undefined,
      items: (tooltip.dataPoints ?? []).map((dp) => {
        const ds = dp.dataset as { label?: string; borderColor?: string }
        return {
          label: String(ds.label ?? ''),
          value: String((dp.parsed as { y: number }).y),
          color: ds.borderColor ?? color,
        }
      }),
    }),
  })

  if (!view) return null

  return (
    <div ref={containerRef} className={fill ? 'h-full' : 'h-[200px]'}>
      <canvas ref={canvasRef} className="cursor-crosshair" />
    </div>
  )
})
