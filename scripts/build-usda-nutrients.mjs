#!/usr/bin/env node

/**
 * Build the companion nutrient table for the bundled food catalog from the USDA FoodData Central
 * SR Legacy CSV archive (public domain, CC0). Same source and sha256 as the catalog: see CLAUDE.md.
 *
 * Usage:
 *   node scripts/build-usda-nutrients.mjs --zip FoodData_Central_sr_legacy_food_csv_2018-04.zip
 *   node scripts/build-usda-nutrients.mjs --zip source.zip --catalog public/data/usda-common-v2.json --output public/data/usda-nutrients-v1.json
 *
 * Output (all values per 100 g of edible food, in the unit of that key's NUTRIENTS entry in src/lib/nutrients.ts):
 *   { "version": 1, "source": "...", "keys": [nutrient keys], "rows": [[fdcId, mask, v1, v2, ...], ...] }
 * `mask` is a bit set over `keys` (bit i = keys[i] is present); only present values follow, in key order, so a
 * missing nutrient is simply absent ("not recorded"), never zero. Rows cover exactly the foods in the catalog.
 */

import { promises as fs } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { readZipEntries, rowsAsObjects, textFromEntry } from './lib/usda-zip.mjs'

const DEFAULT_OUTPUT = resolve('public/data/usda-nutrients-v1.json')
const DEFAULT_CATALOG = resolve('public/data/usda-common-v2.json')
const SOURCE_LABEL = 'USDA SR Legacy 2018-04'

/** App key -> SR Legacy nutrient ids (verified against nutrient.csv in the archive) and unit. Order is the file's key order. */
export const NUTRIENT_MAP = [
  { key: 'fiber', ids: ['1079'], unit: 'G' }, // Fiber, total dietary
  { key: 'sugar', ids: ['2000'], unit: 'G' }, // Sugars, Total
  { key: 'satFat', ids: ['1258'], unit: 'G' }, // Fatty acids, total saturated
  { key: 'monoFat', ids: ['1292'], unit: 'G' }, // Fatty acids, total monounsaturated
  { key: 'polyFat', ids: ['1293'], unit: 'G' }, // Fatty acids, total polyunsaturated
  { key: 'transFat', ids: ['1257'], unit: 'G' }, // Fatty acids, total trans
  { key: 'cholesterol', ids: ['1253'], unit: 'MG' },
  { key: 'sodium', ids: ['1093'], unit: 'MG' },
  { key: 'potassium', ids: ['1092'], unit: 'MG' },
  { key: 'calcium', ids: ['1087'], unit: 'MG' },
  { key: 'iron', ids: ['1089'], unit: 'MG' },
  { key: 'magnesium', ids: ['1090'], unit: 'MG' },
  { key: 'phosphorus', ids: ['1091'], unit: 'MG' },
  { key: 'zinc', ids: ['1095'], unit: 'MG' },
  { key: 'copper', ids: ['1098'], unit: 'MG' },
  { key: 'manganese', ids: ['1101'], unit: 'MG' },
  { key: 'selenium', ids: ['1103'], unit: 'UG' },
  { key: 'vitaminA', ids: ['1106'], unit: 'UG' }, // Vitamin A, RAE
  { key: 'vitaminC', ids: ['1162'], unit: 'MG' }, // total ascorbic acid
  { key: 'vitaminD', ids: ['1114'], unit: 'UG' }, // D2 + D3, micrograms (not the IU row 1110)
  { key: 'vitaminE', ids: ['1109'], unit: 'MG' }, // alpha-tocopherol
  { key: 'vitaminK', ids: ['1185'], unit: 'UG' }, // phylloquinone
  { key: 'thiamin', ids: ['1165'], unit: 'MG' },
  { key: 'riboflavin', ids: ['1166'], unit: 'MG' },
  { key: 'niacin', ids: ['1167'], unit: 'MG' },
  { key: 'vitaminB6', ids: ['1175'], unit: 'MG' },
  { key: 'folate', ids: ['1190'], unit: 'UG' }, // Folate, DFE
  { key: 'vitaminB12', ids: ['1178'], unit: 'UG' },
  { key: 'choline', ids: ['1180'], unit: 'MG' }, // Choline, total
  { key: 'caffeine', ids: ['1057'], unit: 'MG' },
  { key: 'alcohol', ids: ['1018'], unit: 'G' }, // Alcohol, ethyl
  { key: 'water', ids: ['1051'], unit: 'G' },
  // ALA + EPA + DHA. Most SR Legacy foods carry only the undifferentiated "PUFA 18:3" row (1270), not the ALA row (1404); 18:3 in
  // foods is overwhelmingly ALA (n-3), so 1404 is used when present and 1270 stands in for it otherwise. See omega3Of below.
  { key: 'omega3', ids: ['1404', '1270', '1278', '1272'], unit: 'G', custom: 'omega3' },
]

