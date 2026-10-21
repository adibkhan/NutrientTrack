import type { TrendedWeight } from './trend'
import { formatShortDate } from './utils'

/** Plotted scale points beyond this are averaged into buckets so a long history stays readable. */
export const MAX_PLOTTED_POINTS = 120

const DAY = 86_400_000
const stamp = (date: string) => new Date(`${date}T12:00:00`).getTime()
const isoOf = (time: number) => {
  const d = new Date(time)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Scale readings to plot. Up to `max` points are plotted as they are; beyond that they are averaged into buckets of
 * at least a week (weight and date), so the line shows the shape, not 500 dots. The trend line is drawn from the full series.
 */
export const downsampleWeights = (entries: TrendedWeight[], max = MAX_PLOTTED_POINTS): TrendedWeight[] => {
  if (entries.length <= max) return entries
  const first = stamp(entries[0].date)
  const span = Math.max(1, Math.round((stamp(entries[entries.length - 1].date) - first) / DAY))
  const bucketDays = Math.max(7, Math.ceil((span + 1) / max))
  const buckets = new Map<number, TrendedWeight[]>()
  for (const entry of entries) {
    const index = Math.floor(Math.round((stamp(entry.date) - first) / DAY) / bucketDays)
    buckets.set(index, [...(buckets.get(index) ?? []), entry])
  }
  return [...buckets.values()].map((group) => {
    const mean = (pick: (entry: TrendedWeight) => number) => group.reduce((sum, entry) => sum + pick(entry), 0) / group.length
    return { ...group[0], date: isoOf(Math.round(mean((entry) => stamp(entry.date)))), weight: mean((entry) => entry.weight), trend: mean((entry) => entry.trend) }
  })
}

/** Three gridline values, top to bottom, rounded to a tenth for narrow ranges and a whole unit otherwise. */
export const yAxisTicks = (min: number, max: number): number[] => {
  const digits = max - min < 5 ? 1 : 0
  const round = (value: number) => Number(value.toFixed(digits))
  return [round(max), round((min + max) / 2), round(min)]
}

/** "Mar 4" inside the current year, "Mar 2025" when the range spans years or is not this year. */
export const axisDateLabel = (date: string, withYear: boolean): string => {
  if (!withYear) return formatShortDate(date)
  const [year, month] = date.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(new Date(year, month - 1, 1, 12))
}

/** Years show whenever the range crosses a calendar year or is not the current one. */
export const axisNeedsYear = (startDate: string, endDate: string, today: string): boolean => {
  const startYear = startDate.slice(0, 4)
  return startYear !== endDate.slice(0, 4) || startYear !== today.slice(0, 4)
}
