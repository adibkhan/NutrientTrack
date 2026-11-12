// Test helpers for the branded index: a tiny synthetic FoodData Central release, and an in-memory fetch that serves a build's files
// with (or without) HTTP Range support. Used by brandedBuild.test.ts and branded.test.ts; not imported by the app.
// @ts-expect-error The app tsconfig has no Node typings; the tests run in Node.
import { mkdtempSync, writeFileSync } from 'node:fs'
// @ts-expect-error see above
import { tmpdir } from 'node:os'
// @ts-expect-error see above
import { join } from 'node:path'
// @ts-expect-error The script is plain JavaScript.
import { OPTIONAL_NUTRIENTS } from '../../scripts/build-usda-branded.mjs'

export interface SyntheticFood {
  fdc: number
  gtin: string
  owner?: string
  brand?: string
  name: string
  category?: string
  size?: string
  unit?: string
  household?: string
  available?: string
  modified?: string
  country?: string
  discontinued?: string
  /** nutrient id -> amount per 100 g */
  nutrients?: Record<string, number>
}

const quote = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`
const csv = (rows: Array<Array<string | number>>) => `${rows.map((row) => row.map(quote).join(',')).join('\n')}\n`

const BRANDED_HEADER = ['fdc_id', 'brand_owner', 'brand_name', 'subbrand_name', 'gtin_upc', 'ingredients', 'not_a_significant_source_of', 'serving_size', 'serving_size_unit', 'household_serving_fulltext', 'branded_food_category', 'data_source', 'package_weight', 'modified_date', 'available_date', 'market_country', 'discontinued_date', 'preparation_state_code', 'trade_channel', 'short_description', 'material_code']

/** Macros for a believable food: energy 4P + 4C + 9F. */
export const macros = (protein: number, fat: number, carbs: number, extra: Record<string, number> = {}): Record<string, number> => ({
  '1008': Math.round(4 * protein + 4 * carbs + 9 * fat), '1003': protein, '1004': fat, '1005': carbs, ...extra,
})

/** Write a synthetic release into a new temp directory and return its path. Ingredients carry quotes and newlines to exercise the CSV reader. */
export const writeSyntheticRelease = (foods: SyntheticFood[]): string => {
  const dir: string = mkdtempSync(join(tmpdir(), 'branded-'))
  const branded = [BRANDED_HEADER, ...foods.map((food) => [food.fdc, food.owner ?? 'ACME FOODS, INC.', food.brand ?? '', '', food.gtin, 'INGREDIENTS: SUGAR, "COCOA",\nSALT', '', food.size ?? '40', food.unit ?? 'g', food.household ?? '1 bar', food.category ?? 'Snacks', 'LI', '', food.modified ?? '2021-01-01', food.available ?? '2021-01-01', food.country ?? 'United States', food.discontinued ?? '', '', '', '', ''])]
  writeFileSync(join(dir, 'branded_food.csv'), csv(branded))
  writeFileSync(join(dir, 'food.csv'), csv([['fdc_id', 'data_type', 'description', 'food_category_id', 'publication_date', 'market_country', 'trade_channel', 'microbe_data'], ...foods.map((food) => [food.fdc, 'branded_food', food.name, '', '2021-01-01', 'United States', '', '[]'])]))
  const nutrientRows: Array<Array<string | number>> = [['id', 'fdc_id', 'nutrient_id', 'amount', 'data_points', 'derivation_id', 'min', 'max', 'median', 'footnote', 'min_year_acquired']]
  let id = 1
  for (const food of foods) for (const [nutrient, amount] of Object.entries(food.nutrients ?? macros(5, 5, 20))) nutrientRows.push([id++, food.fdc, nutrient, amount, '', '71', '', '', '', '', ''])
  writeFileSync(join(dir, 'food_nutrient.csv'), csv(nutrientRows))
  const units: Array<[string, string]> = [['1008', 'KCAL'], ['1062', 'kJ'], ['1003', 'G'], ['1004', 'G'], ['1005', 'G'], ['1086', 'G']]
  for (const spec of OPTIONAL_NUTRIENTS as Array<{ key: string; ids: string[]; unit: string; iuFallback?: { id: string; unit: string } }>) {
    for (const nutrient of spec.ids) units.push([nutrient, spec.iuFallback && nutrient === spec.iuFallback.id ? spec.iuFallback.unit : spec.unit])
  }
  writeFileSync(join(dir, 'nutrient.csv'), csv([['id', 'name', 'unit_name', 'nutrient_nbr', 'rank'], ...units.map(([nutrient, unit]) => [nutrient, `n${nutrient}`, unit, nutrient, '1'])]))
  return dir
}

export interface ServedFiles { fetch: typeof fetch; log: Array<{ url: string; range?: string; status: number }> }

/** An in-memory fetch over a build's files. With ranges false it ignores Range like python's http.server (200, whole body). */
export const serveFiles = (files: Record<string, Uint8Array | string>, { ranges = true }: { ranges?: boolean } = {}): ServedFiles => {
  const log: ServedFiles['log'] = []
  const encoder = new TextEncoder()
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const name = url.replace(/^.*\//, '')
    const content = files[name]
    const range = (init?.headers as Record<string, string> | undefined)?.Range
    if (content === undefined) { log.push({ url, range, status: 404 }); return new Response('missing', { status: 404 }) }
    const bytes = typeof content === 'string' ? encoder.encode(content) : content
    const match = ranges && range ? /^bytes=(\d+)-(\d+)$/.exec(range) : null
    if (match) {
      const body = bytes.slice(Number(match[1]), Number(match[2]) + 1)
      log.push({ url, range, status: 206 })
      return new Response(body, { status: 206, headers: { 'Content-Range': `bytes ${match[1]}-${match[2]}/${bytes.length}` } })
    }
    log.push({ url, range, status: 200 })
    return new Response(bytes.slice(), { status: 200 })
  }) as typeof fetch
  return { fetch: fetcher, log }
}
