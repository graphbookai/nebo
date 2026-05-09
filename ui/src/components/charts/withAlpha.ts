// Apply an alpha to a `#rgb` / `#rrggbb` hex string. Returns the input
// unchanged when it isn't a recognized hex (e.g. already an `rgba(...)`,
// a CSS named color, or any other format we shouldn't try to parse).
//
// Used to dim non-active points on scatter charts (single-run +
// comparison) and to fill histogram-area series at the same opacity
// recharts' AreaChart used.
export function withAlpha(hex: string, alpha: number): string {
  const trimmed = hex.trim()
  if (!trimmed.startsWith('#') || (trimmed.length !== 4 && trimmed.length !== 7)) {
    return trimmed
  }
  const expanded =
    trimmed.length === 4
      ? `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`
      : trimmed
  const r = parseInt(expanded.slice(1, 3), 16)
  const g = parseInt(expanded.slice(3, 5), 16)
  const b = parseInt(expanded.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
