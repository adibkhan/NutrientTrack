import type { DiaryEntry, MealCategory } from '../types'
import { inputText } from './decimal'
import { LIMITS, findLimitProblem, round1, round2 } from './limits'
import { NUTRIENT_KEYS, nutrientDraftFrom, type NutrientValues } from './nutrients'
import { roundNutrient } from './servings'

/** One serving of something on the plate: the numbers a single tap adds, and the links a diary entry keeps. */
export interface PlateUnit extends NutrientValues {
  calories: number
  protein: number
  carbs: number
  fat: number
  grams?: number
  /** Servings the numbers already cover (a recent entry logged as 2 servings); missing means one. */
  servings?: number
  foodId?: string
  catalogId?: string
  catalogSource?: DiaryEntry['catalogSource']
}

export interface PlateItem {
  /** See `plateKey`: the same food from any row lands on the same line. */
  key: string
  name: string
  qty: number
  unit: PlateUnit
}

export const MAX_PLATE_QTY = 20

/**
 * The line a food belongs to, whichever row it came from: a catalog food by id and grams per unit, a saved food by id and servings per
 * unit, anything else by name and calories. A recent entry that carries a catalog or food id therefore merges with the catalog or saved row.
 */
export const plateKey = (name: string, unit: PlateUnit): string =>
  unit.catalogId ? `c:${unit.catalogId}:${unit.grams ?? ''}:${unit.servings ?? 1}`
    : unit.foodId ? `f:${unit.foodId}:${unit.servings ?? 1}`
      : `n:${name.trim().toLocaleLowerCase()}|${Math.round(unit.calories)}`

/** Tap "+" on a row: a new line at one serving, or one more serving on the line that is already there. */
export const addToPlate = (plate: readonly PlateItem[], food: { name: string; unit: PlateUnit }): PlateItem[] => {
  const item = { key: plateKey(food.name, food.unit), name: food.name, unit: food.unit }
  const found = plate.find((line) => line.key === item.key)
  if (!found) return [...plate, { ...item, qty: 1 }]
  return plate.map((line) => (line === found ? { ...line, qty: Math.min(MAX_PLATE_QTY, line.qty + 1) } : line))
}

/** One fewer serving; the line goes away at zero. */
export const reduceInPlate = (plate: readonly PlateItem[], key: string): PlateItem[] =>
  plate.flatMap((line) => (line.key !== key ? [line] : line.qty > 1 ? [{ ...line, qty: line.qty - 1 }] : []))

export const removeFromPlate = (plate: readonly PlateItem[], key: string): PlateItem[] => plate.filter((line) => line.key !== key)

/** What a line adds to the diary: the unit times the count, rounded the way the entry form rounds. */
export const plateAmounts = (line: PlateItem) => {
  const { unit, qty } = line
  // A count of servings is stored for foods and for recents that already had one; a catalog or weighed line counts in grams instead.
  const counted = unit.servings !== undefined || (qty > 1 && unit.grams === undefined)
  const servings = counted ? round2((unit.servings ?? 1) * qty) : undefined
  const nutrients: NutrientValues = {}
  for (const key of NUTRIENT_KEYS) if (unit[key] !== undefined) nutrients[key] = roundNutrient(key, (unit[key] as number) * qty)
  return {
    calories: round1(unit.calories * qty),
    protein: round1(unit.protein * qty),
    carbs: round1(unit.carbs * qty),
    fat: round1(unit.fat * qty),
    ...(unit.grams !== undefined ? { grams: round1(unit.grams * qty) } : {}),
    ...(servings !== undefined && servings !== 1 ? { servings } : {}),
    nutrients,
  }
}

export const plateTotals = (plate: readonly PlateItem[]) => {
  const totals = { foods: 0, calories: 0, protein: 0, carbs: 0, fat: 0 }
  for (const line of plate) {
    const amounts = plateAmounts(line)
    totals.foods += 1
    totals.calories += amounts.calories
    totals.protein += amounts.protein
    totals.carbs += amounts.carbs
    totals.fat += amounts.fat
  }
  return { ...totals, calories: round1(totals.calories), protein: round1(totals.protein), carbs: round1(totals.carbs), fat: round1(totals.fat) }
}

/** The first line over a cap in src/lib/limits.ts, with a message that names the food; undefined when all are fine. */
export const plateProblem = (plate: readonly PlateItem[]): string | undefined => {
  for (const line of plate) {
    const amounts = plateAmounts(line)
    const problem = findLimitProblem({
      calories: inputText(amounts.calories), protein: inputText(amounts.protein), carbs: inputText(amounts.carbs), fat: inputText(amounts.fat),
      grams: amounts.grams === undefined ? '' : inputText(amounts.grams), servings: amounts.servings === undefined ? '' : inputText(amounts.servings),
      nutrients: nutrientDraftFrom(amounts.nutrients),
    })
    if (problem) return `${line.name}: ${problem.message}`
  }
  return undefined
}

export interface PlateTarget { date: string; meal: MealCategory; time: string; planned: boolean }

/** The entries to save, in plate order, one millisecond apart in createdAt so that order survives sorting. */
export const plateEntries = (plate: readonly PlateItem[], target: PlateTarget, timestamp: string, makeId: () => string): DiaryEntry[] =>
  plate.map((line, index) => {
    const { nutrients, servings, ...amounts } = plateAmounts(line)
    return {
      id: makeId(), date: target.date, meal: target.meal, name: line.name.trim().slice(0, LIMITS.nameLength),
      ...amounts,
      ...(line.unit.foodId ? { foodId: line.unit.foodId } : {}),
      ...(line.unit.catalogId ? { catalogId: line.unit.catalogId } : {}),
      ...(line.unit.catalogSource ? { catalogSource: line.unit.catalogSource } : {}),
      ...(target.time ? { time: target.time } : {}),
      ...(target.planned ? { planned: true } : {}),
      ...(servings !== undefined ? { servings } : {}),
      ...nutrients,
      createdAt: new Date(Date.parse(timestamp) + index).toISOString(), updatedAt: timestamp,
    }
  })
