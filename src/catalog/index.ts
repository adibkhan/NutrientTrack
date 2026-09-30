import type { CatalogFood } from './types'

const CATALOG_PATH = './data/usda-common-v1.json'

let catalogPromise: Promise<CatalogFood[]> | undefined

const normalize = (value: string) => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()

const tokensFor = (value: string) => value ? value.split(' ') : []

const fetchCatalog = async (): Promise<CatalogFood[]> => {
  const response = await fetch(CATALOG_PATH, { cache: 'force-cache' })
  if (!response.ok) throw new Error(`Food catalog could not be loaded (${response.status}).`)
  const catalog: unknown = await response.json()
  if (!Array.isArray(catalog)) throw new Error('Food catalog has an invalid format.')
  return catalog as CatalogFood[]
}

/** Load the bundled USDA catalog once and reuse the same request thereafter. */
export const loadCatalog = (): Promise<CatalogFood[]> => {
  if (!catalogPromise) {
    catalogPromise = fetchCatalog().catch((error) => {
      catalogPromise = undefined
      throw error
    })
  }
  return catalogPromise
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
  category: string
  categoryTokens: string[]
  position: number
}

const startsWithAllTokens = (queryTokens: string[], valueTokens: string[]) => (
  queryTokens.every((queryToken) => valueTokens.some((valueToken) => valueToken.startsWith(queryToken)))
)

const includesAllTokens = (queryTokens: string[], valueTokens: string[]) => (
  queryTokens.every((queryToken) => valueTokens.some((valueToken) => valueToken.includes(queryToken)))
)

const scoreField = (query: string, queryTokens: string[], value: string, valueTokens: string[]) => {
  if (!value) return undefined
  if (value === query) return 0
  if (value.startsWith(query)) return 10
  if (startsWithAllTokens(queryTokens, valueTokens)) return 20
  if (queryTokens.every((queryToken) => valueTokens.includes(queryToken))) return 30
  if (includesAllTokens(queryTokens, valueTokens)) return 40
  if (value.includes(query)) return 50
  return undefined
}

const scoreRecord = (query: string, queryTokens: string[], record: SearchRecord) => {
  const nameScore = scoreField(query, queryTokens, record.name, record.nameTokens)
  const categoryScore = scoreField(query, queryTokens, record.category, record.categoryTokens)
  // A name match always outranks a category-only match.
  if (nameScore !== undefined) return nameScore
  if (categoryScore !== undefined) return 100 + categoryScore
  return undefined
}

/** Search food names (and categories) with stable relevance ordering. */
export const searchCatalog = async (query: string, limit = 30): Promise<CatalogFood[]> => {
  const normalizedQuery = normalize(query)
  const queryTokens = tokensFor(normalizedQuery)
  const resultLimit = Math.max(0, Math.floor(limit))
  if (!normalizedQuery || resultLimit === 0) return []

  const catalog = await loadCatalog()
  const matches: Array<{ food: CatalogFood; score: number; position: number }> = []
  catalog.forEach((food, position) => {
    const name = normalize(food.name)
    const category = normalize(food.category)
    const score = scoreRecord(normalizedQuery, queryTokens, {
      food,
      name,
      nameTokens: tokensFor(name),
      category,
      categoryTokens: tokensFor(category),
      position,
    })
    if (score !== undefined) matches.push({ food, score, position })
  })

  matches.sort((left, right) => left.score - right.score || left.position - right.position)
  return matches.slice(0, resultLimit).map(({ food }) => food)
}
