/**
 * How many units (servings, or grams) of a food give a target amount of one nutrient, rounded to `digits` decimals.
 * Returns undefined when there is nothing sensible to divide: a target of zero or less, or a food with none of that
 * nutrient.
 */
export const solveAmount = (target: number, perUnit: number, digits = 2): number | undefined => {
  if (!Number.isFinite(target) || !Number.isFinite(perUnit) || !(target > 0) || !(perUnit > 0)) return undefined
  const factor = 10 ** digits
  const amount = Math.round((target / perUnit) * factor) / factor
  // The quotient can overflow for an enormous target, and Infinity must not reach the form.
  return Number.isFinite(amount) && amount > 0 ? amount : undefined
}
