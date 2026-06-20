import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export interface AxisTransform {
  scale: number
  panX: number
  innerStyle: { width: string; transform: string }
  toPercent: (value: number) => number       // domain value → 0..100 (unscaled)
  visibleRange: [number, number]             // visible pct window (with margin)
  beginPan: (clientX: number) => void
  onPanMove: (clientX: number) => void
  endPan: () => void
  reset: () => void
  setContainer: (el: HTMLElement | null) => void
}

// Horizontal zoom/pan transform shared by the tracker ruler + canvas rows.
// Zoom is ctrl/⌘ + wheel (and trackpad pinch, which the browser reports as
// ctrl+wheel); horizontal pan is shift+wheel, a horizontal wheel, or a
// middle-mouse drag. A plain vertical wheel is left untouched so the row
// list scrolls natively. The wheel listener is attached natively (not via
// React's passive onWheel) so preventDefault works for zoom.
export function useAxisTransform(min: number, max: number): AxisTransform {
  const range = max - min
  const containerRef = useRef<HTMLElement | null>(null)
  const [scale, setScale] = useState(1)
  const [panX, setPanX] = useState(0)
  const [containerWidth, setContainerWidth] = useState(0)
  // Refs mirror the latest scale/pan/range so the native wheel listener
  // (registered once per container) always reads current values.
  const scaleRef = useRef(1)
  const panXRef = useRef(0)
  const rangeRef = useRef(range)
  const observerRef = useRef<ResizeObserver | null>(null)
  const panStartX = useRef(0)
  const panStartPanX = useRef(0)
  const panning = useRef(false)
  useEffect(() => { rangeRef.current = range }, [range])

  const clampPanX = useCallback((px: number, s: number) => {
    const el = containerRef.current
    if (!el || s <= 1) return 0
    const w = el.getBoundingClientRect().width
    return Math.min(0, Math.max(w * (1 - s), px))
  }, [])

  const wheelHandler = useCallback((e: WheelEvent) => {
    const el = containerRef.current
    if (!el || rangeRef.current <= 0) return
    if (e.ctrlKey || e.metaKey) {
      // Zoom to cursor (ctrl/⌘ + wheel, or trackpad pinch).
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const cursorX = e.clientX - rect.left
      const s = scaleRef.current
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      const newScale = Math.max(1, Math.min(50, s * factor))
      const trackPoint = (cursorX - panXRef.current) / s
      let newPanX = cursorX - trackPoint * newScale
      newPanX = Math.min(0, Math.max(rect.width * (1 - newScale), newPanX))
      if (newScale <= 1) { scaleRef.current = 1; panXRef.current = 0; setScale(1); setPanX(0) }
      else { scaleRef.current = newScale; panXRef.current = newPanX; setScale(newScale); setPanX(newPanX) }
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      // Horizontal pan (only meaningful while zoomed in).
      if (scaleRef.current <= 1) return
      e.preventDefault()
      const d = e.shiftKey ? e.deltaY : e.deltaX
      const w = el.getBoundingClientRect().width
      const px = Math.min(0, Math.max(w * (1 - scaleRef.current), panXRef.current - d))
      panXRef.current = px; setPanX(px)
    }
    // Plain vertical wheel: do nothing → the row list scrolls natively.
  }, [])

  const setContainer = useCallback((el: HTMLElement | null) => {
    if (containerRef.current === el) return
    const prev = containerRef.current
    observerRef.current?.disconnect()
    if (prev) prev.removeEventListener('wheel', wheelHandler)
    containerRef.current = el
    if (el) {
      setContainerWidth(el.clientWidth)
      const ro = new ResizeObserver(() => setContainerWidth(el.clientWidth))
      ro.observe(el)
      observerRef.current = ro
      el.addEventListener('wheel', wheelHandler, { passive: false })
    }
  }, [wheelHandler])

  useEffect(() => () => {
    observerRef.current?.disconnect()
    const el = containerRef.current
    if (el) el.removeEventListener('wheel', wheelHandler)
  }, [wheelHandler])

  const toPercent = useCallback((v: number) => (range > 0 ? ((v - min) / range) * 100 : 0), [min, range])

  const beginPan = useCallback((clientX: number) => {
    panning.current = true; panStartX.current = clientX; panStartPanX.current = panXRef.current
  }, [])
  const onPanMove = useCallback((clientX: number) => {
    if (!panning.current) return
    const px = clampPanX(panStartPanX.current + (clientX - panStartX.current), scaleRef.current)
    panXRef.current = px; setPanX(px)
  }, [clampPanX])
  const endPan = useCallback(() => { panning.current = false }, [])
  const reset = useCallback(() => { scaleRef.current = 1; panXRef.current = 0; setScale(1); setPanX(0) }, [])

  const innerStyle = useMemo(() => ({ width: `${scale * 100}%`, transform: `translateX(${panX}px)` }), [scale, panX])
  const visibleRange = useMemo<[number, number]>(() => {
    const w = containerWidth || 300
    const minPct = (-panX / (w * scale)) * 100
    return [minPct - 2, minPct + 100 / scale + 2]
  }, [panX, scale, containerWidth])

  return { scale, panX, innerStyle, toPercent, visibleRange, beginPan, onPanMove, endPan, reset, setContainer }
}
