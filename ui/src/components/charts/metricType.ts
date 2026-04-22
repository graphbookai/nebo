// Parse a metric type string of the form "base" or "base,modifier".
// Today the only supported modifier is ",stacked", valid for bar and histogram.
export function parseMetricType(type: string): { base: string; stacked: boolean } {
  const suffix = ',stacked'
  if (type.endsWith(suffix)) {
    return { base: type.slice(0, -suffix.length), stacked: true }
  }
  return { base: type, stacked: false }
}
