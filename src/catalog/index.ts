import type { CatalogFood } from './types'

const CATALOG_PATH = './data/usda-common-v2.json'

const catalogPromises = new Map<string, Promise<CatalogFood[]>>()

const normalize = (value: string) => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()

const tokensFor = (value: string) => value ? value.split(' ') : []

const fetchCatalog = async (path: string): Promise<CatalogFood[]> => {
  const response = await fetch(path, { cache: 'force-cache' })
  if (!response.ok) throw new Error(`Food catalog could not be loaded (${response.status}).`)
  const catalog: unknown = await response.json()
  if (!Array.isArray(catalog)) throw new Error('Food catalog has an invalid format.')
  return catalog as CatalogFood[]
}

/** Load the bundled USDA catalog once and reuse the same request thereafter. Pages outside the app root pass their own relative path. */
export const loadCatalog = (path: string = CATALOG_PATH): Promise<CatalogFood[]> => {
  let promise = catalogPromises.get(path)
  if (!promise) {
    promise = fetchCatalog(path).catch((error) => {
      catalogPromises.delete(path)
      throw error
    })
    catalogPromises.set(path, promise)
  }
  return promise
}

/** Find the original catalog record for a previously logged snapshot. */
export const findCatalogFood = async (id: string, source?: CatalogFood['source']): Promise<CatalogFood | undefined> => {
  const catalog = await loadCatalog()
  return catalog.find((food) => food.id === id && (!source || food.source === source))
}

type SearchRecord = {
  food: CatalogFood
  name: string
  nameTokens: string[]
  stemName: string
  stemTokens: string[]
  firstSegment: string
  firstSegmentTokens: string[]
  segments: Set<string>
  category: string
  categoryTokens: string[]
  stemCategory: string
  stemCategoryTokens: string[]
  penaltyWords: string[]
  length: number
}

type SearchIndex = { records: SearchRecord[]; vocabulary: string[] }

