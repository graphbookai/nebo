// EMA smoothing helpers shared by single-run and comparison chart components.
//   s_i = α * s_{i-1} + (1 - α) * x_i
// `alpha` ∈ [0, 1]; 0 = no smoothing, → 1 = heavy smoothing.

export function emaSmooth(values: number[], alpha: number): number[] {
  if (alpha <= 0 || values.length === 0) return values
  const out = new Array<number>(values.length)
  let prev = values[0]
  out[0] = prev
  for (let i = 1; i < values.length; i++) {
    const v = alpha * prev + (1 - alpha) * values[i]
    out[i] = v
    prev = v
  }
  return out
}

export interface XYPoint {
  x: number
  y: number
}

export function smoothLinePoints(points: XYPoint[], alpha: number): XYPoint[] {
  if (alpha <= 0 || points.length === 0) return points
  const ys = emaSmooth(points.map((p) => p.y), alpha)
  return points.map((p, i) => ({ x: p.x, y: ys[i] }))
}
