import { createPortal } from 'react-dom'
import { useSyncExternalStore, type CSSProperties } from 'react'
import { getTooltip, subscribeTooltip } from './chartTooltipStore'
import { useChartTokens } from './useChartTokens'

// Renders the singleton tooltip via portal to document.body so it never
// participates in any ancestor's scroll bounds. Mounted once at app root.
export function ChartTooltip() {
  const state = useSyncExternalStore(subscribeTooltip, getTooltip, () => null)
  const tokens = useChartTokens()

  if (!state || !state.active || !state.anchor || state.items.length === 0) {
    return null
  }

  const cardStyle: CSSProperties = {
    position: 'fixed',
    left: state.anchor.x + 12,
    top: state.anchor.y + 12,
    pointerEvents: 'none',
    zIndex: 9999,
    padding: '6px 8px',
    backgroundColor: tokens.tooltipBg,
    border: `1px solid ${tokens.tooltipBorder}`,
    borderRadius: 6,
    fontSize: 11,
    color: tokens.tooltipFg,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
  }

  const fg: CSSProperties = { color: tokens.tooltipFg }

  const node = (
    <div style={cardStyle}>
      {state.title && (
        <div style={{ ...fg, fontWeight: 500, marginBottom: 2 }}>{state.title}</div>
      )}
      {state.items.map((item, i) => (
        <div
          key={i}
          style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: item.color,
              flexShrink: 0,
            }}
          />
          <span style={fg}>{item.label}:</span>
          <span style={{ ...fg, fontWeight: 500 }}>{item.value}</span>
        </div>
      ))}
    </div>
  )

  return createPortal(node, document.body)
}
