import { memo, useMemo } from 'react'
import type { ChartConfiguration } from 'chart.js'
import { useChartJs } from '@/components/charts/useChartJs'
import { useChartTokens } from '@/components/charts/useChartTokens'
import { shapeForLabel } from '@/components/charts/scatterShape'
import { DEFAULT_RUN_COLOR } from '@/lib/colors'
import type { SeriesFor } from '@/components/charts/seriesFor'

export const ComparisonScatter = memo(function ComparisonScatter({
  runIds,
  runColors,
  runNameFor,
  seriesFor,
}: {
  runIds: string[]
  runColors: Map<string, string>
  runNameFor: (rid: string) => string
  seriesFor: SeriesFor
}) {
  const tokens = useChartTokens()

  // Build the union of labels across runs first so shape assignment is
  // stable regardless of which run we iterate first.
  const allLabels = useMemo(() => {
    const set = new Set<string>()
    for (const rid of runIds) {
      const s = seriesFor(rid)
      if (!s || s.entries.length === 0) continue
      const latest = s.entries[s.entries.length - 1]
      const v = latest.value as Record<string, unknown> | undefined
      if (!v || typeof v !== 'object') continue
      for (const k of Object.keys(v)) set.add(k)
    }
    return [...set].sort()
  }, [runIds, seriesFor])

  const datasets = useMemo(() => {
    const out: {
      label: string
      data: { x: number; y: number }[]
      backgroundColor: string
      borderColor: string
      borderWidth: number
      pointStyle: string
      pointRadius: number
      runId: string
      pointLabel: string
    }[] = []
    for (const rid of runIds) {
      const s = seriesFor(rid)
      if (!s || s.entries.length === 0) continue
      const latest = s.entries[s.entries.length - 1]
      const v = latest.value as Record<string, { x?: unknown; y?: unknown }> | undefined
      if (!v || typeof v !== 'object') continue
      const runColor = runColors.get(rid) ?? DEFAULT_RUN_COLOR
      for (const [label, series] of Object.entries(v)) {
        if (!series || !Array.isArray(series.x) || !Array.isArray(series.y)) continue
        const xs = series.x as number[]
        const ys = series.y as number[]
        const data = xs.map((x, i) => ({ x, y: ys[i] }))
        out.push({
          label: `${rid}::${label}`, // unique dataset id for Chart.js
          data,
          backgroundColor: runColor, // run identity = color
          borderColor: tokens.tooltipFg,
          borderWidth: 0.5,
          pointStyle: shapeForLabel(label, allLabels), // label = shape
          pointRadius: 4,
          runId: rid,
          pointLabel: label,
        })
      }
    }
    return out
  }, [runIds, runColors, seriesFor, allLabels, tokens.tooltipFg])

  const config: ChartConfiguration<'scatter'> = useMemo(
    () => ({
      type: 'scatter',
      data: { datasets },
      options: {
        animation: false,
        responsive: false,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'linear',
            ticks: { color: tokens.axisTickColor, font: { size: 10 } },
            grid: { color: tokens.gridStroke, drawTicks: false },
            border: { display: false },
          },
          y: {
            type: 'linear',
            ticks: { color: tokens.axisTickColor, font: { size: 10 } },
            grid: { color: tokens.gridStroke, drawTicks: false },
            border: { display: false },
          },
        },
        plugins: { legend: { display: false } },
      },
    }),
    [datasets, tokens.axisTickColor, tokens.gridStroke],
  )

  const { canvasRef, containerRef } = useChartJs<'scatter'>({
    config,
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

  if (datasets.length === 0) {
    return <p className="text-[10px] text-muted-foreground">No scatter data to compare</p>
  }

  return (
    <div ref={containerRef} className="h-[200px]">
      <canvas ref={canvasRef} />
    </div>
  )
})
