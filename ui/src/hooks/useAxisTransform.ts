import { useCallback, useMemo, useRef, useState } from 'react'

export interface AxisTransform {
  scale: number
  panX: number
  innerStyle: { width: string; transform: string }
  toPercent: (value: number) => number       // domain value → 0..100 (unscaled)
  visibleRange: [number, number]             // visible pct window (with margin)
  onWheel: (e: React.WheelEvent) => void
  beginPan: (clientX: number) => void
  onPanMove: (clientX: number) => void
  endPan: () => void
  reset: () => void
  setContainer: (el: HTMLElement | null) => void
}

export function useAxisTransform(min: number, max: number): AxisTransform {
  const range = max - min
  const containerRef = useRef<HTMLElement | null>(null)
  const [scale, setScale] = useState(1)
  const [panX, setPanX] = useState(0)
  const panStartX = useRef(0)
  const panStartPanX = useRef(0)
  const panning = useRef(false)

  const setContainer = useCallback((el: HTMLElement | null) => { containerRef.current = el }, [])
  const toPercent = useCallback((v: number) => (range > 0 ? ((v - min) / range) * 100 : 0), [min, range])

  const clampPanX = useCallback((px: number, s: number) => {
    const el = containerRef.current
    if (!el || s <= 1) return 0
    const w = el.getBoundingClientRect().width
    return Math.min(0, Math.max(w * (1 - s), px))
  }, [])

  const onWheel = useCallback((e: React.WheelEvent) => {
    const el = containerRef.current
    if (!el || range <= 0) return
    e.preventDefault()
    const rect = el.getBoundingClientRect()
    const cursorX = e.clientX - rect.left
    const factor = e.deltaY < 0 ? 1.25 : 1 / 1.25
    const newScale = Math.max(1, Math.min(50, scale * factor))
    const trackPoint = (cursorX - panX) / scale
    let newPanX = cursorX - trackPoint * newScale
    newPanX = Math.min(0, Math.max(rect.width * (1 - newScale), newPanX))
    if (newScale <= 1) { setScale(1); setPanX(0) } else { setScale(newScale); setPanX(newPanX) }
  }, [range, scale, panX])

  const beginPan = useCallback((clientX: number) => { panning.current = true; panStartX.current = clientX; panStartPanX.current = panX }, [panX])
  const onPanMove = useCallback((clientX: number) => {
    if (!panning.current) return
    setPanX(clampPanX(panStartPanX.current + (clientX - panStartX.current), scale))
  }, [clampPanX, scale])
  const endPan = useCallback(() => { panning.current = false }, [])
  const reset = useCallback(() => { setScale(1); setPanX(0) }, [])

  const innerStyle = useMemo(() => ({ width: `${scale * 100}%`, transform: `translateX(${panX}px)` }), [scale, panX])
  const visibleRange = useMemo<[number, number]>(() => {
    const w = containerRef.current?.clientWidth ?? 300
    const minPct = (-panX / (w * scale)) * 100
    return [minPct - 2, minPct + 100 / scale + 2]
  }, [panX, scale])

  return { scale, panX, innerStyle, toPercent, visibleRange, onWheel, beginPan, onPanMove, endPan, reset, setContainer }
}
