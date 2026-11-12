import { useState } from 'react'
import type { CatalogFood } from '../catalog/types'
import { formatNumber } from '../lib/utils'

interface PortionPickerProps {
  portions: Array<[string, number]>
  grams: number
  /** Index into `portions` that the logger pre-selected (see defaultPortionIndex). Its first tap keeps one. */
  defaultIndex?: number
  /** Called with the new gram amount and a serving label such as "2 × 1 large". */
  onPick: (grams: number, label: string) => void
  /** The unit of the amounts: millilitres for a branded drink. */
  unit?: 'g' | 'ml'
}

/** How many household measures show as chips. */
export const PORTION_CHIP_LIMIT = 6

/** Shorter chip text: drop USDA's long size notes in parentheses ("1 medium (7\" to 7-7/8\" long)" becomes "1 medium"). */
export const portionChipLabel = (label: string): string => label.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim()

const roundGrams = (value: number) => Math.round(value * 10) / 10

/** Words that make a household measure a poor default: whole birds, pies, pounds. Matched as whole words. */
const BULKY_WORDS = new Set(['lb', 'lbs', 'pound', 'roast', 'bird', 'recipe', 'yield', 'pie', 'crust', 'loaf', 'bunch', 'head', 'pizza', 'quart', 'gallon'])
/** Packaging is a last resort (a "1 package" bar is still better than 100 g), never a first pick. */
const PACKAGING_WORDS = new Set(['package', 'pkg', 'bag', 'jar', 'container', 'box', 'can', 'bottle', 'carton'])
const BEVERAGE_PACKAGING = new Set(['can', 'bottle', 'carton'])
const SMALL_SERVING_WORDS = new Set(['tbsp', 'tablespoon', 'tsp', 'teaspoon', 'oz', 'cup', 'pat'])
/** Dense foods whose natural serving is a spoonful or a slice and falls under 20 g (butter, oil, bacon). */
const SPOON_WORDS = new Set(['tbsp', 'tablespoon', 'tsp', 'teaspoon', 'pat'])

const YIELD_NOTE_WORDS = new Set(['yield', 'lb', 'lbs', 'pound'])
const rawWords = (label: string): string[] => label.toLowerCase().split(/[^a-z]+/).filter(Boolean)
const labelWords = (label: string): string[] => portionChipLabel(label).toLowerCase().split(/[^a-z]+/).filter(Boolean)
/** "cans" matches "can", but "pecans" does not. */
const singular = (word: string): string => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word)
const hasWord = (words: string[], set: Set<string>) => words.some((word) => set.has(word) || set.has(singular(word)))

type PortionList = ReadonlyArray<readonly [string, number]>
type PortionFood = Pick<CatalogFood, 'category' | 'per100g'> & { name?: string }

const pickPortion = (portions: PortionList, food: PortionFood, allowSpoons: boolean): number => {
  const beverage = /beverage/i.test(food.category)
  const wholeEgg = /^egg, whole/i.test(food.name ?? '')
  let best = -1
  let bestKey: [number, number] | null = null
  portions.forEach(([label, grams], index) => {
    const kcal = (food.per100g.calories * grams) / 100
    const words = labelWords(label)
    const text = portionChipLabel(label).toLowerCase()
    const slice = /^1 slice\b/.test(text)
    const spoon = hasWord(words, SPOON_WORDS) || slice
    const bigEnough = grams >= 20 || (slice && grams >= 8 && kcal >= 30) || (allowSpoons && spoon && grams >= 4 && kcal >= 15)
    if (!(bigEnough && grams <= (beverage ? 400 : 300))) return
    if (!(kcal <= 500)) return
    if (hasWord(words, BULKY_WORDS)) return
    // Notes in parentheses are ignored, except that "(yield from 1 lb ready-to-cook chicken)" is a pre-cooking weight, not a portion.
    if (hasWord(rawWords(label), YIELD_NOTE_WORDS)) return
    const packaging = hasWord(words, PACKAGING_WORDS) && !(beverage && hasWord(words, BEVERAGE_PACKAGING))
    const small = hasWord(words, SMALL_SERVING_WORDS)
    if (words.includes('cup') && kcal > 300) return
    let rank: number
    if (wholeEgg && /^1 large\b/.test(text)) rank = -1
    else if (/^1 medium\b/.test(text)) rank = 0
    else if (/^1 large\b/.test(text)) rank = 1
    else if (small) rank = words.includes('fl') && grams < 100 ? 5 : 3
    else if (/^1 /.test(text) || /^0\.5 breast\b/.test(text)) rank = grams >= 40 || /^1 (slice|egg)\b/.test(text) ? 2 : 5
    else rank = 4
    if (packaging) rank = 6
    // Among small servings: a spoon beats a pat, and a single ounce under 50 g (1 oz tuna is 24 kcal) yields to a larger serving.
    const tie = rank >= 4 ? Math.abs(grams - 100)
      : rank === 3 ? (words.includes('pat') ? 2 : words.includes('oz') && !words.includes('fl') && grams < 50 ? 1 : 0)
        : 0
    if (!bestKey || rank < bestKey[0] || (rank === bestKey[0] && tie < bestKey[1])) { best = index; bestKey = [rank, tie] }
  })
  return best
}

