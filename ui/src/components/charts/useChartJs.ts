import { useEffect, useRef } from 'react'
import {
  Chart,
  type ChartConfiguration,
  type ChartOptions,
  type ChartTypeRegistry,
  type TooltipModel,
} from 'chart.js'
import {
  setTooltip,
  type TooltipItem,
  type TooltipState,
} from './chartTooltipStore'

export interface UseChartJsParams<TType extends keyof ChartTypeRegistry> {
  config: ChartConfiguration<TType>
  // Optional formatter so each per-type component can shape title/items
  // (e.g. LineMetric prefixes "Step "; ComparisonLine swaps run-id for run name).
  // Receives Chart.js's tooltip model and returns the title + items the
  // singleton ChartTooltip will render.
  formatTooltip?: (
    model: TooltipModel<TType>,
  ) => Pick<TooltipState, 'title' | 'items'>
  // Runs once after the chart instance is constructed. Returned cleanup
  // (if any) runs at chart-destroy time. Used by LineMetric / ScatterMetric
  // to attach the trackpad-aware wheel handler from zoomBindings.ts.
  onChartReady?: (chart: Chart<TType>) => void | (() => void)
  // Effective devicePixelRatio for this chart. Chart.js consults
  // `options.devicePixelRatio` when sizing the canvas bitmap; changing
  // it requires a chart.resize() call (which we trigger on change).
  // Lets the canvas stay sharp when a parent CSS-transform (e.g. the
  // ReactFlow viewport zoom inside DAG nodes) magnifies the chart.
  dpr?: number
}

