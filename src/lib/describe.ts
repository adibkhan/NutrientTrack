import type { CatalogFood } from '../catalog/types'

/**
 * Describe-to-log: "2 eggs, toast and a coffee" becomes catalog foods with amounts, on the device and without AI.
 * Every match is shown for review before anything is saved, because a word match can pick the wrong food.
 */
export interface DescribedItem {
  text: string
  quantity: number
  unit?: string
  query: string
}

export interface ResolvedItem {
  item: DescribedItem
  food: CatalogFood
  grams: number
  /** What the amount means, e.g. "2 × 1 large" or "150 g". */
  amountLabel: string
}

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, half: 0.5, couple: 2, dozen: 12, some: 1 }
const UNIT_ALIASES: Record<string, string> = {
  g: 'g', gram: 'g', grams: 'g', gr: 'g', kg: 'kg', oz: 'oz', ounce: 'oz', ounces: 'oz', lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb', ml: 'ml',
  cup: 'cup', cups: 'cup', tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp', tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  slice: 'slice', slices: 'slice', piece: 'piece', pieces: 'piece', large: 'large', medium: 'medium', small: 'small',
  can: 'can', cans: 'can', bottle: 'bottle', bottles: 'bottle', scoop: 'scoop', scoops: 'scoop', bowl: 'cup', bowls: 'cup', glass: 'cup', glasses: 'cup', mug: 'cup', mugs: 'cup',
  serving: 'serving', servings: 'serving', handful: 'oz', handfuls: 'oz', fillet: 'fillet', fillets: 'fillet', breast: 'breast', breasts: 'breast',
  clove: 'clove', cloves: 'clove', stalk: 'stalk', stalks: 'stalk', stick: 'stick', sticks: 'stick', head: 'head', heads: 'head',
}
const FILLER = new Set(['of', 'cup of', 'the', 'some', 'my', 'fresh'])

/** Common foods mapped to a sensible catalog entry; matched by name prefix so USDA's notes in parentheses do not matter. */
const ALIASES: Array<[RegExp, string]> = [
  [/^(scrambled eggs?|eggs?,? scrambled)$/, 'Egg, whole, cooked, scrambled'],
  [/^(fried eggs?)$/, 'Egg, whole, cooked, fried'],
  [/^(eggs?|boiled eggs?|hard boiled eggs?)$/, 'Egg, whole, cooked, hard-boiled'],
  [/^(black )?coffee$/, 'Beverages, coffee, brewed, prepared with tap water'],
  [/^(black )?tea$/, 'Beverages, tea, black, brewed, prepared with tap water'],
  [/^(toast|whole wheat toast)$/, 'Bread, whole-wheat, commercially prepared, toasted'],
  [/^(bread|whole wheat bread)$/, 'Bread, whole-wheat, commercially prepared'],
  [/^white bread$/, 'Bread, white, commercially prepared'],
  [/^bananas?$/, 'Bananas, raw'],
  [/^apples?$/, 'Apples, raw, with skin'],
  [/^oranges?$/, 'Oranges, raw, all commercial varieties'],
  [/^(white )?rice$/, 'Rice, white, long-grain, regular, enriched, cooked'],
  [/^brown rice$/, 'Rice, brown, long-grain, cooked'],
  [/^(chicken|chicken breasts?|grilled chicken)$/, 'Chicken, broilers or fryers, breast, meat only, cooked, roasted'],
  [/^(oatmeal|oats|porridge)$/, 'Cereals, oats, regular and quick, unenriched, cooked with water'],
  [/^milk$/, 'Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D'],
  [/^(greek yogh?urt)$/, 'Yogurt, Greek, plain, nonfat'],
  [/^(yogh?urt)$/, 'Yogurt, plain, low fat'],
  [/^salmon$/, 'Fish, salmon, Atlantic, farmed, cooked, dry heat'],
  [/^avocados?$/, 'Avocados, raw, all commercial varieties'],
  [/^peanut butter$/, 'Peanut Butter, smooth'],
  [/^almonds?$/, 'Nuts, almonds'],
  [/^broccoli$/, 'Broccoli, cooked, boiled, drained, without salt'],
  [/^(potato|potatoes|baked potato)$/, 'Potatoes, baked, flesh and skin, without salt'],
  [/^(pasta|spaghetti)$/, 'Pasta, cooked, enriched, without added salt'],
  [/^(cheese|cheddar)$/, 'Cheese, cheddar'],
  [/^butter$/, 'Butter, salted'],
  [/^olive oil$/, 'Oil, olive, salad or cooking'],
  [/^bacon$/, 'Pork, cured, bacon, cooked, baked'],
  [/^steak$/, 'Beef, top sirloin, steak, separable lean and fat, trimmed to 1/8" fat, choice, cooked, broiled'],
  [/^orange juice$/, 'Orange juice, raw'],
  [/^strawberr(y|ies)$/, 'Strawberries, raw'],
  [/^blueberr(y|ies)$/, 'Blueberries, raw'],
  [/^tuna$/, 'Fish, tuna, light, canned in water, drained solids'],
  [/^spinach$/, 'Spinach, raw'],
  [/^tomato(es)?$/, 'Tomatoes, red, ripe, raw, year round average'],
  [/^carrots?$/, 'Carrots, raw'],
  [/^beers?$/, 'Alcoholic beverage, beer, regular, all'],
  [/^(red )?wine$/, 'Alcoholic beverage, wine, table, red'],
  [/^sugar$/, 'Sugars, granulated'],
  [/^honey$/, 'Honey'],
  [/^tortillas?$/, 'Tortillas, ready-to-bake or -fry, flour, refrigerated'],
  [/^bagels?$/, 'Bagels, plain, enriched, with calcium propionate'],
  [/^pizza$/, 'Pizza, cheese topping, regular crust, frozen, cooked'],
  [/^cottage cheese$/, 'Cheese, cottage, lowfat, 2% milkfat'],
  [/^(ground beef|burger patty)$/, 'Beef, ground, 85% lean meat / 15% fat, patty, cooked, broiled'],
  [/^lentils?$/, 'Lentils, mature seeds, cooked, boiled, without salt'],
  [/^black beans$/, 'Beans, black, mature seeds, cooked, boiled, without salt'],
  [/^hummus$/, 'Hummus, commercial'],
  [/^grapes?$/, 'Grapes, red or green'],
]

