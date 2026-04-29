import { memo, useMemo } from 'react'
import type { ChartConfiguration } from 'chart.js'
import type { MetricEntry } from '@/lib/api'
import { useChartJs } from './useChartJs'
import { useChartTokens } from './useChartTokens'
import { RUN_COLOR_PALETTE } from '@/lib/colors'

// Pie inherently displays one slice per dict key, so we use the shared palette
// for readable slice distinction — color here represents categories within a
// snapshot, not runs. Comparing multiple pies across runs renders multiple
// independent pies (handled by the enclosing dispatcher).
export const PieMetric = memo(function PieMetric({
  entry,
  fill,
}: {
  entry: MetricEntry
  // Fill the parent's height instead of the default 180px (grid card mode).
  fill?: boolean
}) {
  const tokens = useChartTokens()

  const data = useMemo(() => {
    const value = entry.value as Record<string, number> | undefined
    if (!value) return null
    const labels: string[] = []
    const values: number[] = []
    const colors: string[] = []
    let i = 0
    for (const [name, v] of Object.entries(value)) {
      labels.push(name)
      values.push(typeof v === 'number' ? v : Number(v) || 0)
      colors.push(RUN_COLOR_PALETTE[i % RUN_COLOR_PALETTE.length])
      i++
    }
    return { labels, values, colors }
  }, [entry.value])

  const config: ChartConfiguration<'doughnut'> = useMemo(
    () => ({
      type: 'doughnut',
      data: {
        labels: data?.labels ?? [],
        datasets: [
          {
            data: data?.values ?? [],
            backgroundColor: data?.colors ?? [],
            borderWidth: 0,
          },
        ],
      },
      options: {
        animation: false,
        responsive: false,
        maintainAspectRatio: false,
        cutout: '0%', // pie, not doughnut
        plugins: { legend: { display: false } },
      },
    }),
    [data],
  )

  const { canvasRef, containerRef } = useChartJs<'doughnut'>({
    config,
    formatTooltip: (tooltip) => ({
      title: undefined,
      items: (tooltip.dataPoints ?? []).map((dp) => {
        const idx = dp.dataIndex
        const ds = dp.dataset as { backgroundColor?: string[] }
        const sliceColor = ds.backgroundColor?.[idx] ?? '#888'
        return {
          label: String(dp.label ?? ''),
          value:
            typeof dp.parsed === 'number'
              ? dp.parsed.toLocaleString(undefined, { maximumFractionDigits: 4 })
              : String(dp.formattedValue ?? ''),
          color: sliceColor,
        }
      }),
    }),
  })

  if (!data) return null

  return (
    <div className={fill ? 'flex h-full flex-col' : 'flex flex-col'}>
      <div ref={containerRef} className={fill ? 'flex-1' : 'h-[180px]'}>
        <canvas ref={canvasRef} />
      </div>
      <div
        className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[10px]"
        style={{ color: tokens.axisTickColor }}
      >
        {data.labels.map((label, i) => (
          <span
            key={label}
            className="inline-flex items-center gap-1"
            style={{ color: 'var(--color-popover-foreground)' }}
          >
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                background: data.colors[i],
                borderRadius: 2,
              }}
            />
            {label}
          </span>
        ))}
      </div>
    </div>
  )
})
