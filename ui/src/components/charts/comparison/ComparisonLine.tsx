import { memo, useMemo } from 'react'
import type { ChartConfiguration } from 'chart.js'
import { useChartJs } from '@/components/charts/useChartJs'
import { useChartTokens } from '@/components/charts/useChartTokens'
import { DEFAULT_RUN_COLOR } from '@/lib/colors'
import type { SeriesFor } from '@/components/charts/seriesFor'

export const ComparisonLine = memo(function ComparisonLine({
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

  const datasets = useMemo(() => {
    return runIds
      .map((rid) => {
        const s = seriesFor(rid)
        if (!s || s.type !== 'line') return null
        const data: { x: number; y: number }[] = []
        for (let i = 0; i < s.entries.length; i++) {
          const e = s.entries[i]
          const step = e.step ?? i
          const v = typeof e.value === 'number' ? e.value : Number(e.value)
          if (!Number.isFinite(v)) continue
          data.push({ x: step, y: v })
        }
        return {
          label: rid,
          data,
          borderColor: runColors.get(rid) ?? DEFAULT_RUN_COLOR,
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.3,
          spanGaps: true,
        }
      })
      .filter((d): d is NonNullable<typeof d> => d !== null)
  }, [runIds, runColors, seriesFor])

  const config: ChartConfiguration<'line'> = useMemo(
    () => ({
      type: 'line',
      data: { datasets },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'linear',
            ticks: { color: tokens.axisTickColor, font: { size: 10 } },
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
        interaction: { mode: 'index', intersect: false },
      },
    }),
    [datasets, tokens.axisTickColor, tokens.gridStroke],
  )

  const { canvasRef, containerRef } = useChartJs<'line'>({
    config,
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

  if (datasets.length === 0) {
    return <p className="text-[10px] text-muted-foreground">No line data to compare</p>
  }

  return (
    <div ref={containerRef} className="h-[140px]">
      <canvas ref={canvasRef} className="cursor-crosshair" />
    </div>
  )
})
