import type { ScatterShape } from './scatterShape'

const SIZE = 10

// Builds the SVG points for a 5-pointed star centered at (cx, cy).
function starPoints(cx: number, cy: number, outerR: number, innerR: number): string {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI / 5) * i - Math.PI / 2
    const r = i % 2 === 0 ? outerR : innerR
    pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`)
  }
  return pts.join(' ')
}

// Small SVG glyph that mirrors the shape recharts assigns to a scatter
// series. Used on tag chips so users can see which shape each tag owns.
export function ShapeIcon({ shape, color }: { shape: ScatterShape; color: string }) {
  const cx = SIZE / 2
  const cy = SIZE / 2
  const common = {
    width: SIZE,
    height: SIZE,
    viewBox: `0 0 ${SIZE} ${SIZE}`,
    style: { flexShrink: 0 as const },
    'aria-hidden': true,
  }
  const strokeProps = { stroke: color, strokeWidth: 1.5, fill: 'none' as const, strokeLinecap: 'round' as const }

  switch (shape) {
    case 'circle':
      return (
        <svg {...common}>
          <circle cx={cx} cy={cy} r={3} fill={color} />
        </svg>
      )
    case 'square':
      return (
        <svg {...common}>
          <rect x={2} y={2} width={SIZE - 4} height={SIZE - 4} fill={color} />
        </svg>
      )
    case 'diamond':
      return (
        <svg {...common}>
          <polygon
            points={`${cx},1 ${SIZE - 1},${cy} ${cx},${SIZE - 1} 1,${cy}`}
            fill={color}
          />
        </svg>
      )
    case 'triangle':
      return (
        <svg {...common}>
          <polygon points={`${cx},1 ${SIZE - 1},${SIZE - 1} 1,${SIZE - 1}`} fill={color} />
        </svg>
      )
    case 'cross':
      return (
        <svg {...common}>
          <path d={`M2,2 L${SIZE - 2},${SIZE - 2} M2,${SIZE - 2} L${SIZE - 2},2`} {...strokeProps} />
        </svg>
      )
    case 'star':
      return (
        <svg {...common}>
          <polygon points={starPoints(cx, cy, 4, 1.8)} fill={color} />
        </svg>
      )
    case 'wye':
      return (
        <svg {...common}>
          <path
            d={`M${cx},${SIZE - 1} L${cx},${cy} M${cx},${cy} L2,2 M${cx},${cy} L${SIZE - 2},2`}
            {...strokeProps}
          />
        </svg>
      )
  }
}
