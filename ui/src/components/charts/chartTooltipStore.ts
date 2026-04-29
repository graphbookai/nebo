export interface TooltipItem {
  label: string
  value: string
  color: string
}

export interface TooltipState {
  active: boolean
  anchor: { x: number; y: number } | null
  title?: string
  items: TooltipItem[]
}

let state: TooltipState | null = null
let activeChartId: string | null = null
const listeners = new Set<() => void>()

// Singleton: only one chart's tooltip renders at a time. When a different
// chart fires `external`, it claims activeChartId. When the active chart
// fires with opacity=0 (mouse leave), state clears.
export function setTooltip(chartId: string, next: TooltipState | null): void {
  if (next === null) {
    if (activeChartId !== chartId) return
    activeChartId = null
    state = null
    for (const cb of listeners) cb()
    return
  }
  activeChartId = chartId
  state = next
  for (const cb of listeners) cb()
}

export function getTooltip(): TooltipState | null {
  return state
}

export function subscribeTooltip(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
