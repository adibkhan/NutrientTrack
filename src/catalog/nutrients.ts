import { NUTRIENT_KEYS, type NutrientKey, type NutrientValues } from '../lib/nutrients'
import { getEntries, saveEntry } from '../lib/db'
import { nowISO } from '../lib/utils'
import type { DiaryEntry } from '../types'
import { scaleNutrientsPer100g } from '../lib/servings'

/**
 * The companion nutrient table for the USDA catalog, built by scripts/build-usda-nutrients.mjs. Like the catalog it is cached
 * by URL, so a content change ships as a new file name and is listed in public/sw.js (invariant 7).
 */
export const NUTRIENTS_PATH = './data/usda-nutrients-v1.json'

/** Per-100 g nutrients of one catalog food. Anything the source never measured is absent, not zero. */
export interface CatalogNutrientTable {
  per100g: (catalogId: string) => NutrientValues | undefined
}

interface RawTable { version?: number; keys?: unknown; rows?: unknown }

const KNOWN = new Set<string>(NUTRIENT_KEYS)
const idPattern = /^usda-sr-(\d+)$/

/** Read the compact file: rows are [fdcId, mask, ...values] and bit i of the mask says keys[i] has a value. Unknown keys are skipped. */
export const parseNutrientTable = (raw: unknown): CatalogNutrientTable => {
  const table = raw as RawTable
  if (!table || typeof table !== 'object' || !Array.isArray(table.keys) || !Array.isArray(table.rows)) throw new Error('Nutrient table has an invalid format.')
  const keys = table.keys as string[]
  const byFdc = new Map<number, number[]>()
  for (const row of table.rows as unknown[]) {
    if (Array.isArray(row) && typeof row[0] === 'number' && typeof row[1] === 'number') byFdc.set(row[0], row as number[])
  }
  return {
    per100g: (catalogId) => {
      const match = idPattern.exec(catalogId)
      const row = match ? byFdc.get(Number(match[1])) : undefined
      if (!row) return undefined
      const values: NutrientValues = {}
      let cursor = 2
      for (let index = 0; index < keys.length; index += 1) {
        if (Math.floor(row[1] / 2 ** index) % 2 !== 1) continue
        const value = row[cursor]
        cursor += 1
        const key = keys[index]
        if (KNOWN.has(key) && typeof value === 'number' && Number.isFinite(value) && value >= 0) values[key as NutrientKey] = value
      }
      return Object.keys(values).length > 0 ? values : undefined
    },
  }
}

const tablePromises = new Map<string, Promise<CatalogNutrientTable>>()

/** A request that never answers is abandoned after this long, so a later attempt can try again. */
const FETCH_ABANDON_MS = 30_000

const fetchTable = async (path: string): Promise<CatalogNutrientTable> => {
  const controller = typeof AbortController === 'function' ? new AbortController() : undefined
  const timer = setTimeout(() => controller?.abort(), FETCH_ABANDON_MS)
  try {
    const response = await fetch(path, { cache: 'force-cache', ...(controller ? { signal: controller.signal } : {}) })
    if (!response.ok) throw new Error(`Nutrient table could not be loaded (${response.status}).`)
    return parseNutrientTable(await response.json())
  } finally {
    clearTimeout(timer)
  }
}

/** Load the nutrient table once, the first time it is needed, and reuse the same request after. A failed load is not remembered. */
export const loadCatalogNutrients = (path: string = NUTRIENTS_PATH): Promise<CatalogNutrientTable> => {
  let promise = tablePromises.get(path)
  if (!promise) {
    promise = fetchTable(path).catch((error) => {
      tablePromises.delete(path)
      throw error
    })
    tablePromises.set(path, promise)
  }
  return promise
}

/** Forget the cached table (tests, and a retry after a long outage). */
export const resetCatalogNutrients = (): void => { tablePromises.clear() }

/** Nutrients of a catalog food per 100 g, or undefined when the table is unavailable or has nothing for it. Never throws. */
export const catalogNutrientsPer100g = async (catalogId: string): Promise<NutrientValues | undefined> => {
  try {
    return (await loadCatalogNutrients()).per100g(catalogId)
  } catch {
    return undefined
  }
}

