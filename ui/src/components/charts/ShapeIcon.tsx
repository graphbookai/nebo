import { Symbols } from 'recharts'
import type { ScatterShape } from './scatterShape'

// Re-uses recharts' own `<Symbols>` renderer (which delegates to d3-shape's
// symbolCircle/Square/Diamond/…) so the chip's glyph is pixel-identical to
// the points the scatter chart draws.
export function ShapeIcon({
  shape,
  color,
  size = 12,
  fillArea = 48,
}: {
  shape: ScatterShape
  color: string
  size?: number
  // Area in px² passed to d3's symbol generator. 64 matches recharts' own
  // default; 48 reads well at the small chip size.
  fillArea?: number
}) {
  // 1px padding on each side so star spikes / plus arms don't clip.
  const half = size / 2 + 1
  const box = size + 2
  return (
    <svg
      width={size}
      height={size}
      viewBox={`${-half} ${-half} ${box} ${box}`}
      style={{ flexShrink: 0 }}
      aria-hidden="true"
    >
      <Symbols type={shape} cx={0} cy={0} size={fillArea} fill={color} />
    </svg>
  )
}