/**
 * Which household measure a freshly picked catalog food starts at, or -1 for "100 g, nothing selected".
 * A candidate weighs 20 to 300 g (400 for beverages; 8 g for "1 slice" with 30 kcal), stays under 500 kcal, and is not a bird, pie or pound.
 * Rank: "1 large" for whole eggs, 1 medium, 1 large, other counted units ("1 slice", "0.5 breast"), small servings (tbsp, tsp, oz, cup; a spoon
 * before a pat, a lone ounce under 50 g last), other measures by closeness to 100 g, then packaging (package, bag, box, container; can or
 * bottle for non-beverages). Counted units under 40 g (a strawberry) and single fluid ounces drop to the weak rank unless they are a slice or an egg.
 * When nothing qualifies, a second pass admits tablespoons, teaspoons and pats from 4 g with at least 15 kcal (butter, oil, mayonnaise).
 * Ties go to the earlier USDA entry.
 */
export const defaultPortionIndex = (portions: PortionList | undefined, food: PortionFood): number => {
  if (!portions) return -1
  const first = pickPortion(portions, food, false)
  return first >= 0 ? first : pickPortion(portions, food, true)
}
/**
 * USDA household measures as chips. Tapping a chip sets one of it; tapping the same chip again adds another,
 * so "1 large egg" becomes two eggs in two taps. Typing grams by hand clears the selection.
 */
export function PortionPicker({ portions, grams, defaultIndex, onPick, unit = 'g' }: PortionPickerProps) {
  const initial = defaultIndex !== undefined && defaultIndex >= 0 && defaultIndex < portions.length ? defaultIndex : undefined
  const [picked, setPicked] = useState<{ index: number; count: number; preselected: boolean } | null>(initial === undefined ? null : { index: initial, count: 1, preselected: true })
  // A default beyond the chips normally shown takes the last chip's place so it is visible and selected.
  const shownIndexes = portions.map((_, index) => index).slice(0, PORTION_CHIP_LIMIT)
  if (initial !== undefined && initial >= PORTION_CHIP_LIMIT) shownIndexes[PORTION_CHIP_LIMIT - 1] = initial
  const active = picked && roundGrams((portions[picked.index]?.[1] ?? 0) * picked.count) === roundGrams(grams) ? picked : null
  if (shownIndexes.length === 0) return null
  return (
    <div className="portion-chips" role="group" aria-label="Household measures">
      {shownIndexes.map((index) => {
        const [label, portionGrams] = portions[index]
        const isActive = active?.index === index
        const count = isActive ? active.count : 0
        return (
          <button
            key={`${index}-${label}`}
            type="button"
            className={`amount-chip portion-chip ${isActive ? 'selected' : ''}`}
            aria-pressed={isActive}
            title={`${label} = ${formatNumber(portionGrams, 1)} ${unit}`}
            onClick={() => {
              // The first tap on a chip pre-selected by default chooses it (stays at one); later taps add one more.
              const nextCount = isActive && !active.preselected ? count + 1 : 1
              setPicked({ index, count: nextCount, preselected: false })
              const chip = portionChipLabel(label)
              onPick(roundGrams(portionGrams * nextCount), nextCount > 1 ? `${nextCount} × ${chip}` : chip)
            }}
          >
            {isActive && count > 1 && <b className="portion-count">{count}×</b>}
            {portionChipLabel(label)}
            <small>{formatNumber(portionGrams, portionGrams < 10 ? 1 : 0)} {unit}</small>
          </button>
        )
      })}
    </div>
  )
}
