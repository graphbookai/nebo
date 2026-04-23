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
//
// KNOWN LIMITATION — multi-tag scatter entries:
//   When an entry carries multiple tags (e.g. ["phase:warmup","variant:a"])
//   the shape is driven by the first sorted tag only. If the user then
//   deselects that tag but keeps another one of the entry's tags active,
//   the entry still renders (the filter uses `some(t => active.has(t))`)
//   but it keeps drawing the shape of the tag that was turned off. The
//   chip legend and on-chart shape disagree.
//
//   This is benign for single-tag emissions (the common case) and
//   currently tolerated. Once multi-tag scatter becomes a real use case,
//   the cleaner fix is to model shape differently (per tag-group?) rather
//   than patching `entryTag` to pick the first *active* tag — the latter
//   would make a point silently change shape when unrelated chips are
//   toggled. Revisit the whole shape-assignment model at that point.
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