const parseQuantity = (word: string): number | undefined => {
  if (word in NUMBER_WORDS) return NUMBER_WORDS[word]
  if (/^\d+(\.\d+)?$/.test(word)) return Number(word)
  const fraction = /^(\d+)\/(\d+)$/.exec(word)
  if (fraction && Number(fraction[2]) > 0) return Number(fraction[1]) / Number(fraction[2])
  return undefined
}

/** Split a sentence into food items with a quantity and an optional unit. */
export const splitDescription = (text: string): DescribedItem[] => text
  .toLowerCase()
  .split(/\s*(?:,|;|\n|\+|&|\band\b|\bwith\b|\bplus\b)\s*/)
  .map((part) => part.trim())
  .filter(Boolean)
  .map((part) => {
    // "150g chicken" and "2x eggs" separate the number from its unit.
    const words = part.replace(/(\d)(g|kg|oz|lb|ml)\b/g, '$1 $2').replace(/(\d)x\b/g, '$1').split(/\s+/)
    let quantity: number | undefined
    let unit: string | undefined
    let index = 0
    const first = parseQuantity(words[0])
    if (first !== undefined) {
      quantity = first
      index = 1
      // "1 1/2 cups"
      const second = words[1] && /^\d+\/\d+$/.test(words[1]) ? parseQuantity(words[1]) : undefined
      if (second !== undefined) { quantity += second; index = 2 }
    }
    if (words[index] && UNIT_ALIASES[words[index]] && words.length > index + 1) {
      unit = UNIT_ALIASES[words[index]]
      index += 1
    }
    let rest = words.slice(index).join(' ').replace(/^of\s+/, '')
    for (const filler of FILLER) if (rest.startsWith(`${filler} `)) rest = rest.slice(filler.length + 1)
    return { text: part, quantity: quantity ?? 1, unit, query: rest.trim() }
  })
  .filter((item) => item.query.length > 1)

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const singular = (word: string) => (word.endsWith('ies') ? `${word.slice(0, -3)}y` : word.endsWith('oes') ? word.slice(0, -2) : word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word)
const PENALTY_WORDS = ['canned', 'frozen', 'dried', 'dehydrated', 'powder', 'babyfood', 'baby', 'infant', 'juice', 'concentrate', 'sweetened', 'syrup', 'imitation', 'restaurant', 'fast', 'mix', 'unprepared', 'flavored', 'substitute', 'school', 'formulated']

/** Best catalog food for a short query: an alias first, then a word match that prefers plain, whole foods. */
export const matchFood = (query: string, catalog: CatalogFood[]): CatalogFood | undefined => {
  const cleaned = normalize(query)
  for (const [pattern, prefix] of ALIASES) {
    if (pattern.test(cleaned)) {
      const food = catalog.find((candidate) => candidate.name.startsWith(prefix))
      if (food) return food
    }
  }
  const tokens = cleaned.split(' ').filter(Boolean).map(singular)
  if (tokens.length === 0) return undefined
  let best: { food: CatalogFood; score: number } | undefined
  for (const food of catalog) {
    const nameTokens = normalize(food.name).split(' ').map(singular)
    const positions = tokens.map((token) => nameTokens.findIndex((nameToken) => nameToken === token || nameToken.startsWith(token)))
    if (positions.some((position) => position < 0)) continue
    let score = positions.reduce((sum, position) => sum + position, 0) * 4 + nameTokens.length
    for (const word of PENALTY_WORDS) if (nameTokens.includes(word) && !tokens.includes(word)) score += 12
    if (nameTokens.includes('raw') || nameTokens.includes('cooked')) score -= 3
    if (!best || score < best.score) best = { food, score }
  }
  return best?.food
}

