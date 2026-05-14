import { memo, useMemo } from 'react'
import type { ChartConfiguration } from 'chart.js'
import { useChartJs, useResetZoomSignal } from '@/components/charts/useChartJs'
import { useChartTokens } from '@/components/charts/useChartTokens'
import { DEFAULT_RUN_COLOR } from '@/lib/colors'
import type { SeriesFor } from '@/components/charts/seriesFor'
import { withAlpha } from '@/components/charts/withAlpha'
import { emaSmooth } from '@/components/charts/smoothing'
import { useChartDpr } from '@/components/charts/ChartDprContext'
import { attachWheelHandler, buildZoomOptions } from '@/components/charts/zoomBindings'
import { formatTick } from '@/components/charts/formatTick'
import { useStore, DEFAULT_HISTOGRAM_BIN_COUNT } from '@/store'

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

export const ComparisonHistogram = memo(function ComparisonHistogram({
  runIds,
  runColors,
  runNameFor,
  seriesFor,
  resetSignal,
}: {
  runIds: string[]
  runColors: Map<string, string>
  runNameFor: (rid: string) => string
  seriesFor: SeriesFor
  resetSignal?: number
}) {
  const tokens = useChartTokens()
  const dpr = useChartDpr()
  const binCount = useStore(s => s.settings.histogramBinCount ?? DEFAULT_HISTOGRAM_BIN_COUNT)
  const histogramSmoothing = useStore(s => s.settings.histogramSmoothing ?? 0)

  const view = useMemo(() => {
    type Entry = { rid: string; label: string; samples: number[]; color: string }
    const entries: Entry[] = []
    let gMin = Infinity
    let gMax = -Infinity
    for (const rid of runIds) {
      const s = seriesFor(rid)
      if (!s || s.entries.length === 0) continue
      const latest = s.entries[s.entries.length - 1]
      const v = latest.value as Record<string, unknown> | undefined
      if (!v || typeof v !== 'object') continue
      const runColor = runColors.get(rid) ?? DEFAULT_RUN_COLOR
      for (const [label, raw] of Object.entries(v)) {
        const samples = Array.isArray(raw) ? (raw as number[]) : []
        if (samples.length === 0) continue
        entries.push({ rid, label, samples, color: runColor })
        const mm = minMax(samples)
        if (mm.min < gMin) gMin = mm.min
        if (mm.max > gMax) gMax = mm.max
      }
    }
    if (entries.length === 0 || !Number.isFinite(gMin) || !Number.isFinite(gMax)) {
      return null
    }
    const range = gMax - gMin || 1
    const size = range / binCount

    const datasets = entries.map(({ rid, label, samples, color }) => {
      const counts = binCounts(samples, gMin, size, binCount)
      const smoothed = emaSmooth(counts, histogramSmoothing)
      const data = smoothed.map((c, i) => ({ x: gMin + (i + 0.5) * size, y: c }))
      return {
        label: `${rid}::${label}`,
        data,
        borderColor: color,
        backgroundColor: withAlpha(color, 0.22),
        borderWidth: 1.5,
        pointRadius: 0,
        // tension=0 keeps the bin-to-bin outline as a polyline; the
        // smoothing setting still softens the bin counts upstream.
        tension: 0,
        fill: 'origin' as const,
        runId: rid,
        pointLabel: label,
      }
    })
    return { datasets, min: gMin, max: gMax }
  }, [runIds, runColors, seriesFor, binCount, histogramSmoothing])

  const config: ChartConfiguration<'line'> = useMemo(
    () => ({
      type: 'line',
      data: { datasets: view?.datasets ?? [] },
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
      },
    }),
    [view, tokens.axisTickColor, tokens.gridStroke],
  )

  const { canvasRef, containerRef, chartRef } = useChartJs<'line'>({
    config,
    dpr,
    onChartReady: (chart) => attachWheelHandler(chart, 'x'),
    formatTooltip: (tooltip) => ({
      title: tooltip.dataPoints?.[0]
        ? `x≈${(tooltip.dataPoints[0].parsed as { x: number }).x.toFixed(2)}`
        : undefined,
      items: (tooltip.dataPoints ?? []).map((dp) => {
        const ds = dp.dataset as {
          borderColor?: string
          runId?: string
          pointLabel?: string
        }
        return {
          label: `${runNameFor(ds.runId ?? '')} · ${ds.pointLabel ?? ''}`,
          value: String((dp.parsed as { y: number }).y),
          color: ds.borderColor ?? DEFAULT_RUN_COLOR,
        }
      }),
    }),
  })

  useResetZoomSignal(chartRef, resetSignal)

  // Keep the canvas mounted; see ComparisonLine for the useChartJs
  // mount-effect rationale.
  return (
    <div ref={containerRef} className="relative h-[200px]">
      <canvas ref={canvasRef} className="cursor-crosshair" />
      {!view && (
        <p className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground pointer-events-none">
          No histogram data to compare
        </p>
      )}
    </div>
  )
})
