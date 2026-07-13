import { useEffect } from 'react'
import { useStore } from '@/store'

/** A tiny auto-dismissing notice (e.g. a nebo:// link whose target is gone).
 *  Rendered once at the app root; there's no toast library in the app. */
export function Notice() {
  const notice = useStore(s => s.notice)
  const setNotice = useStore(s => s.setNotice)

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 3000)
    return () => clearTimeout(t)
  }, [notice, setNotice])

  if (!notice) return null
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-[90vw] rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground shadow-lg"
    >
      {notice}
    </div>
  )
}
