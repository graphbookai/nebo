// Compact, human-friendly numeric tick formatter shared across charts.
// The default Chart.js formatter happily prints values like
// `0.13456789012`, which dominates the small fonts on metric charts.
// This helper rounds to a reasonable precision and falls back to
// scientific notation only at the extremes.
//
//   integers (|v| < 1e6)        → `1,234`           (locale grouping)
//   floats   (1e-3 ≤ |v| < 1e6) → `0.123`           (≤ 4 sig figs)
//   extremes (|v| ≥ 1e6 or < 1e-3, v ≠ 0) → `1.23e+6`
//   exactly zero                → `0`

export function formatTick(value: number | string | null | undefined): string {
  if (value == null) return ''
  const v = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(v)) return ''
  if (v === 0) return '0'
  const abs = Math.abs(v)
  if (Number.isInteger(v) && abs < 1e6) {
    return v.toLocaleString()
  }
  if (abs >= 1e6 || abs < 1e-3) {
    return v.toExponential(2)
  }
  // toPrecision rounds to 4 significant figures; Number(...) trims
  // any trailing zeros (e.g. "0.1230" → "0.123").
  return Number(v.toPrecision(4)).toString()
}
