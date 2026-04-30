import {
  Chart,
  LineController,
  BarController,
  DoughnutController,
  ScatterController,
  LineElement,
  BarElement,
  PointElement,
  ArcElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Filler,
} from 'chart.js'

let registered = false

export function registerChartJs(): void {
  if (registered) return
  registered = true

  Chart.register(
    LineController,
    BarController,
    DoughnutController,
    ScatterController,
    LineElement,
    BarElement,
    PointElement,
    ArcElement,
    LinearScale,
    CategoryScale,
    Tooltip,
    Filler,
  )

  // Match recharts' isAnimationActive={false} on every chart in the codebase.
  // Cast to `false` literal because Chart.defaults.animation accepts either an
  // options object or the literal `false`. The two per-property animations
  // (colors, numbers) fire independently of Chart.defaults.animation when
  // datasets update, so they need their own guards to fully suppress motion.
  Chart.defaults.animation = false as const
  Chart.defaults.animations.colors = false
  Chart.defaults.animations.numbers = false
  // Leave `responsive` and `maintainAspectRatio` at their Chart.js defaults
  // (true and true). We override `maintainAspectRatio` to false on each chart
  // so it fills the parent's fixed height; `responsive: true` lets Chart.js
  // own canvas sizing (inline width/height match parent) so charts don't
  // try to expand to their bitmap intrinsic dims and push their containers.
}