/** Plural-insensitive stem: bananas -> banana, eggs -> egg, berries -> berry, tomatoes -> tomato. */
const stem = (token: string) => {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`
  if (token.length > 4 && token.endsWith('oes')) return token.slice(0, -2)
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1)
  return token
}

const stemTokens = (tokens: string[]) => tokens.map(stem)

// Words that mark a processed, infant or dried form. They only count against a record when the query did not ask for them.
const PENALTIES: Array<{ word: string; test: (name: string, tokens: string[]) => boolean; weight: number }> = [
  { word: 'baby', test: (name, tokens) => tokens.includes('babyfood') || tokens.includes('baby') || name.includes('baby food'), weight: 45 },
  { word: 'infant', test: (_name, tokens) => tokens.includes('infant'), weight: 45 },
  { word: 'dehydrated', test: (_name, tokens) => tokens.includes('dehydrated'), weight: 6 },
  { word: 'powder', test: (_name, tokens) => tokens.includes('powder'), weight: 6 },
  { word: 'frozen mixture', test: (name) => name.includes('frozen mixture'), weight: 6 },
]

const buildRecord = (food: CatalogFood): SearchRecord => {
  const name = normalize(food.name)
  const nameTokens = tokensFor(name)
  const category = normalize(food.category)
  const categoryTokens = tokensFor(category)
  const stemmed = stemTokens(nameTokens)
  const segments = food.name.split(',').map((segment) => normalize(segment)).filter(Boolean)
  const firstSegmentTokens = stemTokens(tokensFor(segments[0] ?? ''))
  const stemCategoryTokens = stemTokens(categoryTokens)
  return {
    food,
    name,
    nameTokens,
    stemName: stemmed.join(' '),
    stemTokens: stemmed,
    firstSegment: firstSegmentTokens.join(' '),
    firstSegmentTokens,
    segments: new Set(segments.slice(1)),
    category,
    categoryTokens,
    stemCategory: stemCategoryTokens.join(' '),
    stemCategoryTokens,
    penaltyWords: PENALTIES.filter((penalty) => penalty.test(name, nameTokens)).map((penalty) => penalty.word),
    length: name.length,
  }
}

const indexes = new WeakMap<CatalogFood[], SearchIndex>()

/** Normalise every record once per catalog array; each keystroke then only compares against these arrays. */
const indexFor = (catalog: CatalogFood[]): SearchIndex => {
  let index = indexes.get(catalog)
  if (!index) {
    const records = catalog.map(buildRecord)
    const words = new Set<string>()
    for (const record of records) {
      for (const token of record.nameTokens) words.add(token)
      for (const token of record.stemTokens) words.add(token)
    }
    index = { records, vocabulary: [...words].sort() }
    indexes.set(catalog, index)
  }
  return index
}

const startsWithAllTokens = (queryTokens: string[], valueTokens: string[]) => (
  queryTokens.every((queryToken) => valueTokens.some((valueToken) => valueToken.startsWith(queryToken)))
)

// Matching inside a word ("oat" in "coated") is only trusted for longer query words.
const includesAllTokens = (queryTokens: string[], valueTokens: string[]) => (
  queryTokens.every((queryToken) => valueTokens.some((valueToken) => (queryToken.length >= 4 ? valueToken.includes(queryToken) : valueToken.startsWith(queryToken))))
)

const scoreField = (query: string, queryTokens: string[], value: string, valueTokens: string[]) => {
  if (!value) return undefined
  if (value === query) return 0
  if (value.startsWith(query)) return 10
  if (startsWithAllTokens(queryTokens, valueTokens)) return 20
  if (queryTokens.every((queryToken) => valueTokens.includes(queryToken))) return 30
  if (includesAllTokens(queryTokens, valueTokens)) return 40
  if (query.length >= 4 && value.includes(query)) return 50
  return undefined
}

type Query = { text: string; tokens: string[]; stemText: string; stemTokens: string[] }

const makeQuery = (tokens: string[]): Query => {
  const stems = stemTokens(tokens)
  return { text: tokens.join(' '), tokens, stemText: stems.join(' '), stemTokens: stems }
}

const FALLBACK = 60

const scoreName = (query: Query, record: SearchRecord) => {
  const raw = scoreField(query.text, query.tokens, record.name, record.nameTokens)
  const stemmed = scoreField(query.stemText, query.stemTokens, record.stemName, record.stemTokens)
  let base = raw === undefined ? stemmed : stemmed === undefined ? raw : Math.min(raw, stemmed)
  if (base === undefined) {
    // Partial match: at least one query word begins the food's own name. Ranks below any full match, above category-only hits.
    const matched = query.stemTokens.filter((token) => token.length >= 3 && record.firstSegmentTokens.some((word) => word.startsWith(token))).length
    if (matched === 0 || query.stemTokens.length < 2) return undefined
    base = FALLBACK + (query.stemTokens.length - matched) * 2
  }
  let score = base
  if (record.firstSegment === query.stemText) score -= 6
  else if (record.firstSegment.startsWith(query.stemText)) score -= 3
  if (record.segments.has('raw')) score -= 3
  if (record.segments.has('whole')) score -= 2
  PENALTIES.forEach((penalty) => {
    if (!record.penaltyWords.includes(penalty.word)) return
    const asked = penalty.word === 'baby' ? query.tokens.some((token) => token.startsWith('baby') || token === 'infant')
      : penalty.word === 'infant' ? query.tokens.some((token) => token === 'infant' || token.startsWith('baby'))
        : penalty.word.split(' ').every((word) => query.tokens.includes(word) || query.stemTokens.includes(word))
    if (!asked) score += penalty.weight
  })
  return score
}

const scoreRecord = (query: Query, record: SearchRecord) => {
  const nameScore = scoreName(query, record)
  // A name match always outranks a category-only match.
  if (nameScore !== undefined) return nameScore
  const categoryScore = scoreField(query.stemText, query.stemTokens, record.stemCategory, record.stemCategoryTokens)
  if (categoryScore !== undefined) return 100 + categoryScore
  return undefined
}

/** Edit distance, giving up (returns max + 1) once it must exceed `max`. */
const editDistance = (a: string, b: string, max: number) => {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j += 1) {
      const value = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      row.push(value)
      if (value < rowMin) rowMin = value
    }
    if (rowMin > max) return max + 1
    previous = row
  }
  return previous[b.length]
}

const hasMatch = (token: string, vocabulary: string[]) => {
  const stemmed = stem(token)
  return vocabulary.some((word) => word.startsWith(token) || word.startsWith(stemmed) || (token.length >= 4 && word.includes(token)))
}

/** Replace a query word that matches nothing with its closest catalog word: edit distance 1 from 5 letters, 2 from 8. */
const correctTokens = (tokens: string[], vocabulary: string[]) => {
  let changed = false
  const corrected = tokens.map((token) => {
    if (token.length < 5 || hasMatch(token, vocabulary)) return token
    const max = token.length >= 8 ? 2 : 1
    let best = token
    let bestDistance = max + 1
    for (const word of vocabulary) {
      const distance = editDistance(token, word, max)
      if (distance < bestDistance) { best = word; bestDistance = distance }
    }
    if (best !== token) changed = true
    return best
  })
  return changed ? corrected : undefined
}

/** Search food names (and categories) with stable relevance ordering. */
export const searchCatalog = async (query: string, limit = 30): Promise<CatalogFood[]> => {
  const normalizedQuery = normalize(query)
  const resultLimit = Math.max(0, Math.floor(limit))
  if (!normalizedQuery || resultLimit === 0) return []

  const { records, vocabulary } = indexFor(await loadCatalog())
  const rank = (parsed: Query) => {
    const matches: Array<{ food: CatalogFood; score: number; length: number; position: number }> = []
    records.forEach((record, position) => {
      const score = scoreRecord(parsed, record)
      if (score !== undefined) matches.push({ food: record.food, score, length: record.length, position })
    })
    matches.sort((left, right) => left.score - right.score || left.length - right.length || left.position - right.position)
    return matches
  }

  const tokens = tokensFor(normalizedQuery)
  const matches = rank(makeQuery(correctTokens(tokens, vocabulary) ?? tokens))
  return matches.slice(0, resultLimit).map(({ food }) => food)
}