const parseArgs = (args) => {
  let zipPath
  let outputPath = DEFAULT_OUTPUT
  let catalogPath = DEFAULT_CATALOG
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--zip') zipPath = args[++index]
    else if (arg === '--output') outputPath = resolve(args[++index])
    else if (arg === '--catalog') catalogPath = resolve(args[++index])
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/build-usda-nutrients.mjs --zip path [--catalog path] [--output path]')
      process.exit(0)
    } else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!zipPath) throw new Error('Pass the SR Legacy CSV archive with --zip <path>.')
  return { zipPath: resolve(zipPath), outputPath, catalogPath }
}

/** Three significant figures, never fewer than the digits left of the point. Keeps the file small without visible error. */
export const roundValue = (value) => {
  if (value === 0) return 0
  const digits = Math.floor(Math.log10(Math.abs(value))) + 1
  const decimals = Math.max(0, 3 - digits)
  return Number(value.toFixed(decimals))
}

/**
 * Omega-3 in g per 100 g from the nutrient values of one food: ALA (1404, else the generic 18:3 row 1270) + EPA (1278) + DHA (1272).
 * Emitted when any component is present and the sum is above zero, or when every present component is a true zero and ALA (or 1270)
 * was measured (then 0). EPA/DHA zeros with no ALA say nothing about omega-3, so the food has no value.
 */
export const omega3Of = (values) => {
  const ala = values.has('1404') ? values.get('1404') : values.get('1270')
  const parts = [ala, values.get('1278'), values.get('1272')].filter((part) => part !== undefined)
  if (parts.length === 0) return undefined
  const sum = parts.reduce((total, part) => total + part, 0)
  if (sum > 0) return sum
  return ala !== undefined ? 0 : undefined
}

export const buildNutrients = async (zipPath, catalogPath) => {
  const entries = await readZipEntries(zipPath)
  const nutrientRows = rowsAsObjects(textFromEntry(entries, 'nutrient.csv'))
  const units = new Map(nutrientRows.map((row) => [row.id, row.unit_name.toUpperCase()]))
  for (const spec of NUTRIENT_MAP) {
    for (const id of spec.ids) {
      if (units.get(id) !== spec.unit) throw new Error(`Nutrient ${id} for ${spec.key} is ${units.get(id)} in the archive, expected ${spec.unit}.`)
    }
  }
  const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'))
  const wanted = new Set(catalog.map((food) => String(food.fdcId)))
  const idToSpec = new Map()
  NUTRIENT_MAP.forEach((spec, index) => spec.ids.forEach((id) => idToSpec.set(id, { spec, index })))

  const byFood = new Map()
  for (const row of rowsAsObjects(textFromEntry(entries, 'food_nutrient.csv'))) {
    if (!wanted.has(row.fdc_id)) continue
    const hit = idToSpec.get(row.nutrient_id)
    if (!hit) continue
    const value = Number(row.amount)
    if (!(Number.isFinite(value) && value >= 0) || row.amount === '') continue
    let values = byFood.get(row.fdc_id)
    if (!values) byFood.set(row.fdc_id, (values = new Map()))
    const slot = values.get(row.nutrient_id)
    // First valid row wins, as in the catalog build.
    if (slot === undefined) values.set(row.nutrient_id, value)
  }

  const rows = []
  for (const food of [...catalog].sort((a, b) => a.fdcId - b.fdcId)) {
    const values = byFood.get(String(food.fdcId))
    if (!values) continue
    let mask = 0
    const out = []
    NUTRIENT_MAP.forEach((spec, index) => {
      const present = spec.ids.filter((id) => values.has(id))
      if (present.length === 0) return
      const total = spec.custom === 'omega3' ? omega3Of(values) : values.get(present[0])
      if (total === undefined) return
      mask += 2 ** index
      out.push(roundValue(total))
    })
    if (out.length > 0) rows.push([food.fdcId, mask, ...out])
  }
  return { version: 1, source: SOURCE_LABEL, keys: NUTRIENT_MAP.map((spec) => spec.key), rows }
}

const main = async () => {
  const { zipPath, outputPath, catalogPath } = parseArgs(process.argv.slice(2))
  const table = await buildNutrients(zipPath, catalogPath)
  await fs.mkdir(dirname(outputPath), { recursive: true })
  const text = `${JSON.stringify(table)}\n`
  await fs.writeFile(outputPath, text, 'utf8')
  const omega = table.keys.indexOf('omega3')
  const withOmega3 = table.rows.filter((row) => Math.floor(row[1] / 2 ** omega) % 2 === 1).length
  console.log(`omega3 = ALA (nutrient 1404, else the generic PUFA 18:3 row 1270) + EPA + DHA: ${withOmega3} foods have a value`)
  console.log(`Wrote ${table.rows.length} foods x ${table.keys.length} nutrients (${Buffer.byteLength(text)} bytes) to ${outputPath}`)
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
