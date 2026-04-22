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
