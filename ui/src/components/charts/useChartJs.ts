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

  // Mount once: create the Chart instance with the wired-in external tooltip.
  useEffect(() => {
    if (!canvasRef.current) return
    const chartId = idRef.current
    const initialConfig = params.config
    const externalCfg: ChartConfiguration<TType> = {
      ...initialConfig,
      options: {
        ...initialConfig.options,
        plugins: {
          ...(initialConfig.options?.plugins ?? {}),
          tooltip: {
            ...(initialConfig.options?.plugins?.tooltip ?? {}),
            enabled: false,
            // Chart.js 4.5 resolves option values through a scriptable
            // pipeline that occasionally invokes this callback with a
            // context that lacks the `tooltip` field (the scriptable code
            // path predates the afterEvent path). Bail early in that case
            // — the real call from the tooltip plugin's afterEvent always
            // carries both fields.
            external: (ctx: {
              chart?: Chart<TType>
              tooltip?: TooltipModel<TType>
            }) => {
              const chart = ctx?.chart
              const tooltip = ctx?.tooltip
              if (!chart || !tooltip) return
              if (tooltip.opacity === 0) {
                setTooltip(chartId, null)
                return
              }
              const rect = chart.canvas.getBoundingClientRect()
              const fmt = formatRef.current
                ? formatRef.current(tooltip)
                : defaultFormat(tooltip)
              setTooltip(chartId, {
                active: true,
                anchor: {
                  x: rect.left + tooltip.caretX,
                  y: rect.top + tooltip.caretY,
                },
                title: fmt.title,
                items: fmt.items,
              })
            },
          },
        },
      },
    } as ChartConfiguration<TType>

    chartRef.current = new Chart(canvasRef.current, externalCfg)

    return () => {
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
    chart.data = params.config.data
    // Preserve our wired-in external tooltip plugin while updating other options.
    const wiredTooltip = chart.options?.plugins?.tooltip
    chart.options = {
      ...params.config.options,
      plugins: {
        ...(params.config.options?.plugins ?? {}),
        tooltip: wiredTooltip,
      },
    } as unknown as ChartOptions<TType>
    chart.update('none')
  })

  // ResizeObserver replaces recharts' ResponsiveContainer.
  useEffect(() => {
    const container = containerRef.current
    const chart = chartRef.current
    if (!container || !chart) return
    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(container)
    return () => ro.disconnect()
  }, [])

  return { canvasRef, containerRef }
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
