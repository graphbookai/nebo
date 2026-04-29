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
  Chart.defaults.responsive = false
  Chart.defaults.maintainAspectRatio = false
}