const PREFERRED = ['medium', 'large', 'slice', 'piece', 'fruit', 'egg', 'can', 'bottle', 'item', 'container', 'serving', 'cup']
const portionAmount = (label: string) => {
  const match = /^(\d+(?:\.\d+)?)\s/.exec(label)
  return match ? Number(match[1]) : 1
}
/** USDA labels spell spoons both ways: "1 tablespoon" and "1 tbsp". */
const PORTION_WORDS: Record<string, string> = { tbsp: '(?:tbsp|tablespoon)', tsp: '(?:tsp|teaspoon)' }
const findPortion = (food: CatalogFood, unit: string) => (food.portions ?? []).find(([label]) => new RegExp(`\\b${PORTION_WORDS[unit] ?? unit}s?\\b`, 'i').test(label))
const defaultPortion = (food: CatalogFood) => {
  const portions = (food.portions ?? []).filter(([label]) => !/^\d+(\.\d+)?\s*(fl )?(oz|g|lb)\b/i.test(label))
  // Spreads, oils and nut butters are eaten by the spoon, not the cup.
  const order = food.per100g.calories >= 400 ? ['tbsp', ...PREFERRED] : PREFERRED
  for (const word of order) {
    // The unit must be the first word ("1 medium"), so "1 stalk, medium" does not count as a medium broccoli.
    const match = portions.find(([label]) => new RegExp(`^\\d+(\\.\\d+)?\\s+${word}\\b`, 'i').test(label))
    if (match) return match
  }
  return portions[0]
}
const round = (value: number) => Math.round(value * 10) / 10
const SIZE_WORDS = new Set(['small', 'medium', 'large', 'extra', 'jumbo', 'whole', 'each'])
/** A standard 14.5 oz food can, used when the food has no can measure of its own. */
const STANDARD_CAN_GRAMS = 400
const short = (label: string) => label.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim()

/** Grams for an item: weights convert directly, household units use the food's USDA measures, and a bare count uses its usual size. */
export const amountFor = (item: DescribedItem, food: CatalogFood): { grams: number; amountLabel: string } => {
  const { quantity, unit } = item
  if (unit === 'g' || unit === 'ml') return { grams: round(quantity), amountLabel: `${round(quantity)} ${unit}` }
  if (unit === 'kg') return { grams: round(quantity * 1000), amountLabel: `${quantity} kg` }
  if (unit === 'oz') return { grams: round(quantity * 28.35), amountLabel: `${quantity} oz` }
  if (unit === 'lb') return { grams: round(quantity * 453.6), amountLabel: `${quantity} lb` }
  const portion = (unit && findPortion(food, unit)) || (unit === 'can' ? undefined : defaultPortion(food))
  if (unit === 'can' && !portion) return { grams: round(STANDARD_CAN_GRAMS * quantity), amountLabel: `${quantity} can` }
  if (portion) {
    const [label, grams] = portion
    const perUnit = grams / portionAmount(label)
    const chip = short(label).replace(/^\d+(\.\d+)?\s+/, '').replace(/\s\d.*$/, '')
    // "2 cups", "2 cloves"; size words like "2 large" and anything with a note stay as they are.
    const plural = quantity !== 1 && /^[a-z]+$/i.test(chip) && !/s$/i.test(chip) && !SIZE_WORDS.has(chip.toLowerCase()) ? `${chip}s` : chip
    return { grams: round(perUnit * quantity), amountLabel: `${quantity === 1 ? '1' : quantity} ${plural}` }
  }
  return { grams: round(100 * quantity), amountLabel: `${round(100 * quantity)} g` }
}

export const resolveDescription = (text: string, catalog: CatalogFood[]): { resolved: ResolvedItem[]; unmatched: DescribedItem[] } => {
  const resolved: ResolvedItem[] = []
  const unmatched: DescribedItem[] = []
  for (const item of splitDescription(text)) {
    // "1 can tomatoes" means the canned food, which the matcher otherwise avoids in favour of fresh.
    const food = matchFood(item.unit === 'can' && !/\bcanned\b/.test(item.query) ? `canned ${item.query}` : item.query, catalog) ?? matchFood(item.query, catalog)
    if (!food) { unmatched.push(item); continue }
    resolved.push({ item, food, ...amountFor(item, food) })
  }
  return { resolved, unmatched }
}

/** Worth offering only when the text reads like a meal: several items, or a number in front of a food. */
export const looksLikeDescription = (text: string): boolean => {
  const items = splitDescription(text)
  return items.length > 1 || (items.length === 1 && /^\s*(\d|a |an |one |two |three |half )/i.test(text))
}
