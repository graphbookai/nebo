import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import type {
  ChartConfiguration,
  ChartDataset,
  ChartEvent,
  ActiveElement,
  Chart,
  Plugin,
  ScriptableLineSegmentContext,
} from 'chart.js'
import type { MetricEntry } from '@/lib/api'
import { useChartJs } from './useChartJs'
import { useChartTokens } from './useChartTokens'
import { useStore } from '@/store'
import { UNTAGGED_KEY } from './scatterShape'
import { attachWheelHandler, buildZoomOptions } from './zoomBindings'
import { formatTick } from './formatTick'

const MAX_DISPLAY_POINTS = 500
const MUTED_COLOR = 'rgba(156, 163, 175, 0.45)' // tailwind text-muted-foreground feel

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

// Apply an exponential moving average to smooth a series.
//   s_i = α * s_{i-1} + (1 - α) * x_i
// `alpha` ∈ [0, 1]; 0 = no smoothing, → 1 = heavy smoothing.
function smoothSeries(points: LinePoint[], alpha: number): LinePoint[] {
  if (alpha <= 0 || points.length === 0) return points
  const out: LinePoint[] = new Array(points.length)
  let prev = points[0].y
  out[0] = points[0]
  for (let i = 1; i < points.length; i++) {
    const y = alpha * prev + (1 - alpha) * points[i].y
    out[i] = { x: points[i].x, y }
    prev = y
  }
  return out
}

// Inline plugin that draws a vertical guideline at the active step plus a
// circle + value bubble at the data point (when one exists at that step).
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
      ctx.fillStyle = opts.color ?? '#888'
      ctx.beginPath()
      ctx.arc(x, y, 4, 0, Math.PI * 2)
      ctx.fill()

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

function isPointActive(tags: string[], muted: Set<string>): boolean {
  if (tags.length === 0) return !muted.has(UNTAGGED_KEY)
  return tags.some(t => !muted.has(t))
}

export const LineMetric = memo(function LineMetric({
  entries,
  color,
  fill,
  inactiveTags,
  resetSignal,
}: {
  entries: MetricEntry[]
  color: string
  // When true, the chart claims its parent's height instead of locking
  // to the default 120px. Used by the grid-view card body so the chart
  // fills the card's remaining space.
  fill?: boolean
  // Tags currently muted via the chip row. The chart still draws every
  // emission (the line stays continuous across tag transitions) but
  // segments whose endpoints are all-muted are drawn in soft gray.
  inactiveTags?: Set<string>
  // Counter the parent increments to trigger `chart.resetZoom()`. The
  // reset button itself lives in the parent's chip row so it sits
  // outside the chart canvas.
  resetSignal?: number
}) {
  const tokens = useChartTokens()
  const timelineMode = useStore(s => s.timeline.mode)
  const timelineStep = useStore(s => s.timeline.step)
  const setTimelineMode = useStore(s => s.setTimelineMode)
  const setTimelineStep = useStore(s => s.setTimelineStep)
  const lineSmoothing = useStore(s => s.settings.lineSmoothing ?? 0)
  const chartRefBox = useRef<Chart<'line'> | null>(null)

  const isFiltering = timelineMode === 'step' && timelineStep != null

  // Build one combined dataset. Per-segment coloring (driven by each
  // endpoint's tag set) keeps the line continuous across tag
  // transitions — without this we previously split into one dataset per
  // tag, which left a visible gap whenever the tag changed mid-series.
  const { datasets, tagsByStep } = useMemo(() => {
    const sorted = [...entries].sort((a, b) => (a.step ?? 0) - (b.step ?? 0))
    const tagsByStep = new Map<number, string[]>()
    for (let i = 0; i < sorted.length; i++) {
      const e = sorted[i]
      const step = e.step ?? i
      tagsByStep.set(step, e.tags)
    }
    const data = smoothSeries(downsample(toLinePoints(sorted)), lineSmoothing)
    const muted = inactiveTags ?? new Set<string>()
    const segmentBorderColor = inactiveTags
      ? (ctx: ScriptableLineSegmentContext) => {
          const x0 = ctx.p0?.parsed?.x
          const x1 = ctx.p1?.parsed?.x
          const t0 = (x0 != null && tagsByStep.get(x0)) || []
          const t1 = (x1 != null && tagsByStep.get(x1)) || []
          // A segment renders gray only when BOTH endpoints are
          // fully-muted; otherwise the active tag wins, so muting one
          // tag doesn't bleed into adjacent segments belonging to
          // another.
          return isPointActive(t0, muted) || isPointActive(t1, muted)
            ? color
            : MUTED_COLOR
        }
      : undefined
    const dataset: ChartDataset<'line'> = {
      label: 'value',
      data,
      borderColor: color,
      borderWidth: 1.5,
      pointRadius: 0,
      pointHitRadius: 12,
      tension: 0.3,
      ...(segmentBorderColor
        ? { segment: { borderColor: segmentBorderColor } }
        : {}),
    }
    return { datasets: [dataset], tagsByStep }
  }, [entries, color, inactiveTags, lineSmoothing])
  void tagsByStep // referenced via the segment closure; keep it pinned to deps

  const handleClick = useCallback(
    (_evt: ChartEvent, elements: ActiveElement[], chart: Chart) => {
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
    const pluginOpts = {
      legend: { display: false },
      activeStepLine: {
        value: isFiltering ? timelineStep : null,
        color,
      },
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
        onClick: handleClick,
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
  }, [datasets, color, tokens.axisTickColor, tokens.gridStroke, handleClick, isFiltering, timelineStep])

  const { canvasRef, containerRef, chartRef } = useChartJs<'line'>({
    config,
    formatTooltip: (tooltip) => ({
      title: tooltip.dataPoints?.[0]
        ? `Step ${(tooltip.dataPoints[0].parsed as { x: number }).x}`
        : undefined,
      items: (tooltip.dataPoints ?? []).map((dp) => ({
        label: String((dp.dataset as { label?: string }).label ?? 'value'),
        value: (dp.parsed as { y: number }).y.toLocaleString(undefined, {
          maximumFractionDigits: 4,
        }),
        color: String((dp.dataset as { borderColor?: string }).borderColor ?? color),
      })),
    }),
    onChartReady: (chart) => {
      chartRefBox.current = chart
      return attachWheelHandler(chart, 'x')
    },
  })

  // Reset on parent's signal change. Skip the initial value (0) so the
  // chart isn't reset on every mount.
  const lastResetRef = useRef<number | undefined>(resetSignal)
  useEffect(() => {
    if (resetSignal === undefined) return
    if (lastResetRef.current === resetSignal) return
    lastResetRef.current = resetSignal
    const chart = (chartRef ?? chartRefBox).current as Chart<'line'> | null
    chart?.resetZoom()
  }, [resetSignal, chartRef])

  const hasData = datasets.some(d => d.data.length > 0)
  if (!hasData) return null

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
