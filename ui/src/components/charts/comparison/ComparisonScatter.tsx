import { memo, useMemo } from 'react'
import type { ChartConfiguration } from 'chart.js'
import { useChartJs, useResetZoomSignal } from '@/components/charts/useChartJs'
import { useChartTokens } from '@/components/charts/useChartTokens'
import { shapeForLabel } from '@/components/charts/scatterShape'
import { DEFAULT_RUN_COLOR } from '@/lib/colors'
import type { SeriesFor } from '@/components/charts/seriesFor'
import { useStore } from '@/store'
import { withAlpha } from '@/components/charts/withAlpha'
import { useChartDpr } from '@/components/charts/ChartDprContext'
import { attachWheelHandler, buildZoomOptions } from '@/components/charts/zoomBindings'
import { formatTick } from '@/components/charts/formatTick'

type ScatterPoint = { x: number; y: number; step: number | null }

export const ComparisonScatter = memo(function ComparisonScatter({
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
  const timelineMode = useStore(s => s.timeline.mode)
  const timelineStep = useStore(s => s.timeline.step)
  const pointOpacity = useStore(s => s.settings.scatterPointOpacity)
  const pointSizeScale = useStore(s => s.settings.scatterPointSize)
  const isFiltering = timelineMode === 'step' && timelineStep != null

  // Build the union of labels across runs by walking *every* entry
  // (scatter accumulates: each emission appends points). The previous
  // implementation only looked at the latest emission, which is why
  // metrics_gallery's 40-emission scatter showed only 2 points per run.
  const allLabels = useMemo(() => {
    const set = new Set<string>()
    for (const rid of runIds) {
      const s = seriesFor(rid)
      if (!s) continue
      for (const e of s.entries) {
        const v = e.value as Record<string, unknown> | undefined
        if (!v || typeof v !== 'object') continue
        for (const k of Object.keys(v)) set.add(k)
      }
    }
    return [...set].sort()
  }, [runIds, seriesFor])

  const datasets = useMemo(() => {
    const out: {
      label: string
      data: ScatterPoint[]
      backgroundColor: string | string[]
      borderColor: string
      borderWidth: number | number[]
      pointStyle: string
      pointRadius: number | number[]
      runId: string
      pointLabel: string
    }[] = []
    const scale = (n: number) => Math.max(1, n * pointSizeScale)
    for (const rid of runIds) {
      const s = seriesFor(rid)
      if (!s || s.entries.length === 0) continue
      const runColor = runColors.get(rid) ?? DEFAULT_RUN_COLOR
      const activeColor = withAlpha(runColor, pointOpacity)
      const dimmed = withAlpha(runColor, 0.25)
      // Accumulate points per (run, label) across every emission so the
      // chart shows the union of all logged points, not just the last
      // emission's slice. Each point carries its emission's `step` so
      // the active-step filter can dim non-matching points.
      const pointsByLabel = new Map<string, ScatterPoint[]>()
      for (const e of s.entries) {
        const v = e.value as Record<string, { x?: unknown; y?: unknown }> | undefined
        if (!v || typeof v !== 'object') continue
        for (const [label, series] of Object.entries(v)) {
          if (!series || !Array.isArray(series.x) || !Array.isArray(series.y)) continue
          const xs = series.x as number[]
          const ys = series.y as number[]
          const bucket = pointsByLabel.get(label) ?? []
          for (let i = 0; i < xs.length; i++) {
            bucket.push({ x: xs[i], y: ys[i], step: e.step ?? null })
          }
          pointsByLabel.set(label, bucket)
        }
      }
      for (const [label, points] of pointsByLabel) {
        // Per-point styling so the active-step points pop without
        // splitting into a second dataset (which would double label
        // entries and break the tooltip's 1:1 with logged values).
        const bg: string[] = []
        const radius: number[] = []
        const borderW: number[] = []
        for (const p of points) {
          const isActive = isFiltering && p.step === timelineStep
          if (isFiltering && !isActive) {
            bg.push(dimmed)
            radius.push(scale(3))
            borderW.push(0)
          } else {
            bg.push(activeColor)
            radius.push(scale(isActive ? 7 : 4))
            borderW.push(isActive ? 1.5 : 0.5)
          }
        }
        out.push({
          label: `${rid}::${label}`, // unique dataset id for Chart.js
          data: points,
          backgroundColor: bg,
          borderColor: tokens.tooltipFg,
          borderWidth: borderW,
          pointStyle: shapeForLabel(label, allLabels), // label = shape
          pointRadius: radius,
          runId: rid,
          pointLabel: label,
        })
      }
    }
    return out
  }, [runIds, runColors, seriesFor, allLabels, tokens.tooltipFg, isFiltering, timelineStep, pointOpacity, pointSizeScale])

  const config: ChartConfiguration<'scatter'> = useMemo(
    () => ({
      type: 'scatter',
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
            type: 'linear',
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
          zoom: buildZoomOptions('xy'),
        } as unknown as ChartConfiguration<'scatter'>['options'] extends { plugins?: infer P }
          ? P
          : never,
      },
    }),
    [datasets, tokens.axisTickColor, tokens.gridStroke],
  )

  const { canvasRef, containerRef, chartRef } = useChartJs<'scatter'>({
    config,
    dpr,
    onChartReady: (chart) => attachWheelHandler(chart, 'xy'),
    formatTooltip: (tooltip) => ({
      title: undefined,
      items: (tooltip.dataPoints ?? []).map((dp) => {
        const ds = dp.dataset as {
          backgroundColor?: string
          runId?: string
          pointLabel?: string
        }
        const xy = dp.parsed as { x: number; y: number }
        return {
          label: `${runNameFor(ds.runId ?? '')} · ${ds.pointLabel ?? ''}`,
          value: `(${xy.x.toLocaleString(undefined, {
            maximumFractionDigits: 4,
          })}, ${xy.y.toLocaleString(undefined, { maximumFractionDigits: 4 })})`,
          color: ds.backgroundColor ?? DEFAULT_RUN_COLOR,
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
      {isFiltering && datasets.length > 0 && (
        <span className="absolute top-1 right-1 text-[10px] font-medium text-primary-foreground bg-primary/80 rounded px-1.5 py-px pointer-events-none z-10">
          step {timelineStep}
        </span>
      )}
      {datasets.length === 0 && (
        <p className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground pointer-events-none">
          No scatter data to compare
        </p>
      )}
    </div>
  )
})
