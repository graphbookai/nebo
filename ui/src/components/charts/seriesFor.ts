import type { LoggableMetricSeries } from '@/lib/api'

export type SeriesFor = (rid: string) => LoggableMetricSeries | undefined
