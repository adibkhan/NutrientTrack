import type { DiaryEntry } from '../types'

/**
 * Pip grows with every day that has food logged, counted over all time. Growth never goes backwards: a missed day,
 * a missed week or a broken streak leaves Pip exactly as it was, so there is nothing to lose by coming back late.
 */
export const PIP_STAGES = [
  { name: 'Sprout', days: 0 },
  { name: 'Seedling', days: 3 },
  { name: 'Budding', days: 7 },
  { name: 'Blooming', days: 14 },
  { name: 'Flourishing', days: 30 },
] as const

export type PipStage = 0 | 1 | 2 | 3 | 4

export interface PipGrowth {
  stage: PipStage
  name: string
  /** Days with at least one eaten entry, up to and including today. */
  days: number
  /** The next stage and how many more logged days it takes, until the last stage. */
  next?: { name: string; remaining: number }
  /** Today's logging is what reached the current stage. */
  grewToday: boolean
}

export const stageForDays = (days: number): PipStage => {
  let stage = 0
  PIP_STAGES.forEach((candidate, index) => { if (days >= candidate.days) stage = index })
  return stage as PipStage
}

export const pipGrowth = (entries: DiaryEntry[], today: string): PipGrowth => {
  const days = new Set(entries.filter((entry) => !entry.planned && entry.date <= today).map((entry) => entry.date))
  const count = days.size
  const stage = stageForDays(count)
  const next = PIP_STAGES[stage + 1]
  return {
    stage,
    name: PIP_STAGES[stage].name,
    days: count,
    ...(next ? { next: { name: next.name, remaining: next.days - count } } : {}),
    grewToday: stage > 0 && days.has(today) && count === PIP_STAGES[stage].days,
  }
}
