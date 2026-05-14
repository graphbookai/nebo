import { memo, useMemo } from 'react'
import type { ChartConfiguration } from 'chart.js'
import type { MetricEntry } from '@/lib/api'
import { useChartJs, useResetZoomSignal } from './useChartJs'
import { useChartTokens } from './useChartTokens'
import { RUN_COLOR_PALETTE } from '@/lib/colors'
import { useStore, DEFAULT_HISTOGRAM_BIN_COUNT } from '@/store'
import { formatTick } from './formatTick'
import { attachWheelHandler, buildZoomOptions } from './zoomBindings'
import { withAlpha } from './withAlpha'
import { emaSmooth } from './smoothing'
import { useChartDpr } from './ChartDprContext'

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
  resetSignal,
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
  // Counter the parent increments to trigger `chart.resetZoom()`. The
  // reset button itself lives in the parent's chip row.
  resetSignal?: number
}) {
  const tokens = useChartTokens()
  const dpr = useChartDpr()
  const latest = entries.length > 0 ? entries[entries.length - 1] : null
  const colorsByLabel = latest?.colors === true
  const binCount = useStore(s => s.settings.histogramBinCount ?? DEFAULT_HISTOGRAM_BIN_COUNT)
  const histogramSmoothing = useStore(s => s.settings.histogramSmoothing ?? 0)

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
    const size = range / binCount

    const datasets = labels.map((label) => {
      const counts = binCounts(samplesByLabel[label], min, size, binCount)
      // Apply EMA over the bin counts when smoothing is on. Per-label so
      // overlapping distributions stay distinguishable.
      const smoothed = emaSmooth(counts, histogramSmoothing)
      const data = smoothed.map((c, i) => ({ x: min + (i + 0.5) * size, y: c }))
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
        // tension=0 keeps the bin-to-bin outline as a polyline instead
        // of a bezier curve; the smoothing setting still softens the
        // bin counts upstream via an EMA.
        tension: 0,
        fill: 'origin' as const,
      }
    })
    return { datasets, min, max }
  }, [latest, activeLabels, color, colorsByLabel, allLabels, binCount, histogramSmoothing])

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
              callback: (value) => formatTick(value as number),
            },
            grid: { color: tokens.gridStroke, drawTicks: false },
            border: { display: false },
          },
          y: {
            ticks: {
              color: tokens.axisTickColor,
              font: { size: 10 },
              callback: (value) => formatTick(value as number),
            },
            grid: { color: tokens.gridStroke, drawTicks: false },
            border: { display: false },
          },
        },
        plugins: {
          legend: { display: false },
          zoom: buildZoomOptions('x'),
        } as unknown as ChartConfiguration<'line'>['options'] extends { plugins?: infer P }
          ? P
          : never,
        // Hover anywhere along x picks the nearest bin across all labels —
        // matches recharts' AreaChart cursor behavior. Without this,
        // Chart.js's default 'nearest'+'intersect: true' only fires when the
        // pointer is on a (zero-radius) point.
        interaction: { mode: 'index', intersect: false },
      },
    }
  }, [view, tokens.axisTickColor, tokens.gridStroke])

  const { canvasRef, containerRef, chartRef } = useChartJs<'line'>({
    config: config ?? { type: 'line', data: { datasets: [] } },
    dpr,
    onChartReady: (chart) => attachWheelHandler(chart, 'x'),
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

  useResetZoomSignal(chartRef, resetSignal)

  if (!view) return null

  return (
    <div ref={containerRef} className={fill ? 'h-full' : 'h-[200px]'}>
      <canvas ref={canvasRef} className="cursor-crosshair" />
    </div>
  )
})
