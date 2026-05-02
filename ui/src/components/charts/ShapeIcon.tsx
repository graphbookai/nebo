import type { ScatterShape } from './scatterShape'

// Renders a small SVG glyph that mirrors Chart.js's native pointStyle shapes.
// Used in the scatter label chips so the glyph in the chip is identical to
// the points drawn on the chart.
export function ShapeIcon({
  shape,
  color,
  size = 12,
}: {
  shape: ScatterShape
  color: string
  size?: number
}) {
  const h = size / 2
  const r = h * 0.8

  // Each case draws a path or primitive that matches Chart.js's own
  // pointStyle rendering at small sizes.
  const glyph = (() => {
    switch (shape) {
      case 'circle':
        return <circle cx={h} cy={h} r={r} fill={color} />

      case 'rect': {
        const s = r * 1.5
        return <rect x={h - s / 2} y={h - s / 2} width={s} height={s} fill={color} />
      }

      case 'rectRot': {
        // Rotated 45° square (diamond)
        const s = r * 1.0
        return (
          <rect
            x={h - s / 2}
            y={h - s / 2}
            width={s}
            height={s}
            fill={color}
            transform={`rotate(45 ${h} ${h})`}
          />
        )
      }

      case 'triangle': {
        const s = r * 1.7
        const x0 = h
        const y0 = h - s / 2
        const x1 = h - s / 2
        const y1 = h + s / 2
        const x2 = h + s / 2
        const y2 = h + s / 2
        return <polygon points={`${x0},${y0} ${x1},${y1} ${x2},${y2}`} fill={color} />
      }

      case 'star': {
        // 5-pointed star using a polygon of 10 points
        const outerR = r * 1.0
        const innerR = r * 0.4
        const points: string[] = []
        for (let i = 0; i < 10; i++) {
          const angle = (Math.PI / 5) * i - Math.PI / 2
          const rr = i % 2 === 0 ? outerR : innerR
          points.push(`${h + rr * Math.cos(angle)},${h + rr * Math.sin(angle)}`)
        }
        return <polygon points={points.join(' ')} fill={color} />
      }

      case 'crossRot': {
        // Rotated cross (X shape) — two thin rotated bars
        const arm = r * 1.0
        const w = r * 0.25
        return (
          <g fill={color}>
            <rect
              x={h - w / 2}
              y={h - arm}
              width={w}
              height={arm * 2}
              transform={`rotate(45 ${h} ${h})`}
            />
            <rect
              x={h - w / 2}
              y={h - arm}
              width={w}
              height={arm * 2}
              transform={`rotate(-45 ${h} ${h})`}
            />
          </g>
        )
      }

      case 'rectRounded': {
        // Rounded rectangle
        const s = r * 1.5
        const rx = s * 0.25
        return (
          <rect x={h - s / 2} y={h - s / 2} width={s} height={s} rx={rx} ry={rx} fill={color} />
        )
      }

      default:
        return <circle cx={h} cy={h} r={r} fill={color} />
    }
  })()

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ flexShrink: 0 }}
      aria-hidden="true"
    >
      {glyph}
    </svg>
  )
}
