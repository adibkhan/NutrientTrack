/** Activity levels and the usual multipliers applied to resting energy. */
export const ACTIVITY_LEVELS = [
  { value: 'sedentary', label: 'Mostly sitting', factor: 1.2 },
  { value: 'light', label: 'Light activity, 1 to 3 days a week', factor: 1.375 },
  { value: 'moderate', label: 'Moderate, 3 to 5 days a week', factor: 1.55 },
  { value: 'active', label: 'Hard training most days', factor: 1.725 },
] as const

export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number]['value']

export interface StartingEstimateInput {
  /** Which Mifflin-St Jeor variant to use. */
  formula: 'male' | 'female'
  age: number
  heightCm: number
  weightKg: number
  activity: ActivityLevel
}

const between = (value: number, low: number, high: number): boolean => Number.isFinite(value) && value >= low && value <= high

/**
 * A first guess at daily maintenance energy, from the Mifflin-St Jeor equation and an activity multiplier, rounded to the
 * nearest 10 kcal. It is only a starting point until logged food and weigh-ins can measure the real number. Returns
 * undefined for values outside a believable range rather than computing nonsense from a typo.
 */
export const estimateMaintenance = (input: StartingEstimateInput): number | undefined => {
  if (!between(input.age, 14, 100) || !between(input.heightCm, 100, 250) || !between(input.weightKg, 30, 300)) return undefined
  const factor = ACTIVITY_LEVELS.find((level) => level.value === input.activity)?.factor
  if (factor === undefined) return undefined
  const resting = 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age + (input.formula === 'male' ? 5 : -161)
  return Math.round((resting * factor) / 10) * 10
}
