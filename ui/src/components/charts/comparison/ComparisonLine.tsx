import { memo, useMemo } from 'react'
import type { ChartConfiguration, Plugin } from 'chart.js'
import { useChartJs, useResetZoomSignal } from '@/components/charts/useChartJs'
import { useChartTokens } from '@/components/charts/useChartTokens'
import { DEFAULT_RUN_COLOR } from '@/lib/colors'
import type { SeriesFor } from '@/components/charts/seriesFor'
import { useStore } from '@/store'
import { withAlpha } from '@/components/charts/withAlpha'
import { smoothLinePoints } from '@/components/charts/smoothing'
import { useChartDpr } from '@/components/charts/ChartDprContext'
import { attachWheelHandler, buildZoomOptions } from '@/components/charts/zoomBindings'
import { formatTick } from '@/components/charts/formatTick'

// Each dataset carries a precomputed `_stepIndex: Map<x, y>` so the
// plugin doesn't have to scan the data array on every redraw. This
// matters once the timeline scrubber starts driving step changes
// interactively — without the index, every step delta is O(N) per run.
type StepIndexedDataset = { _stepIndex?: Map<number, number> }

// Inline plugin: vertical guideline at the active step plus a dot per
// dataset (one per run) where the curve crosses that step. Mirrors the
// single-run LineMetric indicator but iterates every dataset so each
// run gets its own marker in its own color.
const activeStepLinePlugin: Plugin<'line'> = {
  id: 'activeStepLine',
  afterDatasetsDraw(chart) {
    const opts = (chart.options.plugins as Record<string, unknown> | undefined)?.[
      'activeStepLine'
    ] as { value?: number | null } | undefined
    if (!opts || opts.value == null) return
    const xScale = chart.scales.x
    const yScale = chart.scales.y
    if (!xScale || !yScale) return
    const x = xScale.getPixelForValue(opts.value)
    const area = chart.chartArea
    if (x < area.left || x > area.right) return

    const ctx = chart.ctx
    ctx.save()

    // Vertical guideline.
    ctx.strokeStyle = 'rgba(136, 136, 136, 0.6)'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(x, area.top)
    ctx.lineTo(x, area.bottom)
    ctx.stroke()
    ctx.setLineDash([])

    // Per-run dot at the matching x value (O(1) via the dataset's
    // step-index Map).
    for (const ds of chart.data.datasets) {
      const idx = (ds as unknown as StepIndexedDataset)._stepIndex
      const yVal = idx?.get(opts.value)
      if (yVal == null) continue
      const y = yScale.getPixelForValue(yVal)
      ctx.fillStyle = String(ds.borderColor ?? '#888')
      ctx.beginPath()
      ctx.arc(x, y, 4, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.restore()
  },
}

export const ComparisonLine = memo(function ComparisonLine({
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
  // Counter the parent increments to trigger `chart.resetZoom()`. The
  // reset button itself lives in the parent's chip row.
  resetSignal?: number
}) {
  const tokens = useChartTokens()
  const dpr = useChartDpr()
  const timelineMode = useStore(s => s.timeline.mode)
  const timelineStep = useStore(s => s.timeline.step)
  const lineSmoothing = useStore(s => s.settings.lineSmoothing ?? 0)
  // Fixed line opacity in comparison views — dialed down a hair from
  // fully opaque so overlapping runs read as distinct strokes instead
  // of stacking into a single thick band.
  const LINE_OPACITY = 1.0
  const isFiltering = timelineMode === 'step' && timelineStep != null

  const datasets = useMemo(() => {
    return runIds
      .map((rid) => {
        const s = seriesFor(rid)
        if (!s || s.type !== 'line') return null
        const raw: { x: number; y: number }[] = []
        // Step index keys off raw values, not the smoothed curve, so
        // the active-step plugin marks the user's actual datapoints.
        const stepIndex = new Map<number, number>()
        for (let i = 0; i < s.entries.length; i++) {
          const e = s.entries[i]
          const step = e.step ?? i
          const v = typeof e.value === 'number' ? e.value : Number(e.value)
          if (!Number.isFinite(v)) continue
          raw.push({ x: step, y: v })
          stepIndex.set(step, v)
        }
        const data = smoothLinePoints(raw, lineSmoothing)
        return {
          label: rid,
          data,
          borderColor: withAlpha(runColors.get(rid) ?? DEFAULT_RUN_COLOR, LINE_OPACITY),
          borderWidth: 1,
          pointRadius: 0,
          // tension=0 gives hard corners between datapoints; the
          // smoothing setting still softens the data via an EMA.
          tension: 0,
          spanGaps: true,
          // Read by activeStepLinePlugin to avoid an O(N) scan per redraw.
          _stepIndex: stepIndex,
        }
      })
      .filter((d): d is NonNullable<typeof d> => d !== null)
  }, [runIds, runColors, seriesFor, lineSmoothing])

  const config: ChartConfiguration<'line'> = useMemo(
    () => {
      // `activeStepLine` is a custom plugin option Chart.js's strict
      // PluginOptions type doesn't know about; cast through unknown so
      // the rest of the options stay strictly typed.
      const pluginOpts = {
        legend: { display: false },
        activeStepLine: { value: isFiltering ? timelineStep : null },
        zoom: buildZoomOptions('x'),
      } as unknown as ChartConfiguration<'line'>['options'] extends { plugins?: infer P }
        ? P
        : never
      return {
        type: 'line',
        data: { datasets },
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
          plugins: pluginOpts,
          interaction: { mode: 'index', intersect: false },
        },
        plugins: [activeStepLinePlugin],
      }
    },
    [datasets, tokens.axisTickColor, tokens.gridStroke, isFiltering, timelineStep],
  )

  const { canvasRef, containerRef, chartRef } = useChartJs<'line'>({
    config,
    dpr,
    onChartReady: (chart) => attachWheelHandler(chart, 'x'),
    formatTooltip: (tooltip) => ({
      title: tooltip.dataPoints?.[0]
        ? `Step ${(tooltip.dataPoints[0].parsed as { x: number }).x}`
        : undefined,
      items: (tooltip.dataPoints ?? []).map((dp) => {
        const ds = dp.dataset as { label?: string; borderColor?: string }
        const rid = String(ds.label ?? '')
        return {
          label: runNameFor(rid),
          value: (dp.parsed as { y: number }).y.toLocaleString(undefined, {
            maximumFractionDigits: 4,
          }),
          color: ds.borderColor ?? DEFAULT_RUN_COLOR,
        }
      }),
    }),
  })

  useResetZoomSignal(chartRef, resetSignal)

  // Keep the canvas mounted even when there are no datasets — useChartJs's
  // mount effect uses `[]` deps, so unmounting the canvas (early-returning a
  // <p>) leaves the Chart instance bound to the old detached canvas; once
  // chips re-populate, subsequent chart.update() calls draw into nothing.
  return (
    <div ref={containerRef} className="relative h-[140px]">
      <canvas ref={canvasRef} className="cursor-crosshair" />
      {isFiltering && datasets.length > 0 && (
        <span className="absolute top-1 right-1 text-[10px] font-medium text-primary-foreground bg-primary/80 rounded px-1.5 py-px pointer-events-none z-10">
          step {timelineStep}
        </span>
      )}
      {datasets.length === 0 && (
        <p className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground pointer-events-none">
          No line data to compare
        </p>
      )}
    </div>
  )
})
