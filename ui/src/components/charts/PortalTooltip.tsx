import { createPortal } from 'react-dom'
import { useEffect, useState, type CSSProperties } from 'react'
import { chartTooltipContent, chartTooltipLabel } from './chartStyles'

// Recharts tooltips render inside the chart's container by default. Inside a
// scrollable card that clips overflow, the floating tooltip contributes to the
// parent's scroll bounds and can trigger scrollbars. Rendering via a portal to
// `document.body` keeps the tooltip outside any scroll ancestor, so the card's
// overflow only reflects the content the user actually wants to scroll.

interface Payload {
  name?: string | number
  dataKey?: string | number
  value?: unknown
  color?: string
  stroke?: string
  fill?: string
  payload?: Record<string, unknown>
}

type FormatterResult = [unknown, unknown] | unknown

interface Props {
  active?: boolean
  payload?: Payload[]
  label?: string | number
  formatter?: (
    value: unknown,
    name: string | number | undefined,
    item: Payload,
    index: number,
    payload: Payload[],
  ) => FormatterResult
  labelFormatter?: (label: string | number | undefined, payload?: Payload[]) => unknown
}

const valueText = (v: unknown): string => {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v.toLocaleString(undefined, { maximumFractionDigits: 4 })
  }
  return v == null ? '' : String(v)
}

export function PortalTooltip(props: Props) {
  const { active, payload, label, formatter, labelFormatter } = props
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    function onMove(e: MouseEvent) {
      setMouse({ x: e.clientX, y: e.clientY })
    }
    window.addEventListener('mousemove', onMove, { passive: true })
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  if (!active || !payload || payload.length === 0 || !mouse) return null

  const style: CSSProperties = {
    position: 'fixed',
    left: mouse.x + 12,
    top: mouse.y + 12,
    pointerEvents: 'none',
    zIndex: 9999,
    padding: '6px 8px',
    ...chartTooltipContent,
  }

  const fg: CSSProperties = { color: 'var(--color-popover-foreground)' }

  const node = (
    <div style={style}>
      {label !== undefined && label !== '' && labelFormatter && (
        <div style={{ ...chartTooltipLabel, marginBottom: 2 }}>
          {labelFormatter(label, payload) as React.ReactNode}
        </div>
      )}
      {label !== undefined && label !== '' && !labelFormatter && (
        <div style={{ ...chartTooltipLabel, marginBottom: 2 }}>{String(label)}</div>
      )}
      {payload.map((p, i) => {
        const formatted = formatter
          ? formatter(p.value, p.name ?? p.dataKey, p, i, payload)
          : undefined
        let val: unknown = p.value
        let name: unknown = p.name ?? p.dataKey ?? ''
        if (Array.isArray(formatted) && formatted.length === 2) {
          val = formatted[0]
          name = formatted[1]
        } else if (formatted !== undefined) {
          val = formatted
        }
        const dot = p.color || p.stroke || p.fill
        return (
          <div
            key={i}
            style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
          >
            {dot && (
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: dot as string,
                  flexShrink: 0,
                }}
              />
            )}
            <span style={fg}>{valueText(name)}:</span>
            <span style={{ ...fg, fontWeight: 500 }}>{valueText(val)}</span>
          </div>
        )
      })}
    </div>
  )

  return createPortal(node, document.body)
}
