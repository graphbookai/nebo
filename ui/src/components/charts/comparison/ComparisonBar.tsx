import { memo, useMemo } from 'react'
import type { ChartConfiguration } from 'chart.js'
import { useChartJs } from '@/components/charts/useChartJs'
import { useChartTokens } from '@/components/charts/useChartTokens'
import { DEFAULT_RUN_COLOR } from '@/lib/colors'
import type { SeriesFor } from '@/components/charts/seriesFor'

export const ComparisonBar = memo(function ComparisonBar({
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

  // Bar is a snapshot per loggable, so each run carries at most one entry.
  // Lay out the union of category keys on the x-axis with one stacked bar
  // per run — the cross-run comparison is the whole point of this view.
  const data = useMemo(() => {
    const categories = new Set<string>()
    const perRun: Record<string, Record<string, number>> = {}
    for (const rid of runIds) {
      const series = seriesFor(rid)
      if (!series || series.entries.length === 0) continue
      const latest = series.entries[series.entries.length - 1]
      const v = latest.value as Record<string, unknown> | undefined
      if (!v || typeof v !== 'object') continue
      perRun[rid] = {}
      for (const [k, vv] of Object.entries(v)) {
        categories.add(k)
        perRun[rid][k] = typeof vv === 'number' ? vv : Number(vv) || 0
      }
    }
    const labels = [...categories]
    // Skip runs that contributed no data — they'd otherwise render as a
    // zero-height stacked layer at the bottom of every category.
    const datasets = runIds
      .filter((rid) => perRun[rid] !== undefined)
      .map((rid) => ({
        label: rid,
        data: labels.map((cat) => perRun[rid][cat] ?? 0),
        backgroundColor: runColors.get(rid) ?? DEFAULT_RUN_COLOR,
        borderColor: runColors.get(rid) ?? DEFAULT_RUN_COLOR,
      }))
    return { labels, datasets }
  }, [runIds, runColors, seriesFor])

  const config: ChartConfiguration<'bar'> = useMemo(
    () => ({
      type: 'bar',
      data,
      options: {
        animation: false,
        responsive: false,
        maintainAspectRatio: false,
        // Stacked across runs to preserve the recharts-era behavior where
        // every category bar showed total magnitude with each run as a layer.
        scales: {
          x: {
            stacked: true,
            ticks: { color: tokens.axisTickColor, font: { size: 10 } },
            grid: { display: false },
            border: { display: false },
          },
          y: {
            stacked: true,
            ticks: { color: tokens.axisTickColor, font: { size: 10 } },
            grid: { color: tokens.gridStroke, drawTicks: false },
            border: { display: false },
          },
        },
        plugins: { legend: { display: false } },
      },
    }),
    [data, tokens.axisTickColor, tokens.gridStroke],
  )

  const { canvasRef, containerRef } = useChartJs<'bar'>({
    config,
    formatTooltip: (tooltip) => ({
      title: tooltip.title?.[0],
      items: (tooltip.dataPoints ?? []).map((dp) => {
        const ds = dp.dataset as { label?: string; backgroundColor?: string }
        const rid = String(ds.label ?? '')
        return {
          label: runNameFor(rid),
          value: (dp.parsed as { y: number }).y.toLocaleString(undefined, {
            maximumFractionDigits: 4,
          }),
          color: ds.backgroundColor ?? DEFAULT_RUN_COLOR,
        }
      }),
    }),
  })

  if (data.labels.length === 0) {
    return <p className="text-[10px] text-muted-foreground">No bar data to compare</p>
  }

  return (
    <div ref={containerRef} className="h-[140px]">
      <canvas ref={canvasRef} />
    </div>
  )
})
