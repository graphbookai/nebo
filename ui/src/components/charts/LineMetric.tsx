import { memo, useCallback, useMemo } from 'react'
import type {
  ChartConfiguration,
  ChartEvent,
  ActiveElement,
  Chart,
  Plugin,
} from 'chart.js'
import type { MetricEntry } from '@/lib/api'
import { useChartJs } from './useChartJs'
import { useChartTokens } from './useChartTokens'
import { useStore } from '@/store'

const MAX_DISPLAY_POINTS = 500

type LinePoint = { x: number; y: number }

function toLinePoints(entries: MetricEntry[]): LinePoint[] {
  const points: LinePoint[] = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const step = e.step ?? i
    const value = typeof e.value === 'number' ? e.value : Number(e.value)
    if (Number.isFinite(value)) {
      points.push({ x: step, y: value })
    }
  }
  return points
}

function downsample(series: LinePoint[]): LinePoint[] {
  if (series.length <= MAX_DISPLAY_POINTS) return series
  const step = Math.ceil(series.length / MAX_DISPLAY_POINTS)
  const result: LinePoint[] = []
  for (let i = 0; i < series.length; i += step) {
    result.push(series[i])
  }
  if (result[result.length - 1] !== series[series.length - 1]) {
    result.push(series[series.length - 1])
  }
  return result
}

// Inline plugin that draws a vertical guideline at the active step plus a
// circle + value bubble at the data point (when one exists at that step).
// The active step is read from `chart.options.plugins.activeStepLine` so
// it picks up updates whenever React re-renders the chart.
const activeStepLinePlugin: Plugin<'line'> = {
  id: 'activeStepLine',
  afterDatasetsDraw(chart) {
    const opts = (chart.options.plugins as Record<string, unknown> | undefined)?.[
      'activeStepLine'
    ] as { value?: number | null; color?: string } | undefined
    if (!opts || opts.value == null) return
    const xScale = chart.scales.x
    const yScale = chart.scales.y
    if (!xScale || !yScale) return
    const x = xScale.getPixelForValue(opts.value)
    const area = chart.chartArea
    if (x < area.left || x > area.right) return

    const ctx = chart.ctx
    ctx.save()

    // Vertical guideline
    ctx.strokeStyle = opts.color ?? 'rgba(136, 136, 136, 0.6)'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(x, area.top)
    ctx.lineTo(x, area.bottom)
    ctx.stroke()
    ctx.setLineDash([])

    // Find the data point whose x matches the active step (first dataset).
    const ds = chart.data.datasets[0]
    let yVal: number | null = null
    if (ds && Array.isArray(ds.data)) {
      for (const p of ds.data as { x?: number; y?: number }[]) {
        if (p && p.x === opts.value && typeof p.y === 'number') {
          yVal = p.y
          break
        }
      }
    }

    if (yVal != null) {
      const y = yScale.getPixelForValue(yVal)
      // Active-step dot
      ctx.fillStyle = opts.color ?? '#888'
      ctx.beginPath()
      ctx.arc(x, y, 4, 0, Math.PI * 2)
      ctx.fill()

      // Value bubble — small rounded rect to the right of the dot,
      // flipped to the left near the right edge.
      const label = yVal.toLocaleString(undefined, { maximumFractionDigits: 4 })
      ctx.font = '10px sans-serif'
      const padding = 4
      const textW = ctx.measureText(label).width
      const bubbleW = textW + padding * 2
      const bubbleH = 14
      let bx = x + 8
      const flipLeft = bx + bubbleW > area.right - 2
      if (flipLeft) bx = x - 8 - bubbleW
      const by = Math.max(area.top + 1, Math.min(area.bottom - bubbleH - 1, y - bubbleH / 2))
      ctx.fillStyle = opts.color ?? '#888'
      ctx.beginPath()
      const r = 3
      ctx.moveTo(bx + r, by)
      ctx.lineTo(bx + bubbleW - r, by)
      ctx.quadraticCurveTo(bx + bubbleW, by, bx + bubbleW, by + r)
      ctx.lineTo(bx + bubbleW, by + bubbleH - r)
      ctx.quadraticCurveTo(bx + bubbleW, by + bubbleH, bx + bubbleW - r, by + bubbleH)
      ctx.lineTo(bx + r, by + bubbleH)
      ctx.quadraticCurveTo(bx, by + bubbleH, bx, by + bubbleH - r)
      ctx.lineTo(bx, by + r)
      ctx.quadraticCurveTo(bx, by, bx + r, by)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, bx + padding, by + bubbleH / 2)
    }

    ctx.restore()
  },
}

