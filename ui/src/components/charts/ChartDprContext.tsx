import { createContext, useContext } from 'react'

// Multiplier on top of window.devicePixelRatio for any Chart.js canvas
// inside this subtree. NeboNode sets it to the live ReactFlow viewport
// zoom so canvas bitmaps stay sharp as the user zooms the DAG. Outside
// any provider the default of 1 means "just use base DPR".
export const ChartDprContext = createContext<number>(1)

const MAX_DPR = 4

// Resolve the effective Chart.js `devicePixelRatio` for the current
// chart instance. Floors at base DPR so we never downsample below the
// browser's native pixel density, and caps the upper bound to keep
// canvas bitmap allocations sane on low-RAM clients.
export function useChartDpr(): number {
  const zoom = useContext(ChartDprContext)
  const base = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
  const effective = base * Math.max(1, zoom)
  return Math.min(MAX_DPR, effective)
}
