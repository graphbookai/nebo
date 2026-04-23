import { useEffect, useRef, useState } from 'react'

// Shared state for tag chips.
//
// - All chips start selected so nothing is hidden on first render.
// - A `seen` ref tracks which chips we've already surfaced, so a streaming
//   WebSocket update that merely reaffirms existing tags never resurrects
//   a tag the user has explicitly deselected.
export function useTagChips(allTags: string[]) {
  const [active, setActive] = useState<Set<string>>(() => new Set(allTags))
  const seen = useRef<Set<string>>(new Set(allTags))

  useEffect(() => {
    const fresh: string[] = []
    for (const t of allTags) {
      if (!seen.current.has(t)) {
        seen.current.add(t)
        fresh.push(t)
      }
    }
    if (fresh.length === 0) return
    setActive(prev => {
      const next = new Set(prev)
      for (const t of fresh) next.add(t)
      return next
    })
  }, [allTags])

  const toggle = (t: string) =>
    setActive(prev => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })

  return { active, toggle, setActive }
}
