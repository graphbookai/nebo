import { useSyncExternalStore } from 'react'

const TOKEN_NAMES = [
  '--color-muted-foreground',
  '--color-border',
  '--color-popover',
  '--color-popover-foreground',
] as const

type TokenName = (typeof TOKEN_NAMES)[number]
type Tokens = Record<TokenName, string>

let cached: Tokens | null = null
const listeners = new Set<() => void>()
let observerAttached = false

function resolve(): Tokens {
  const cs = getComputedStyle(document.documentElement)
  const out = {} as Tokens
  for (const name of TOKEN_NAMES) {
    out[name] = cs.getPropertyValue(name).trim()
  }
  return out
}

function ensureObserver(): void {
  if (observerAttached) return
  observerAttached = true
  // The codebase toggles `dark` on document.documentElement (see store/index.ts).
  // Re-resolve tokens on that class change so charts re-color without remount.
  const observer = new MutationObserver(() => {
    cached = resolve()
    for (const cb of listeners) cb()
  })
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  })
}

function get(): Tokens {
  if (cached === null) cached = resolve()
  return cached
}

function subscribe(cb: () => void): () => void {
  ensureObserver()
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export interface ChartTokens {
  axisTickColor: string
  gridStroke: string
  tooltipBg: string
  tooltipBorder: string
  tooltipFg: string
}

export function useChartTokens(): ChartTokens {
  const t = useSyncExternalStore(subscribe, get, get)
  return {
    axisTickColor: t['--color-muted-foreground'],
    gridStroke: t['--color-border'],
    tooltipBg: t['--color-popover'],
    tooltipBorder: t['--color-border'],
    tooltipFg: t['--color-popover-foreground'],
  }
}
