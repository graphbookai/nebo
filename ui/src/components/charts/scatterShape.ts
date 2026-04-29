import type { MetricEntry } from '@/lib/api'

export const SCATTER_SHAPES = [
  'circle',
  'cross',
  'diamond',
  'square',
  'star',
  'triangle',
  'wye',
] as const
export type ScatterShape = (typeof SCATTER_SHAPES)[number]

// Sentinel used for entries that carry no user-supplied tags. The SDK never
// emits this string, so it's safe to use as an internal filter key.
export const UNTAGGED_KEY = '__untagged__'

// Shape picked by position in the chart's full label list. Two runs that
// emit the same scatter label end up with the same shape — it's the color
// that distinguishes runs.
export function shapeForLabel(label: string, allLabels: string[]): ScatterShape {
  const i = allLabels.indexOf(label)
  const idx = i < 0 ? 0 : i
  return SCATTER_SHAPES[idx % SCATTER_SHAPES.length]
}

// Backwards-compatible alias kept while a few callers still pass tag
// vocabularies. Both call paths key shapes off "position in a sorted
// vocabulary," so the same function works for either.
export const shapeForTag = shapeForLabel

// All scatter labels (dict keys of the entries' values) seen on a series,
// sorted for stable shape assignment.
export function scatterLabels(entries: MetricEntry[]): string[] {
  const labels = new Set<string>()
  for (const e of entries) {
    const v = e.value
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const k of Object.keys(v as Record<string, unknown>)) labels.add(k)
    }
  }
  return [...labels].sort()
}

// Predicate: an entry is visible when its tag set intersects the active tag
// chips, or when it has no tags and the (untagged) chip is active.
export function entriesMatchingTags(
  entries: MetricEntry[],
  activeTags: Set<string>,
): MetricEntry[] {
  return entries.filter(e => {
    if (e.tags.length === 0) return activeTags.has(UNTAGGED_KEY)
    for (const t of e.tags) if (activeTags.has(t)) return true
    return false
  })
}