export const LineMetric = memo(function LineMetric({
  entries,
  color,
  fill,
}: {
  entries: MetricEntry[]
  color: string
  // When true, the chart claims its parent's height instead of locking
  // to the default 120px. Used by the grid-view card body so the chart
  // fills the card's remaining space.
  fill?: boolean
}) {
  const tokens = useChartTokens()
  const data = useMemo(() => downsample(toLinePoints(entries)), [entries])
  const timelineMode = useStore(s => s.timeline.mode)
  const timelineStep = useStore(s => s.timeline.step)
  const setTimelineMode = useStore(s => s.setTimelineMode)
  const setTimelineStep = useStore(s => s.setTimelineStep)

  const isFiltering = timelineMode === 'step' && timelineStep != null

  const handleClick = useCallback(
    (_evt: ChartEvent, elements: ActiveElement[], chart: Chart) => {
      // 'index' interaction mode (set below) returns elements for every
      // dataset at the same index; pick the first.
      if (!elements.length) return
      const el = elements[0]
      const ds = chart.data.datasets[el.datasetIndex] as { data: LinePoint[] } | undefined
      const point = ds?.data?.[el.index]
      if (!point) return
      const step = point.x
      if (timelineMode === 'step' && timelineStep === step) {
        setTimelineStep(null)
        return
      }
      if (timelineMode !== 'step') setTimelineMode('step')
      setTimelineStep(step)
    },
    [timelineMode, timelineStep, setTimelineMode, setTimelineStep],
  )

  const config: ChartConfiguration<'line'> = useMemo(() => {
    // `activeStepLine` is a custom plugin option that Chart.js's strict
    // PluginOptions type doesn't know about; cast through unknown so
    // the rest of the options stay strictly typed.
    const pluginOpts = {
      legend: { display: false },
      activeStepLine: {
        value: isFiltering ? timelineStep : null,
        color,
      },
    } as unknown as ChartConfiguration<'line'>['options'] extends { plugins?: infer P }
      ? P
      : never
    return {
      type: 'line',
      data: {
        datasets: [
          {
            data,
            borderColor: color,
            borderWidth: 1.5,
            pointRadius: 0,
            // Larger hit-radius so click + tooltip don't require landing on
            // the (invisible) point itself.
            pointHitRadius: 12,
            tension: 0.3, // approximates recharts' type="monotone" smoothing
          },
        ],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        onClick: handleClick,
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
        plugins: pluginOpts,
        // Vertical-line cursor: hover anywhere along x picks the nearest
        // step's value. Matches recharts' default tooltip cursor; without
        // this, Chart.js's default 'nearest'+'intersect: true' would only
        // fire when the pointer is on a data point — invisible here since
        // pointRadius is 0.
        interaction: { mode: 'index', intersect: false },
      },
      plugins: [activeStepLinePlugin],
    }
  }, [data, color, tokens.axisTickColor, tokens.gridStroke, handleClick, isFiltering, timelineStep])

  const { canvasRef, containerRef } = useChartJs<'line'>({
    config,
    formatTooltip: (tooltip) => ({
      title: tooltip.dataPoints?.[0]
        ? `Step ${(tooltip.dataPoints[0].parsed as { x: number }).x}`
        : undefined,
      items: (tooltip.dataPoints ?? []).map((dp) => ({
        label: 'value',
        value: (dp.parsed as { y: number }).y.toLocaleString(undefined, {
          maximumFractionDigits: 4,
        }),
        color,
      })),
    }),
  })

  if (data.length === 0) return null

  return (
    <div ref={containerRef} className={`relative ${fill ? 'h-full' : 'h-[120px]'}`}>
      <canvas ref={canvasRef} className="cursor-pointer" />
      {isFiltering && (
        <span className="absolute top-1 right-1 text-[10px] font-medium text-primary-foreground bg-primary/80 rounded px-1.5 py-px pointer-events-none z-10">
          step {timelineStep}
        </span>
      )}
    </div>
  )
})
