import type { Chart, ChartTypeRegistry } from 'chart.js'

// Shared zoom/pan configuration for line and scatter charts.
//
// Interaction model:
//   left click                       → onClick (set timeline step)
//   left drag                        → bubbles to ReactFlow (node drag)
//   middle-mouse drag                → pan the chart
//   mouse wheel                      → zoom (chartjs-plugin-zoom)
//   trackpad pinch                   → zoom (wheel + ctrlKey)
//   trackpad two-finger drag         → pan (custom wheel handler below)
//
// chartjs-plugin-zoom's built-in pan in v2 has internal gating
// (button filters, threshold timing, pointerdown capture races) that
// proved unreliable for non-primary buttons inside a ReactFlow node
// and inside scrollable grid cards. We disable the plugin's pan
// (`pan.enabled: false`) and drive panning ourselves from native
// pointer events against `chart.pan()`. The plugin still owns wheel
// + pinch zoom, the `chart.pan` / `chart.zoom` / `chart.resetZoom`
// methods, and the `limits: original` clamp.
//
// React Flow opt-outs (`nowheel`, `nopan` on the chart wrapper in
// NeboNode) keep the wheel and viewport-pan handlers off the DAG
// viewport, while letting the events flow naturally to the chart's
// own listeners.

type ZoomMode = 'x' | 'xy'

export function buildZoomOptions(mode: ZoomMode) {
  const axisLimit = { min: 'original' as const, max: 'original' as const }
  return {
    pan: {
      // We drive pan ourselves via attachWheelHandler — see the
      // comment block above for why.
      enabled: false,
      mode,
    },
    zoom: {
      wheel: { enabled: true },
      pinch: { enabled: true },
      // Drag-rectangle-to-zoom would conflict with click-to-step. Off.
      drag: { enabled: false },
      mode,
    },
    limits: {
      x: axisLimit,
      y: axisLimit,
    },
  } as const
}

type ChartWithPan = { pan: (delta: { x: number; y: number }) => void }

/**
 * Wire up the chart-canvas listeners that drive pan + the
 * trackpad-two-finger fallback:
 *
 * 1. Capture-phase `wheel` handler — routes trackpad two-finger drags
 *    to `chart.pan()` instead of the plugin's zoom. Heuristic:
 *      - ctrlKey === true             → trackpad pinch (let plugin zoom)
 *      - integer deltaY, deltaX === 0 → mouse wheel   (let plugin zoom)
 *      - anything else                → trackpad scroll (pan via us)
 *
 * 2. `mousedown` preventDefault on the middle button — suppresses the
 *    browser's middle-click autoscroll cursor, which would otherwise
 *    lock the nearest scrollable ancestor (in grid view: the card
 *    body's `overflow-auto`) and swallow every subsequent move event.
 *
 * 3. `pointerdown` / `pointermove` / `pointerup` — implements
 *    middle-mouse drag-to-pan ourselves by calling `chart.pan()`
 *    directly. This sidesteps chartjs-plugin-zoom's built-in pan,
 *    which proved unreliable for non-primary buttons inside React
 *    Flow + scrollable grid cards. `setPointerCapture` keeps the
 *    drag attached to the canvas even when the cursor leaves the
 *    chart bounds.
 *
 * Returns a teardown that removes every listener.
 */
export function attachWheelHandler<T extends keyof ChartTypeRegistry>(
  chart: Chart<T>,
  mode: ZoomMode,
): () => void {
  const canvas = chart.canvas
  const chartWithPan = chart as unknown as ChartWithPan

  const wheelHandler = (event: WheelEvent) => {
    if (event.ctrlKey) return
    if (event.deltaX === 0 && Number.isInteger(event.deltaY)) return

    // Trackpad two-finger drag → pan. Swallow before the plugin sees it.
    event.preventDefault()
    event.stopImmediatePropagation()

    const dx = -event.deltaX
    const dy = mode === 'xy' ? -event.deltaY : 0
    if (dx !== 0 || dy !== 0) {
      chartWithPan.pan({ x: dx, y: dy })
    }
  }

  const mouseDownHandler = (event: MouseEvent) => {
    if (event.button === 1) {
      event.preventDefault()
    }
  }

  // Middle-mouse drag → pan, driven directly off pointer events.
  let panning = false
  let lastX = 0
  let lastY = 0
  let activePointerId: number | null = null

  const pointerDown = (event: PointerEvent) => {
    if (event.button !== 1) return
    event.preventDefault()
    panning = true
    lastX = event.clientX
    lastY = event.clientY
    activePointerId = event.pointerId
    try {
      canvas.setPointerCapture(event.pointerId)
    } catch { /* some browsers refuse capture mid-event; harmless */ }
  }

  const pointerMove = (event: PointerEvent) => {
    if (!panning || event.pointerId !== activePointerId) return
    const dx = event.clientX - lastX
    const dy = mode === 'xy' ? event.clientY - lastY : 0
    lastX = event.clientX
    lastY = event.clientY
    if (dx !== 0 || dy !== 0) {
      chartWithPan.pan({ x: dx, y: dy })
    }
  }

  const endPan = (event: PointerEvent) => {
    if (!panning || (activePointerId !== null && event.pointerId !== activePointerId)) return
    panning = false
    try {
      if (activePointerId !== null) canvas.releasePointerCapture(activePointerId)
    } catch { /* ignore */ }
    activePointerId = null
  }

  canvas.addEventListener('wheel', wheelHandler, { capture: true, passive: false })
  canvas.addEventListener('mousedown', mouseDownHandler)
  canvas.addEventListener('pointerdown', pointerDown)
  canvas.addEventListener('pointermove', pointerMove)
  canvas.addEventListener('pointerup', endPan)
  canvas.addEventListener('pointercancel', endPan)
  return () => {
    canvas.removeEventListener('wheel', wheelHandler, { capture: true })
    canvas.removeEventListener('mousedown', mouseDownHandler)
    canvas.removeEventListener('pointerdown', pointerDown)
    canvas.removeEventListener('pointermove', pointerMove)
    canvas.removeEventListener('pointerup', endPan)
    canvas.removeEventListener('pointercancel', endPan)
  }
}