/**
 * The snapshot of every nutrient the source has for `grams` of a catalog food, ready to spread into a diary entry. Empty when the
 * table is unavailable, so a catalog food still logs its macros. Use this wherever a catalog food becomes an entry.
 */
export const catalogNutrientSnapshot = async (catalogId: string, grams: number): Promise<NutrientValues> => {
  if (!(grams > 0) || !Number.isFinite(grams)) return {}
  const per100 = await catalogNutrientsPer100g(catalogId)
  return per100 ? scaleNutrientsPer100g(per100, grams) : {}
}

/** Logging never waits longer than this for micronutrients; it saves without them and fills them in when they arrive. */
export const NUTRIENT_WAIT_MS = 800

/** Begin fetching the table (for example when the logger opens) without waiting for it or surfacing a failure. */
export const warmCatalogNutrients = (): void => {
  void loadCatalogNutrients().catch(() => undefined)
}

/** Like catalogNutrientSnapshot, but gives up after NUTRIENT_WAIT_MS and returns an empty snapshot (absent, not zero). */
export const catalogNutrientSnapshotWithin = (catalogId: string, grams: number, waitMs: number = NUTRIENT_WAIT_MS): Promise<NutrientValues> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve({}), waitMs)
    catalogNutrientSnapshot(catalogId, grams).then((snapshot) => { clearTimeout(timer); resolve(snapshot) }, () => { clearTimeout(timer); resolve({}) })
  })

/**
 * Snapshots for a whole batch (a plate), one per request, sharing a single NUTRIENT_WAIT_MS budget: when the table has not answered
 * by then every unanswered request gets an empty snapshot and the save goes ahead. A null request stays empty.
 */
export const catalogNutrientSnapshotsWithin = (requests: ({ catalogId: string; grams: number } | null)[], waitMs: number = NUTRIENT_WAIT_MS): Promise<NutrientValues[]> =>
  new Promise((resolve) => {
    const results: NutrientValues[] = requests.map(() => ({}))
    let settled = false
    const finish = () => { if (settled) return; settled = true; clearTimeout(timer); resolve(results.map((item) => ({ ...item }))) }
    const timer = setTimeout(finish, waitMs)
    let pending = requests.length
    if (pending === 0) { finish(); return }
    requests.forEach((request, index) => {
      const done = () => { if (--pending === 0) finish() }
      if (!request) { done(); return }
      catalogNutrientSnapshot(request.catalogId, request.grams).then((snapshot) => { if (!settled) results[index] = snapshot }, () => undefined).then(done)
    })
  })

/**
 * After entries were saved without waiting for the table, fill in the nutrients once it arrives. Only an entry that still holds its
 * catalog id and the same grams, and has no nutrient field at all, is touched. It goes through the normal save with mustExist and
 * keeps every field it does not know about. Returns true when something was written.
 */
export const backfillCatalogNutrients = async (saved: DiaryEntry[]): Promise<boolean> => {
  const wanted = saved.filter((item) => item.catalogId && item.grams !== undefined && item.grams > 0 && !NUTRIENT_KEYS.some((key) => item[key] !== undefined))
  if (wanted.length === 0) return false
  let table: CatalogNutrientTable
  try { table = await loadCatalogNutrients() } catch { return false }
  let wrote = false
  for (const item of wanted) {
    const per100 = table.per100g(item.catalogId as string)
    if (!per100) continue
    try {
      const current = (await getEntries()).find((candidate) => candidate.id === item.id)
      if (!current || current.catalogId !== item.catalogId || current.grams !== item.grams || NUTRIENT_KEYS.some((key) => current[key] !== undefined)) continue
      await saveEntry({ ...current, ...scaleNutrientsPer100g(per100, item.grams as number), updatedAt: nowISO() }, { mustExist: true })
      wrote = true
    } catch {
      // Deleted elsewhere or storage unavailable: the entry simply stays without micronutrients.
    }
  }
  return wrote
}
