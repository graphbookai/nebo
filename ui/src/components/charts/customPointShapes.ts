import type { Plugin, ChartDataset } from 'chart.js'

// Chart.js's native pointStyle has two stroke-only shapes in our rotation
// (`star`, `crossRot`) that mismatch the filled glyphs the chip row renders
// via ShapeIcon. This plugin draws those two shapes as filled paths
// matching ShapeIcon's geometry, so the chip and the on-chart points stay
// 1:1. Datasets opt in by setting `_neboShape: 'star' | 'crossRot'`; the
// dataset also sets `pointStyle: false` so Chart.js itself skips the
// native draw and we don't double-render.

export type CustomShape = 'star' | 'crossRot' | 'cross'

type CustomShapeDataset = { _neboShape?: CustomShape }

function readPerPoint<T>(value: T | T[] | undefined, i: number, fallback: T): T {
  if (Array.isArray(value)) return (value[i] ?? fallback) as T
  return (value ?? fallback) as T
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  fill: string,
  stroke: string,
  lineWidth: number,
): void {
  // Mirrors ShapeIcon's "star" branch: outerR = radius, innerR = radius * 0.4.
  const outer = radius
  const inner = radius * 0.4
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI / 5) * i - Math.PI / 2
    const rr = i % 2 === 0 ? outer : inner
    const px = x + rr * Math.cos(angle)
    const py = y + rr * Math.sin(angle)
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  if (lineWidth > 0 && stroke) {
    ctx.lineWidth = lineWidth
    ctx.strokeStyle = stroke
    ctx.stroke()
  }
}

function drawCrossRot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  fill: string,
  stroke: string,
  lineWidth: number,
): void {
  // Mirrors ShapeIcon's "crossRot" branch: arm = radius, width = radius * 0.25.
  const arm = radius
  const w = radius * 0.25
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = fill
  ctx.rotate(Math.PI / 4)
  ctx.fillRect(-w / 2, -arm, w, arm * 2)
  ctx.rotate(-Math.PI / 2)
  ctx.fillRect(-w / 2, -arm, w, arm * 2)
  ctx.restore()
  if (lineWidth > 0 && stroke) {
    // Re-trace the bars as a stroked outline so the per-point border weight
    // still reads on these custom shapes.
    ctx.save()
    ctx.translate(x, y)
    ctx.strokeStyle = stroke
    ctx.lineWidth = lineWidth
    ctx.rotate(Math.PI / 4)
    ctx.strokeRect(-w / 2, -arm, w, arm * 2)
    ctx.rotate(-Math.PI / 2)
    ctx.strokeRect(-w / 2, -arm, w, arm * 2)
    ctx.restore()
  }
}

function drawCross(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  fill: string,
  stroke: string,
  lineWidth: number,
): void {
  // Axis-aligned plus sign — same arm/width ratio as crossRot but no rotation.
  const arm = radius
  const w = radius * 0.25
  ctx.fillStyle = fill
  ctx.fillRect(x - w / 2, y - arm, w, arm * 2)
  ctx.fillRect(x - arm, y - w / 2, arm * 2, w)
  if (lineWidth > 0 && stroke) {
    ctx.strokeStyle = stroke
    ctx.lineWidth = lineWidth
    ctx.strokeRect(x - w / 2, y - arm, w, arm * 2)
    ctx.strokeRect(x - arm, y - w / 2, arm * 2, w)
  }
}

export const customPointShapesPlugin: Plugin = {
  id: 'customPointShapes',
  afterDatasetsDraw(chart) {
    const ctx = chart.ctx
    for (let di = 0; di < chart.data.datasets.length; di++) {
      const ds = chart.data.datasets[di] as ChartDataset & CustomShapeDataset
      const shape = ds._neboShape
      if (!shape) continue
      const meta = chart.getDatasetMeta(di)
      if (!meta) continue
      const elems = meta.data as { x: number; y: number; skip?: boolean }[]
      const bgs = (ds as { backgroundColor?: string | string[] }).backgroundColor
      const radii = (ds as { pointRadius?: number | number[] }).pointRadius
      const borderColors = (ds as { borderColor?: string | string[] }).borderColor
      const borderWidths = (ds as { borderWidth?: number | number[] }).borderWidth
      for (let i = 0; i < elems.length; i++) {
        const el = elems[i]
        if (!el || el.skip) continue
        const radius = Number(readPerPoint(radii, i, 4)) || 0
        if (radius <= 0) continue
        const fill = readPerPoint(bgs, i, '#000') as string
        const stroke = readPerPoint(borderColors, i, '#000') as string
        const lw = Number(readPerPoint(borderWidths, i, 0)) || 0
        if (shape === 'star') drawStar(ctx, el.x, el.y, radius, fill, stroke, lw)
        else if (shape === 'crossRot') drawCrossRot(ctx, el.x, el.y, radius, fill, stroke, lw)
        else drawCross(ctx, el.x, el.y, radius, fill, stroke, lw)
      }
    }
  },
}
