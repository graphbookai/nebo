import { createContext, useContext } from 'react'

// Multiplier on top of window.devicePixelRatio for any Chart.js canvas
// inside this subtree. NeboNode sets it to the live ReactFlow viewport
// zoom so canvas bitmaps stay sharp as the user zooms the DAG. Outside
// any provider the default of 1 means "just use base DPR".
export const ChartDprContext = createContext<number>(1)

// Cap canvas bitmap size on low-RAM clients; 4× retina already pushes
// a 360×120 chart to 2880×960 pixels, which is plenty.
const MAX_DPR = 4
// Quantize the effective DPR so RAF-throttled pinch-zoom frames (which
// emit continuous zoom values) don't cascade chart.resize() calls into
// every visible chart on every frame. 0.5 is fine enough that bitmap
// sharpness is indistinguishable.
const DPR_STEP = 0.5

export function useChartDpr(): number {
  const zoom = useContext(ChartDprContext)
  const base = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
  const effective = Math.min(MAX_DPR, base * Math.max(1, zoom))
  return Math.round(effective / DPR_STEP) * DPR_STEP
}
