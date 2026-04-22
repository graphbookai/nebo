// Theme-aware styling for recharts components. Values reference Tailwind's CSS
// variables (set from `src/styles/*.css` and toggled by the `dark` class on
// `<html>`), so the charts follow the user's light/dark preference.

export const chartAxisTick = {
  fontSize: 10,
  fill: 'var(--color-muted-foreground)',
}

export const chartGridStroke = 'var(--color-border)'

export const chartTooltipContent: React.CSSProperties = {
  backgroundColor: 'var(--color-popover)',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  fontSize: 11,
  color: 'var(--color-popover-foreground)',
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
}

export const chartTooltipLabel: React.CSSProperties = {
  color: 'var(--color-popover-foreground)',
  fontWeight: 500,
}

// Float tooltips above nearby cards and escape their chart viewBox so they
// remain visible when a point is near the edge of the plot area.
export const chartTooltipWrapper: React.CSSProperties = {
  zIndex: 50,
  outline: 'none',
}

export const chartTooltipAllowEscape = { x: true, y: true }

// Cursor shown under the pointer. For bar/histogram-style charts the cursor
// is a filled rectangle behind the hovered datum — use a subtle muted fill so
// it reads on both light and dark themes.
export const chartBarCursor = { fill: 'var(--color-muted-foreground)', fillOpacity: 0.12 }
export const chartScatterCursor = {
  strokeDasharray: '3 3',
  stroke: 'var(--color-muted-foreground)',
  strokeOpacity: 0.4,
}

// Hidden recharts wrapper — we render via portal, so the in-place wrapper
// must not contribute to the ancestor's scroll bounds.
export const chartHiddenWrapper = { display: 'none' as const }

// Shared palette for multi-series charts (stacked bars, overlaid histograms,
// pie slices). Ordered so the earliest entries are maximally distinguishable;
// later entries fill out the space for long-tail series.
export const METRIC_COLORS = [
  '#3b82f6', // blue-500
  '#f59e0b', // amber-500
  '#10b981', // emerald-500
  '#ef4444', // red-500
  '#8b5cf6', // violet-500
  '#06b6d4', // cyan-500
  '#ec4899', // pink-500
  '#84cc16', // lime-500
  '#f97316', // orange-500
  '#14b8a6', // teal-500
  '#6366f1', // indigo-500
  '#a855f7', // purple-500
]
