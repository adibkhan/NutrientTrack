import type { DiaryEntry, Food } from '../types'

/** Lower case with diacritics folded, so "Crème" and "creme" compare equal. */
export const foldText = (text: string): string => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase()

const words = (text: string): string[] => foldText(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/** Every query token must be the start of some word in the name, in any order. An empty query matches everything. */
export const matchesTokens = (name: string, query: string): boolean => {
  const tokens = words(query)
  if (tokens.length === 0) return true
  const nameWords = words(name)
  const whole = nameWords.join(' ')
  // Word starts in any order ("grilled chick"), or a plain substring so "berry" still finds "Blueberry".
  return tokens.every((token) => nameWords.some((word) => word.startsWith(token))) || whole.includes(tokens.join(' '))
}

export type FoodSort = 'recent' | 'az' | 'used'

/** Controls only earn their space once the list is long. */
export const FOOD_CONTROLS_MIN = 8

/** How often and how lately each saved food was logged, from the entries that carry its id. */
export const foodUsage = (entries: DiaryEntry[]): Map<string, { count: number; last: string }> => {
  const usage = new Map<string, { count: number; last: string }>()
  for (const entry of entries) {
    if (!entry.foodId || entry.planned) continue
    const current = usage.get(entry.foodId)
    usage.set(entry.foodId, { count: (current?.count ?? 0) + 1, last: current && current.last > entry.date ? current.last : entry.date })
  }
  return usage
}

/** Filter by query, then order. Recent = last logged (never-logged foods fall back to when they were saved), favorites first. */
export const filterAndSortFoods = (foods: Food[], entries: DiaryEntry[], query: string, sort: FoodSort): Food[] => {
  const sorted = foods.filter((food) => matchesTokens(food.name, query))
  const usage = foodUsage(entries)
  const byName = (a: Food, b: Food) => a.name.localeCompare(b.name)
  const lastUsed = (food: Food) => usage.get(food.id)?.last ?? food.createdAt.slice(0, 10)
  if (sort === 'az') return sorted.sort(byName)
  if (sort === 'used') return sorted.sort((a, b) => (usage.get(b.id)?.count ?? 0) - (usage.get(a.id)?.count ?? 0) || byName(a, b))
  return sorted.sort((a, b) => Number(b.favorite === true) - Number(a.favorite === true) || lastUsed(b).localeCompare(lastUsed(a)) || b.createdAt.localeCompare(a.createdAt) || byName(a, b))
}

type Keyed = Pick<DiaryEntry, 'id' | 'date' | 'meal' | 'name' | 'calories'>

/** Imported rows that already exist (same id, or same date, meal, name and calories) are set aside. Each existing entry cancels one imported row. */
export const dropExistingDuplicates = <T extends Keyed>(imported: T[], existing: Keyed[]): { fresh: T[]; duplicates: number } => {
  const key = (entry: Keyed) => [entry.date, entry.meal, foldText(entry.name.trim()), Math.round(entry.calories * 10)].join('|')
  const ids = new Set(existing.map((entry) => entry.id))
  const available = new Map<string, number>()
  for (const entry of existing) available.set(key(entry), (available.get(key(entry)) ?? 0) + 1)
  const fresh: T[] = []
  let duplicates = 0
  for (const entry of imported) {
    const k = key(entry)
    const left = available.get(k) ?? 0
    if (left > 0) { available.set(k, left - 1); duplicates += 1 } else if (ids.has(entry.id)) duplicates += 1
    else fresh.push(entry)
  }
  return { fresh, duplicates }
}
