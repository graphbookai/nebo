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

// Representative tag for a MetricEntry. Multi-tagged entries pick the
// alphabetically-first tag, which keeps shape assignment stable as tag
// ordering changes elsewhere in the UI.
export function entryTag(e: MetricEntry): string {
  if (e.tags.length === 0) return UNTAGGED_KEY
  return [...e.tags].sort()[0]
}

// Shape picked by position in the chart's full tag list (including the
// untagged sentinel if present). Two runs that emit the same tag end up
// with the same shape — it's the color that distinguishes runs.
export function shapeForTag(tag: string, allTags: string[]): ScatterShape {
  const i = allTags.indexOf(tag)
  const idx = i < 0 ? 0 : i
  return SCATTER_SHAPES[idx % SCATTER_SHAPES.length]
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
