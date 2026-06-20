// "Nice" tick generation for the tracker ruler / guides. Kept in its own
// module (not the component file) so Fast Refresh stays happy.
export function generateTicks(min: number, max: number, target = 8): number[] {
  const range = max - min
  if (range <= 0) return []
  const raw = range / target
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const step = norm <= 1.5 ? mag : norm <= 3.5 ? 2 * mag : norm <= 7.5 ? 5 * mag : 10 * mag
  const ticks: number[] = []
  let t = Math.ceil(min / step) * step
  while (t <= max + step * 0.001) { ticks.push(t); t += step }
  return ticks
}
