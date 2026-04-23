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