// Single hook that owns Chart.js lifecycle for a per-type chart component.
// Caller renders <div ref={containerRef}><canvas ref={canvasRef} /></div>.
export function useChartJs<TType extends keyof ChartTypeRegistry>(
  params: UseChartJsParams<TType>,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<Chart<TType> | null>(null)
  const idRef = useRef<string>(Math.random().toString(36).slice(2))
  // Keep the formatter in a ref so the externalCallback closure (set once at
  // mount) always sees the latest version without re-creating the chart.
  const formatRef = useRef(params.formatTooltip)
  formatRef.current = params.formatTooltip
  const onChartReadyRef = useRef(params.onChartReady)
  onChartReadyRef.current = params.onChartReady

  // Mount once. Two non-obvious things going on here:
  //
  // 1. We disable the canvas tooltip plugin's visual rendering (`enabled:
  //    false`) because we render via a body-portal instead.
  //
  // 2. We assign `tooltip.options.external` POST-construction, not via the
  //    config object. Chart.js 4.5's option resolver treats `external` as a
  //    scriptable option — when set in the config it gets called during
  //    resolution with a context that has no `tooltip` field, the function
  //    returns undefined, and that undefined is stored as the resolved
  //    value. Worse, with `external` undefined the Tooltip plugin's
  //    `_handleEvent` short-circuits without calling `update(true)`, so
  //    `tooltip.opacity` never rises from 0 and no hover state is tracked.
  //    Setting external on the already-resolved `chart.tooltip.options`
  //    sidesteps the resolver entirely.
  useEffect(() => {
    if (!canvasRef.current) return
    const chartId = idRef.current

    const initialConfig = params.config
    const cfgNoExternal: ChartConfiguration<TType> = {
      ...initialConfig,
      options: {
        ...initialConfig.options,
        plugins: {
          ...(initialConfig.options?.plugins ?? {}),
          tooltip: {
            ...(initialConfig.options?.plugins?.tooltip ?? {}),
            enabled: false,
          },
        },
      },
    } as ChartConfiguration<TType>

    chartRef.current = new Chart(canvasRef.current, cfgNoExternal)

    // Chart.js's internal initial resize measures the parent via
    // `getBoundingClientRect()` (see `getContainerSize` in chart.js's
    // helpers.dom), which INCLUDES ancestor CSS transforms. Inside a
    // ReactFlow viewport that has been zoomed, that returns post-transform
    // dimensions and the canvas is created at that bloated size, which
    // ReactFlow's own transform then scales again on screen. Pass
    // explicit layout-pixel dimensions (clientWidth/clientHeight ignore
    // transforms) so the canvas always matches its CSS-box size.
    if (containerRef.current) {
      chartRef.current.resize(
        containerRef.current.clientWidth,
        containerRef.current.clientHeight,
      )
    }

    const cleanup = onChartReadyRef.current?.(chartRef.current)

    return () => {
      if (typeof cleanup === 'function') cleanup()
      chartRef.current?.destroy()
      chartRef.current = null
      setTooltip(chartId, null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-apply data + options on every config change.
  // Animation is disabled globally (registerChartJs.ts), so update('none')
  // matches recharts' isAnimationActive={false}.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const chartId = idRef.current
    chart.data = params.config.data
    chart.options = {
      ...params.config.options,
      plugins: {
        ...(params.config.options?.plugins ?? {}),
        tooltip: {
          ...(params.config.options?.plugins?.tooltip ?? {}),
          enabled: false,
        },
      },
      ...(params.dpr !== undefined ? { devicePixelRatio: params.dpr } : {}),
    } as unknown as ChartOptions<TType>
    chart.update('none')

    // Re-apply external on the resolved tooltip options AFTER chart.update().
    // chart.update() rebuilds tooltip.options from the config (which doesn't
    // carry external — putting it there triggers Chart.js 4.5's scriptable
    // resolver, which calls our function during option-resolution, gets
    // undefined back, and stores that as the resolved value). Setting it
    // post-update bypasses that resolver entirely. Without an external
    // assigned, Chart.js's tooltip plugin's `_handleEvent` short-circuits
    // and never updates `opacity`, so no hover state is tracked at all.
    const tt = chart.tooltip
    if (tt) {
      ;(tt.options as { external?: unknown }).external = (ctx: {
        chart?: Chart
        tooltip?: TooltipModel<TType>
      }) => {
        const c = ctx?.chart
        const t = ctx?.tooltip
        if (!c || !t) return
        if (t.opacity === 0) {
          setTooltip(chartId, null)
          return
        }
        const rect = c.canvas.getBoundingClientRect()
        const fmt = formatRef.current
          ? formatRef.current(t)
          : defaultFormat(t)
        setTooltip(chartId, {
          active: true,
          anchor: {
            x: rect.left + t.caretX,
            y: rect.top + t.caretY,
          },
          title: fmt.title,
          items: fmt.items,
        })
      }
    }
  })

  // Chart.js reads devicePixelRatio at resize time, so changing the prop
  // alone won't re-allocate the canvas bitmap. Track the last applied
  // DPR and force a resize when it shifts so charts inside CSS-scaled
  // ancestors (e.g. ReactFlow's zoomed viewport) stay sharp.
  //
  // Pass explicit CSS-pixel dimensions read from the container's
  // clientWidth/clientHeight — `chart.resize()` with no args falls
  // through Chart.js's `getContainerSize`, which measures the parent
  // via `getBoundingClientRect()` and therefore includes ReactFlow's
  // CSS transform. The result is a canvas whose CSS size grows with
  // viewport zoom, which the transform then scales again on top of —
  // making the chart visually expand on every zoom step.
  const lastDprRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    const chart = chartRef.current
    const container = containerRef.current
    if (!chart || !container || params.dpr === undefined) return
    if (lastDprRef.current === params.dpr) return
    lastDprRef.current = params.dpr
    chart.resize(container.clientWidth, container.clientHeight)
  }, [params.dpr])

  // No manual ResizeObserver here. With `responsive: true` (Chart.js's
  // default after we stopped overriding it) the chart watches its parent
  // and writes correct inline width/height onto the canvas. Doing it
  // ourselves on top would race Chart.js's own observer and (importantly)
  // pin the canvas to its bitmap-intrinsic size when responsive is off,
  // which causes the parent to grow to fit the canvas — the bug behind
  // the indefinite horizontal expansion of metric-bearing DAG nodes.

  return { canvasRef, containerRef, chartRef }
}

function defaultFormat<TType extends keyof ChartTypeRegistry>(
  tooltip: TooltipModel<TType>,
): Pick<TooltipState, 'title' | 'items'> {
  const items: TooltipItem[] = (tooltip.dataPoints ?? []).map((dp) => {
    const parsed = dp.parsed as unknown
    const yVal =
      parsed && typeof parsed === 'object' && 'y' in parsed
        ? (parsed as { y: unknown }).y
        : undefined
    const value =
      typeof yVal === 'number'
        ? yVal.toLocaleString(undefined, { maximumFractionDigits: 4 })
        : String(dp.formattedValue ?? '')
    const ds = dp.dataset as { label?: string; borderColor?: string; backgroundColor?: string }
    return {
      label: String(ds.label ?? ''),
      value,
      color: ds.borderColor ?? ds.backgroundColor ?? '#888',
    }
  })
  return {
    title: tooltip.title?.[0],
    items,
  }
}
