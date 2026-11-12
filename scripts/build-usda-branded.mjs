#!/usr/bin/env node

/**
 * Build a self-hosted, searchable index of US branded packaged foods from the USDA FoodData Central "Branded Foods" CSV release
 * (public domain, CC0). Source archive and sha256: see CLAUDE.md. Streams the CSVs (never loads one whole), has no dependencies
 * beyond Node built-ins and produces the same bytes every run.
 *
 * Usage:
 *   node --max-old-space-size=4096 scripts/build-usda-branded.mjs --dir /path/to/extracted/csv [--out public/data/branded-v1] [--quiet]
 *
 * Output (under --out, default public/data/branded-v1):
 *   manifest.json              JSON, fetched once and cached: where every shard lives, plus the small word lists search needs
 *   branded-pNN-<sha12>.bin    PACK files (<= 25 MB each): individually gzip-compressed shards, concatenated
 * The manifest maps a shard to [pack index, byte offset, byte length]; the client reads one shard with an HTTP Range request and
 * gunzips it. Pack file names carry the first 12 hex digits of their SHA-256 (pinned by src/lib/invariants.test.ts).
 *
 * Five kinds of shard (the client in src/catalog/branded.ts reads them; the formats are written out at each encoder below):
 *   detail     full records in GTIN order (barcode lookup, product page)
 *   summaries  one line per product, stored ONCE, in "ordinal" (= GTIN) order, in blocks of SUMMARY_BLOCK_ROWS: the products of one
 *              manufacturer share a GTIN prefix, so a brand query reads one or two blocks
 *   pop        one byte per ordinal (popularity level 0..7), one shard: ranks a candidate set before any summary is read
 *   posts      for every search token, the ordinals of its products as delta varints; shards are consecutive token ranges
 *   heads      for every token with more than HEAD_MIN products, the summary lines of its best products (popularity decides, since
 *              GTIN order cannot); answers one-word queries, and ranks the biggest match sets of longer ones
 */

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { streamCsv } from './lib/csv-stream.mjs'
import {
  barcodeDigits, checkDigitFor, cleanBrand, cleanHousehold, cleanName, compoundTokens, consumerKeyOfCase, expandUpcE, gtinKey,
  hasValidCheckDigit, householdAmount, indexTokensOf, isLocalKey, popularityOf, rowScore, searchTokens, servingLabel, tidySpaces,
} from './lib/branded-text.mjs'

export * from './lib/branded-text.mjs'

export const FORMAT_VERSION = 2
export const SOURCE_LABEL = 'USDA FoodData Central Branded Foods 2026-10-29'
export const DEFAULT_OUT = resolve('public/data/branded-v1')
export const SUMMARY_BLOCK_ROWS = 500
export const HEAD_MIN = 300
export const HEAD_ROWS = 200
/** Levels of the popularity shard (popQ / 4): coarse on purpose, it only picks which summary blocks to read. */
export const POP_LEVELS = 8
/** Adjacent word pairs with more than this many products get a head of their own: a RANKING aid for big match sets only (matching is exact). */
export const PAIR_MIN = 1000
export const PAIR_ROWS = 100
export const POSTS_SHARD_BYTES = 32_000
/** A token whose postings are longer than this (bytes) gets a shard of its own, so one Range reads it. */
export const POSTS_OWN_SHARD_BYTES = 6_000
export const HEADS_SHARD_BYTES = 120_000
export const DETAIL_SHARD_BYTES = 110_000
/** Most live records of one UPC examined (newest first) before giving up. */
const WALK_LIMIT = 5

// ---------------------------------------------------------------------------------------------------------------------
// Nutrients
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Optional nutrients, in mask-bit order. `key` is the app key in src/lib/nutrients.ts (addedSugar is the one extra: the app has no
 * field for it yet, so it rides along in the record). `ids` are FoodData Central nutrient ids (units checked against nutrient.csv).
 * Everything is per 100 g (per 100 ml for a liquid serving) in the unit of the app key.
 */
export const OPTIONAL_NUTRIENTS = [
  { key: 'fiber', ids: ['1079'], unit: 'G' },
  { key: 'sugar', ids: ['2000'], unit: 'G' },
  { key: 'satFat', ids: ['1258'], unit: 'G' },
  { key: 'monoFat', ids: ['1292'], unit: 'G' },
  { key: 'polyFat', ids: ['1293'], unit: 'G' },
  { key: 'transFat', ids: ['1257'], unit: 'G' },
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
  { key: 'vitaminA', ids: ['1106'], unit: 'UG' }, // RAE only: the IU row (1104) cannot be converted without knowing the source (retinol or carotene)
  { key: 'vitaminC', ids: ['1162'], unit: 'MG' },
  { key: 'vitaminD', ids: ['1114', '1110'], unit: 'UG', iuFallback: { id: '1110', divisor: 40, unit: 'IU' } }, // mcg, else IU / 40
  { key: 'vitaminE', ids: ['1109'], unit: 'MG' },
  { key: 'vitaminK', ids: ['1185'], unit: 'UG' },
  { key: 'thiamin', ids: ['1165'], unit: 'MG' },
  { key: 'riboflavin', ids: ['1166'], unit: 'MG' },
  { key: 'niacin', ids: ['1167'], unit: 'MG' },
  { key: 'vitaminB6', ids: ['1175'], unit: 'MG' },
  { key: 'folate', ids: ['1190', '1177'], unit: 'UG' }, // DFE (1190), else total folate (1177),
  { key: 'vitaminB12', ids: ['1178'], unit: 'UG' },
  { key: 'choline', ids: ['1180'], unit: 'MG' },
  { key: 'caffeine', ids: ['1057'], unit: 'MG' },
  { key: 'alcohol', ids: ['1018'], unit: 'G' },
  { key: 'water', ids: ['1051'], unit: 'G' },
  { key: 'omega3', ids: ['1404', '1270', '1278', '1272'], unit: 'G', custom: 'omega3' },
  { key: 'addedSugar', ids: ['1235'], unit: 'G' },
]
export const CORE_KEYS = ['kcal', 'protein', 'fat', 'carbs']
const KJ_PER_KCAL = 4.184
/** Detail-row flag bits. */
export const FLAG_ML = 1
export const FLAG_LABEL_ROUNDED = 2
export const FLAG_DISCONTINUED = 4

/** Three significant figures, never fewer than the digits left of the point (same rule as usda-nutrients-v1). */
export const roundValue = (value) => {
  if (value === 0) return 0
  const digits = Math.floor(Math.log10(Math.abs(value))) + 1
  return Number(value.toFixed(Math.max(0, 3 - digits)))
}

// ---------------------------------------------------------------------------------------------------------------------
// Serving and sanity rules (pure: tested directly)
// ---------------------------------------------------------------------------------------------------------------------

const GRAM_UNITS = new Set(['G', 'GRM', 'GM', 'MG']) // "MG" is a mislabelled gram in this dataset: 61.0 MG "2/3 cup"
const ML_UNITS = new Set(['ML', 'MLT'])
const MAX_SERVING_KCAL = 1200

/**
 * Normalise the serving of a branded_food row to grams or millilitres.
 * Returns { size, unit, note } where size 0 means "no usable serving" and `note` is one of: undefined, 'unitGuessed' (IU/MC/none:
 * taken as grams because it is plausible), 'unitDropped', 'fromHousehold' (household text states another amount: that one wins),
 * 'householdDropped' (they disagree and the household amount is implausible), 'implausible' (too many kcal per serving).
 * `kcal` is per 100 g/ml.
 */
export const normalizeServing = (sizeText, unitText, household, kcal) => {
  const unit = String(unitText ?? '').trim().toUpperCase()
  let size = Number(sizeText)
  const kind = ML_UNITS.has(unit) ? 'ml' : 'g'
  let note
  if (!(size >= 0.1) || !Number.isFinite(size)) return { size: 0, unit: kind }
  if (!GRAM_UNITS.has(unit) && !ML_UNITS.has(unit)) {
    // IU, MC, no unit: a gram amount only when plausible.
    if (size >= 1 && size <= 1000 && (kcal * size) / 100 <= MAX_SERVING_KCAL) note = 'unitGuessed'
    else return { size: 0, unit: 'g', note: 'unitDropped' }
  }
  const stated = householdAmount(household, kind)
  if (Number.isFinite(stated) && stated > 0 && (size / stated > 1.5 || stated / size > 1.5)) {
    if ((kcal * stated) / 100 <= MAX_SERVING_KCAL) { size = stated; note = 'fromHousehold' } else return { size: 0, unit: kind, note: 'householdDropped' }
  }
  if ((kcal * size) / 100 > MAX_SERVING_KCAL || size > 5000) return { size: 0, unit: kind, note: 'implausible' }
  return { size: Number(size.toFixed(2)), unit: kind, note }
}

/** Energy estimate per 100 g from the macros: 4P + 4(C - fibre - polyols) + 2 fibre + 2.4 polyols + 9F + 7 alcohol. */
export const atwaterEstimate = (protein, fat, carbs, fiber = 0, polyols = 0, alcohol = 0) => {
  const fibre = Math.min(fiber, carbs)
  const poly = Math.min(polyols, carbs - fibre)
  return 4 * protein + 4 * (carbs - fibre - poly) + 2 * fibre + 2.4 * poly + 9 * fat + 7 * alcohol
}

/**
 * Why a product is dropped, or undefined when it is sane. Values per 100 g (ml). `servingSize` is the label serving in g/ml (0 = none).
 * kcal cap 935 when fat >= 95 g (pure oils), else 902; macros may sum to 110 g when the serving is 15 g or less (rounding on the label);
 * the Atwater test is skipped for servings under 5 g and for labels that say 0 kcal.
 */
export const sanityProblem = (kcal, protein, fat, carbs, extra = {}) => {
  const { alcohol = 0, fiber = 0, polyols = 0, servingSize = 0 } = extra
  if (kcal > (fat >= 95 ? 935 : 902)) return 'kcalOver902'
  if (protein + fat + carbs > (servingSize > 0 && servingSize <= 15 ? 110 : 105)) return 'macrosOver105'
  if (kcal === 0 || (servingSize > 0 && servingSize < 5)) return undefined
  const estimate = atwaterEstimate(protein, fat, carbs, fiber, polyols, alcohol)
  const gap = Math.abs(kcal - estimate)
  if (gap > 0.4 * kcal && gap > 60) return 'atwaterMismatch'
  return undefined
}

/** A label that rounds to 0 kcal per serving although the food is not energy-free (a spray, a sweetener packet). */
export const isLabelRounded = (kcal, servingSize, category, name) => {
  if (!(servingSize > 0)) return false
  const perServing = (kcal * servingSize) / 100
  if (perServing >= 3) return false
  if (kcal >= 100) return true
  return kcal === 0 && /\b(oil|spray|shortening|lard|butter|margarine)\b/i.test(`${category} ${name}`)
}

// ---------------------------------------------------------------------------------------------------------------------
// Pass A: branded_food.csv
// ---------------------------------------------------------------------------------------------------------------------

/** A fresh copy of a string: slices of a 4 MB read chunk would otherwise keep the whole chunk alive for every retained value. */
const own = (text) => (text.length < 13 ? text : Buffer.from(text, 'utf8').toString('utf8'))
const countIn = (stats, key, by = 1) => { stats[key] = (stats[key] ?? 0) + by }
const dateInt = (text) => (text && text.length >= 8 ? Number(text.replace(/-/g, '').slice(0, 8)) || 0 : 0)
const byRecency = (a, b) => b.available - a.available || b.modified - a.modified || b.fdc - a.fdc

/** All United States rows of branded_food.csv with a usable barcode. */
const readBranded = async (dir, stats) => {
  const records = []
  const interned = new Map()
  const intern = (text) => {
    if (text === '') return ''
    let value = interned.get(text)
    if (value === undefined) { value = own(text); interned.set(value, value) }
    return value
  }
  let columns
  await streamCsv(join(dir, 'branded_food.csv'), {
    onHeader: (header) => { columns = Object.fromEntries(header.map((name, index) => [name, index])) },
    onRow: (row) => {
      countIn(stats, 'brandedRows')
      const country = row[columns.market_country]
      if (country !== 'United States' && country !== 'US') { countIn(stats, 'droppedNotUS'); return }
      const digits = barcodeDigits(row[columns.gtin_upc])
      if (!digits) { countIn(stats, 'droppedBadGtin'); return }
      records.push({
        fdc: Number(row[columns.fdc_id]),
        digits,
        key: '',
        available: dateInt(row[columns.available_date]),
        modified: dateInt(row[columns.modified_date]),
        discontinued: row[columns.discontinued_date] !== '',
        sizeText: row[columns.serving_size],
        unitText: intern(row[columns.serving_size_unit]),
        household: intern(row[columns.household_serving_fulltext]),
        brandName: intern(row[columns.brand_name]),
        brandOwner: intern(row[columns.brand_owner]),
        category: intern(row[columns.branded_food_category]),
      })
    },
  })
  return records
}

/**
 * Give every record its final 14-digit key and group records into one pool per key.
 *  1. gtinKey: pad to 14 digits; a 10/11-digit code with a wrong check digit lost its check digit, so it is completed.
 *  2. UPC-E (8 digits) whose UPC-A expansion is a key of its own joins that key.
 *  3. A case-level GTIN-14 (indicator 1-8) with no consumer-unit key of its own is filed under the consumer key derived from it.
 */
export const poolRecords = (records, stats = {}) => {
  const keys = new Set()
  for (const record of records) {
    const made = gtinKey(record.digits)
    record.key = made.key
    if (made.completed) countIn(stats, 'checkDigitCompleted')
    keys.add(made.key)
  }
  const original = new Set(keys)
  for (const record of records) {
    if (record.digits.length === 8) {
      const expanded = expandUpcE(record.digits)
      if (expanded && hasValidCheckDigit(expanded)) {
        const twin = expanded.padStart(14, '0')
        if (twin !== record.key && original.has(twin)) { record.key = twin; countIn(stats, 'upcEMerged'); continue }
      }
    }
    const consumer = consumerKeyOfCase(record.key)
    if (consumer && !original.has(consumer)) { record.key = consumer; countIn(stats, 'caseRekeyed') }
  }
  const pools = new Map()
  for (const record of records) {
    const pool = pools.get(record.key)
    if (pool) pool.push(record); else pools.set(record.key, [record])
  }
  for (const pool of pools.values()) pool.sort(byRecency)
  return pools
}

/** Pass B: descriptions of the wanted foods. */
const readDescriptions = async (dir, wanted) => {
  const names = new Map()
  await streamCsv(join(dir, 'food.csv'), {
    maxColumns: 3,
    onRow: (row) => {
      const fdc = Number(row[0])
      if (wanted.has(fdc)) names.set(fdc, own(row[2]))
    },
  })
  return names
}

/** Check every nutrient id we read against nutrient.csv units, so a changed release fails loudly. */
const checkUnits = async (dir) => {
  const units = new Map()
  let columns
  await streamCsv(join(dir, 'nutrient.csv'), {
    onHeader: (header) => { columns = Object.fromEntries(header.map((name, index) => [name, index])) },
    onRow: (row) => units.set(row[columns.id], row[columns.unit_name].toUpperCase()),
  })
  const expect = (id, unit, what) => { if (units.get(id) !== unit) throw new Error(`Nutrient ${id} (${what}) is ${units.get(id)} in nutrient.csv, expected ${unit}.`) }
  expect('1008', 'KCAL', 'energy'); expect('1062', 'KJ', 'energy kJ'); expect('1003', 'G', 'protein'); expect('1004', 'G', 'fat'); expect('1005', 'G', 'carbs')
  expect('1086', 'G', 'total sugar alcohols')
  for (const spec of OPTIONAL_NUTRIENTS) {
    for (const id of spec.ids) expect(id, spec.iuFallback && id === spec.iuFallback.id ? spec.iuFallback.unit : spec.unit, spec.key)
  }
}

const RAW_IDS = (() => {
  const ids = ['1008', '1062', '1003', '1004', '1005', '1086']
  for (const spec of OPTIONAL_NUTRIENTS) for (const id of spec.ids) if (!ids.includes(id)) ids.push(id)
  return ids
})()

/** Pass C: raw per-100 amounts of the wanted nutrients. The first valid row of a (food, nutrient) wins. */
const readNutrients = async (dir, slots) => {
  const columnOf = new Map(RAW_IDS.map((id, index) => [id, index]))
  const width = RAW_IDS.length
  const matrix = new Float64Array(slots.size * width).fill(Number.NaN)
  let columns
  await streamCsv(join(dir, 'food_nutrient.csv'), {
    maxColumns: 4,
    onHeader: (header) => { columns = Object.fromEntries(header.map((name, index) => [name, index])) },
    onRow: (row) => {
      const column = columnOf.get(row[columns.nutrient_id])
      if (column === undefined) return
      const slot = slots.get(Number(row[columns.fdc_id]))
      if (slot === undefined) return
      const text = row[columns.amount]
      if (text === '') return
      const amount = Number(text)
      if (!(amount >= 0) || !Number.isFinite(amount)) return
      const cell = slot * width + column
      if (Number.isNaN(matrix[cell])) matrix[cell] = amount
    },
  })
  return { matrix, width, columnOf }
}

/** Optional nutrients of one food (array parallel to OPTIONAL_NUTRIENTS, undefined = absent). */
const optionalValues = (get) => OPTIONAL_NUTRIENTS.map((spec) => {
  if (spec.custom === 'omega3') {
    const ala = get('1404') ?? get('1270')
    const parts = [ala, get('1278'), get('1272')].filter((part) => part !== undefined)
    if (parts.length === 0) return undefined
    const sum = parts.reduce((total, part) => total + part, 0)
    return sum > 0 ? sum : ala !== undefined ? 0 : undefined
  }
  const direct = get(spec.ids[0])
  if (direct !== undefined) return direct
  if (spec.key === 'folate') return get('1177') // total folate when there is no DFE
  if (spec.iuFallback) { const iu = get(spec.iuFallback.id); if (iu !== undefined) return iu / spec.iuFallback.divisor }
  return undefined
})

// ---------------------------------------------------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Judge one record. Returns { problem } or { product } (the product without name/brand cleaning, which needs the description).
 * `get(id)` returns the raw per-100 amount or undefined.
 */
export const judgeRecord = (record, get, stats) => {
  let kcal = get('1008')
  const protein = get('1003')
  const fat = get('1004')
  const carbs = get('1005')
  const opt = optionalValues(get)
  const optOf = (key) => opt[OPTIONAL_NUTRIENTS.findIndex((spec) => spec.key === key)]
  const polyols = get('1086') ?? 0
  const fiber = get('1079') ?? 0
  const alcohol = optOf('alcohol') ?? 0
  let derived = false
  if (kcal === undefined) {
    const kj = get('1062')
    if (kj !== undefined) { kcal = kj / KJ_PER_KCAL; countIn(stats, 'energyFromKj') }
    else if (protein !== undefined && fat !== undefined && carbs !== undefined) { kcal = atwaterEstimate(protein, fat, carbs, fiber, polyols, alcohol); derived = true }
    else return { problem: 'noEnergy' }
  }
  let macros = { protein, fat, carbs }
  if (protein === undefined || fat === undefined || carbs === undefined) {
    if (kcal > 5) return { problem: 'missingMacro' }
    macros = { protein: protein ?? 0, fat: fat ?? 0, carbs: carbs ?? 0 }
  }
  const serving = normalizeServing(record.sizeText, record.unitText, record.household, kcal)
  const problem = sanityProblem(kcal, macros.protein, macros.fat, macros.carbs, { alcohol, fiber, polyols, servingSize: serving.size })
  if (problem) return { problem }
  return { kcal, derived, macros, opt, serving, assumedMacros: protein === undefined || fat === undefined || carbs === undefined }
}

/**
 * Stream the CSVs and return the kept products (sorted by GTIN) and a stats object. A product:
 *   { gtin, fdc, name, brand, category, size, unit, household, flags, kcal, protein, fat, carbs, opt: [value|undefined per OPTIONAL_NUTRIENTS], records }
 */
export const loadProducts = async (dir, log = () => {}, { dropped } = {}) => {
  const stats = {}
  await checkUnits(dir)
  log('pass A: branded_food.csv')
  const records = await readBranded(dir, stats)
  const pools = poolRecords(records, stats)
  stats.upcsWithUsRecord = pools.size
  log(`  ${records.length} US rows, ${pools.size} UPCs`)
  const sortedKeys = [...pools.keys()].sort()
  const candidates = new Map() // key -> live records to walk
  const slots = new Map()
  for (const key of sortedKeys) {
    const pool = pools.get(key)
    // Live records first (newest to oldest), then discontinued ones: USDA's flag is a listing status, the food is still in people's homes.
    const live = pool.filter((record) => !record.discontinued).slice(0, WALK_LIMIT)
    const old = pool.filter((record) => record.discontinued).slice(0, WALK_LIMIT)
    if (pool[0].discontinued) countIn(stats, 'upcsNewestDiscontinued')
    countIn(stats, 'recordsOlderThanNewest', pool.length - 1)
    const walk = [...live, ...old]
    candidates.set(key, walk)
    for (const record of walk) slots.set(record.fdc, slots.size)
  }
  log('pass B: food.csv')
  const names = await readDescriptions(dir, slots)
  log('pass C: food_nutrient.csv')
  const { matrix, width, columnOf } = await readNutrients(dir, slots)
  const products = []
  for (const [key, live] of candidates) {
    let first
    let kept
    let zeroFallback
    for (let index = 0; index < live.length; index += 1) {
      const record = live[index]
      const slot = slots.get(record.fdc)
      const get = (id) => { const value = matrix[slot * width + columnOf.get(id)]; return Number.isNaN(value) ? undefined : value }
      const description = names.get(record.fdc)
      let judged
      if (!description || !tidySpaces(description)) judged = { problem: 'noName' }
      else if (isLocalKey(key) && !record.brandName && !record.brandOwner) judged = { problem: 'localCodeNoBrand' }
      else judged = judgeRecord(record, get, stats)
      if (judged.problem) { first ??= judged.problem; continue }
      // A record whose energy and macros are all 0 loses to an older record of the same GTIN that has values (a bad newest record).
      if (judged.kcal === 0 && judged.macros.protein === 0 && judged.macros.fat === 0 && judged.macros.carbs === 0 && index < live.length - 1) {
        zeroFallback ??= { record, judged, description, index }
        continue
      }
      kept = { record, judged, description }
      if (index > 0) countIn(stats, 'rescuedByOlderRecord')
      if (record.discontinued) countIn(stats, 'keptFromDiscontinuedRecord')
      break
    }
    const keptIsZero = kept && kept.judged.kcal === 0 && kept.judged.macros.protein === 0 && kept.judged.macros.fat === 0 && kept.judged.macros.carbs === 0
    if (zeroFallback && (!kept || keptIsZero)) kept = zeroFallback // every record is all zero: the newest one stands
    else if (kept && zeroFallback) countIn(stats, 'zeroRecordReplacedByOlder')
    if (!kept) {
      countIn(stats, `dropped_${first}`)
      dropped?.push({ gtin: key, fdc: live[0].fdc, brand: live[0].brandName || live[0].brandOwner, name: names.get(live[0].fdc) ?? '', reason: first })
      continue
    }
    const { record, judged, description } = kept
    const { serving } = judged
    if (judged.derived) countIn(stats, 'energyDerivedFromMacros')
    if (judged.assumedMacros) countIn(stats, 'macrosAssumedZero')
    if (serving.note) countIn(stats, `serving_${serving.note}`)
    if (record.unitText.toUpperCase() === 'MG') countIn(stats, 'serving_mgTreatedAsGrams')
    if (!(serving.size > 0)) countIn(stats, 'flaggedServingMissing')
    const name = cleanName(description, serving)
    const category = tidySpaces(record.category)
    const kcal = judged.kcal
    const labelRounded = isLabelRounded(kcal, serving.size, category, name)
    if (labelRounded) countIn(stats, 'labelRounded')
    if (isLocalKey(key)) countIn(stats, 'localCodesKept')
    products.push({
      gtin: key,
      fdc: record.fdc,
      name,
      brand: cleanBrand(record.brandName, record.brandOwner),
      category,
      size: serving.size,
      unit: serving.unit,
      household: serving.size > 0 ? cleanHousehold(record.household) : undefined,
      flags: (serving.unit === 'ml' ? FLAG_ML : 0) | (labelRounded ? FLAG_LABEL_ROUNDED : 0) | (pools.get(key)[0].discontinued ? FLAG_DISCONTINUED : 0),
      kcal: roundValue(kcal),
      protein: roundValue(judged.macros.protein),
      fat: roundValue(judged.macros.fat),
      carbs: roundValue(judged.macros.carbs),
      opt: judged.opt.map((value) => (value === undefined ? undefined : roundValue(value))),
      records: pools.get(key).length,
    })
  }
  stats.productsKept = products.length
  return { products, stats }
}

// ---------------------------------------------------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------------------------------------------------

const gzip = (input) => gzipSync(typeof input === 'string' ? Buffer.from(input, 'utf8') : input, { level: 9 })
const base36 = (value) => value.toString(36)

/** Unsigned LEB128 varint appended to `bytes` (a plain array). */
export const pushVarint = (bytes, value) => {
  let rest = value
  while (rest >= 128) { bytes.push((rest % 128) | 128); rest = Math.floor(rest / 128) }
  bytes.push(rest)
}

// ---------------------------------------------------------------------------------------------------------------------
// Detail shards
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Detail shard: a JSON array of rows, sorted by GTIN, for consecutive products.
 *   row = [gtinDelta, fdcId, name, brand, categoryIndex, size, flags, household, kcal, protein, fat, carbs, mask, ...optional values]
 * gtinDelta is the GTIN minus the previous row's (the first row's is the GTIN itself, which equals the shard's start in the manifest).
 * `size` 0 means the label has no serving; flags bit 0 = per 100 ml, bit 1 = label rounds to 0 kcal per serving; `household` is ''
 * when there is none; bit i of `mask` says OPTIONAL_NUTRIENTS[i] has a value and only present values follow, in order.
 */
export const encodeDetailRows = (products, categories) => {
  const rows = []
  let previous = 0
  for (const product of products) {
    const gtin = Number(product.gtin)
    let mask = 0
    const values = []
    product.opt.forEach((value, index) => { if (value !== undefined) { mask += 2 ** index; values.push(value) } })
    rows.push([gtin - previous, product.fdc, product.name, product.brand, categories.get(product.category) ?? -1, product.size, product.flags, product.household ?? '', product.kcal, product.protein, product.fat, product.carbs, mask, ...values])
    previous = gtin
  }
  return JSON.stringify(rows)
}

/** Split products (sorted by GTIN) into detail shards of about `targetRawBytes` of JSON each. */
export const planDetailShards = (products, categories, targetRawBytes) => {
  const shards = []
  let start = 0
  let bytes = 0
  for (let index = 0; index < products.length; index += 1) {
    const product = products[index]
    bytes += product.name.length + product.brand.length + (product.household?.length ?? 0) + 60 + product.opt.filter((value) => value !== undefined).length * 5
    if (bytes >= targetRawBytes || index === products.length - 1) {
      shards.push({ start: products[start].gtin, products: products.slice(start, index + 1) })
      start = index + 1
      bytes = 0
    }
  }
  return shards.map((shard) => ({ ...shard, text: encodeDetailRows(shard.products, categories) }))
}

// ---------------------------------------------------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------------------------------------------------

/** The label of the serving shown in a summary: "1 bar (40 g)", capped so one odd product cannot bloat a block. */
export const summaryServing = (product) => {
  const label = servingLabel(product.household, product.size, product.unit) ?? ''
  return label.length > 28 ? label.slice(0, 27).trimEnd() + '…' : label
}

/**
 * Summary line (tab separated): gtin (base 36, a signed difference from the previous line of the block; the block's first line is
 * absolute), name, brand, kcal per 100 g/ml, serving label, popularity (base 36, quarter units), "1" when per 100 ml, category index
 * (base 36), sizes (how many products share this brand and name: '' for 1), and (heads only) nothing more.
 */
export const summaryLine = (product, previousGtin, ctx) => {
  const gtin = Number(product.gtin)
  return [
    base36(gtin - previousGtin), product.name, product.brand, Math.round(product.kcal), summaryServing(product), base36(product.popQ),
    product.unit === 'ml' ? '1' : '', base36(ctx.categories.get(product.category) ?? 0), ctx.groupSize.get(product.group) > 1 ? String(ctx.groupSize.get(product.group)) : '',
  ].join('\t')
}

/** Lines of a block of products, in order. */
export const encodeSummaryBlock = (products, ctx) => {
  let previous = 0
  const lines = []
  for (const product of products) {
    lines.push(summaryLine(product, previous, ctx))
    previous = Number(product.gtin)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------------------------------------------------
// Search index
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Attach ordinals: the position in GTIN order. Adds `pop`, `popQ`, `group`, `ordinal`.
 * pop = log(1 + historical records of the GTIN) + log(1 + products of the brand) / 2, quantised to quarter units.
 */
export const isAllZero = (product) => product.kcal === 0 && product.protein === 0 && product.fat === 0 && product.carbs === 0

/** The sizes of a group are its distinct (energy, serving) pairs: two products with the same label and numbers are one size. */
const sizeSignature = (product) => `${Math.round(product.kcal)}|${summaryServing(product)}|${product.unit}`

export const assignOrdinals = (products) => {
  const brandCount = new Map()
  for (const product of products) { const key = product.brand.toLowerCase(); brandCount.set(key, (brandCount.get(key) ?? 0) + 1) }
  const members = new Map()
  for (const product of products) {
    product.group = `${product.name.toLowerCase()}|${product.brand.toLowerCase()}`
    const list = members.get(product.group)
    if (list) list.push(product); else members.set(product.group, [product])
  }
  // An all-zero product whose same-named siblings (80% or more) have values is a bad record: it ranks last, never represents a group,
  // and is left out of the heads and the size count. Its barcode still resolves.
  for (const list of members.values()) {
    if (list.length < 2) continue
    for (const product of list) {
      if (!isAllZero(product)) continue
      const others = list.filter((other) => other !== product)
      if (others.filter((other) => !isAllZero(other)).length / others.length >= 0.8) product.suspect = true
    }
  }
  const groupSize = new Map()
  for (const [group, list] of members) groupSize.set(group, new Set(list.filter((product) => !product.suspect).map(sizeSignature)).size)
  for (const product of products) {
    product.pop = popularityOf(product.records, brandCount.get(product.brand.toLowerCase()))
    product.popQ = product.suspect ? 0 : Math.min(255, Math.round(product.pop * 4))
  }
  const ordered = [...products].sort((a, b) => (a.gtin < b.gtin ? -1 : a.gtin > b.gtin ? 1 : 0))
  ordered.forEach((product, index) => { product.ordinal = index })
  return { ordered, groupSize }
}

/** Per-product token data shared by the postings, the heads and the brand lists. */
const tokenRow = (product) => {
  const brandCore = searchTokens(product.brand)
  const brandTokens = [...brandCore, ...compoundTokens(product.brand)]
  return { nameTokens: searchTokens(product.name), brandTokens, brandCore, pop: product.popQ / 4, category: product.category.toLowerCase() }
}

/** Postings for every token: Map token -> ascending ordinals. */
export const buildPostings = (ordered) => {
  const postings = new Map()
  for (const product of ordered) {
    for (const token of indexTokensOf(product.name, product.brand)) {
      const list = postings.get(token)
      if (list) list.push(product.ordinal); else postings.set(token, [product.ordinal])
    }
  }
  return postings
}

/** Delta varints of ascending ordinals (the first value is absolute). */
export const encodePostingList = (ordinals) => {
  const bytes = []
  let previous = 0
  for (const ordinal of ordinals) { pushVarint(bytes, ordinal - previous); previous = ordinal }
  return bytes
}

/**
 * Postings shard (binary, then gzipped): varint tokenCount, then per token (ascending) varint byteLength + UTF-8 token bytes,
 * varint df, varint dataLength, data (see encodePostingList). Every token lives in exactly one shard.
 */
export const buildPostsShards = (postings, targetBytes = POSTS_SHARD_BYTES, ownShardBytes = POSTS_OWN_SHARD_BYTES) => {
  const tokens = [...postings.keys()].sort()
  const shards = []
  let entries = []
  let size = 0
  const flush = () => {
    if (entries.length === 0) return
    const head = []
    pushVarint(head, entries.length)
    const buffer = Buffer.concat([Buffer.from(head), ...entries.map((entry) => entry.bytes)])
    shards.push({ first: entries[0].token, buffer, tokens: entries.length })
    entries = []
    size = 0
  }
  for (const token of tokens) {
    const list = postings.get(token)
    const data = encodePostingList(list)
    const tokenBytes = Buffer.from(token, 'utf8')
    const meta = []
    pushVarint(meta, tokenBytes.length)
    const afterToken = []
    pushVarint(afterToken, list.length)
    pushVarint(afterToken, data.length)
    const bytes = Buffer.concat([Buffer.from(meta), tokenBytes, Buffer.from(afterToken), Buffer.from(data)])
    const big = bytes.length > ownShardBytes
    if (big) flush()
    entries.push({ token, bytes })
    size += bytes.length
    if (big || size >= targetBytes) flush()
  }
  flush()
  return shards
}

/** Brand statistics: Map token -> [products with the token in the brand, products with it in the name]. */
export const brandStats = (rows) => {
  const stats = new Map()
  for (const row of rows) {
    for (const token of new Set(row.brandTokens)) { const entry = stats.get(token) ?? [0, 0]; entry[0] += 1; stats.set(token, entry) }
    for (const token of new Set(row.nameTokens)) { const entry = stats.get(token) ?? [0, 0]; entry[1] += 1; stats.set(token, entry) }
  }
  return stats
}

/** Token lists shipped in the manifest: brand-like tokens for typo repair, and the tokens that are mostly brand words (not generic). */
export const brandLists = (stats, limit = 5000) => {
  const alpha = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  const entries = [...stats.entries()].filter(([token]) => /^[a-z]{3,}$/.test(token))
  const tokens = entries.filter(([, [brand]]) => brand >= 2).sort((a, b) => b[1][0] - a[1][0] || alpha(a[0], b[0])).slice(0, limit).map(([token]) => token)
  const dominant = entries.filter(([, [brand, name]]) => brand >= 20 && brand >= 0.5 * (brand + name)).sort((a, b) => b[1][0] - a[1][0] || alpha(a[0], b[0])).slice(0, limit).map(([token]) => token)
  return { tokens: tokens.sort(), dominant: dominant.sort() }
}

/** Adjacent word pairs worth a head of their own: Map "a+b" -> ascending ordinals, for pairs in more than `min` products. */
export const buildPairs = (rows, min = PAIR_MIN) => {
  const sequenceOf = (row) => [...row.brandCore, ...row.nameTokens]
  const counts = new Map()
  rows.forEach((row) => {
    const seq = sequenceOf(row)
    const seen = new Set()
    for (let at = 0; at + 1 < seq.length; at += 1) {
      if (seq[at] === seq[at + 1]) continue
      const key = `${seq[at]}+${seq[at + 1]}`
      if (!seen.has(key)) { seen.add(key); counts.set(key, (counts.get(key) ?? 0) + 1) }
    }
  })
  const pairs = new Map()
  rows.forEach((row, ordinal) => {
    const seq = sequenceOf(row)
    const seen = new Set()
    for (let at = 0; at + 1 < seq.length; at += 1) {
      const key = `${seq[at]}+${seq[at + 1]}`
      if (seen.has(key) || (counts.get(key) ?? 0) <= min) continue
      seen.add(key)
      const list = pairs.get(key)
      if (list) list.push(ordinal); else pairs.set(key, [ordinal])
    }
  })
  return pairs
}

/**
 * Heads: for each token with more than `min` products, the lines of its best `rows` products (one per brand + name),
 * best = rowScore for that word with popularity as a tie-breaker. Very common adjacent word pairs get one too. Heads only rank: a query
 * of several words is always matched exactly from the postings.
 */
export const buildHeads = (ordered, postings, pairs, rows, dominant, ctx, { min = HEAD_MIN, headRows = HEAD_ROWS, pairRows = PAIR_ROWS } = {}) => {
  const heads = new Map()
  const dominantSet = new Set(dominant)
  const termOf = (token) => {
    const qualifier = /^\d/.test(token)
    return { variants: [token], prefix: false, generic: !qualifier && !dominantSet.has(token), qualifier }
  }
  const choose = (key, list, terms, limit) => {
    const scored = list.map((ordinal) => ({ ordinal, score: rowScore(rows[ordinal], terms) }))
    scored.sort((a, b) => b.score - a.score || a.ordinal - b.ordinal)
    const seen = new Set()
    const chosen = []
    for (const { ordinal } of scored) {
      const product = ordered[ordinal]
      if (product.suspect || seen.has(product.group)) continue
      seen.add(product.group)
      chosen.push(product)
      if (chosen.length >= limit) break
    }
    heads.set(key, chosen.map((product) => summaryLine(product, 0, ctx)).join('\n'))
  }
  for (const [token, list] of postings) if (list.length > min) choose(token, list, [termOf(token)], headRows)
  for (const [key, list] of pairs) choose(key, list, key.split('+').map(termOf), pairRows)
  return heads
}

/** Heads shards (gzipped text): per token a "#token" line followed by its summary lines (absolute GTINs). */
export const buildHeadsShards = (heads, targetBytes = HEADS_SHARD_BYTES) => {
  const shards = []
  let parts = []
  let first
  let size = 0
  const flush = () => { if (parts.length) { shards.push({ first, text: parts.join('\n') }); parts = []; first = undefined; size = 0 } }
  for (const token of [...heads.keys()].sort()) {
    const body = `#${token}\n${heads.get(token)}`
    first ??= token
    parts.push(body)
    size += body.length
    if (size >= targetBytes) flush()
  }
  flush()
  return shards
}

// ---------------------------------------------------------------------------------------------------------------------
// Packs and manifest
// ---------------------------------------------------------------------------------------------------------------------

export const MAX_PACK_BYTES = 25_000_000

/** Concatenate shards (already gzipped) into packs of at most `maxPackBytes`. Returns { packs: [Buffer], places: [[pack, offset, length]] }. */
export const packShards = (buffers, maxPackBytes = MAX_PACK_BYTES) => {
  const packs = []
  const places = []
  let current = []
  let size = 0
  const flush = () => { if (current.length > 0) { packs.push(Buffer.concat(current)); current = []; size = 0 } }
  for (const buffer of buffers) {
    if (size + buffer.length > maxPackBytes) flush()
    places.push([packs.length, size, buffer.length])
    current.push(buffer)
    size += buffer.length
  }
  flush()
  return { packs, places }
}

const sha12 = (buffer) => createHash('sha256').update(buffer).digest('hex').slice(0, 12)

/** Everything the build produces, in memory. `files` is { name: Buffer|string }. */
export const buildOutput = (products, stats, options = {}) => {
  const { detailRawBytes = DETAIL_SHARD_BYTES, maxPackBytes = MAX_PACK_BYTES, blockRows = SUMMARY_BLOCK_ROWS, headMin = HEAD_MIN, headRows = HEAD_ROWS, pairMin = PAIR_MIN, pairRows = PAIR_ROWS } = options
  const categoryNames = [...new Set(products.map((product) => product.category))].sort()
  const categories = new Map(categoryNames.map((name, index) => [name, index]))
  const detail = planDetailShards(products, categories, detailRawBytes)
  const detailGz = detail.map((shard) => gzip(shard.text))

  const { ordered, groupSize } = assignOrdinals(products)
  if (stats) stats.suspectAllZero = products.filter((product) => product.suspect).length
  const ctx = { categories, groupSize }
  const blocks = []
  for (let at = 0; at < ordered.length; at += blockRows) blocks.push(gzip(encodeSummaryBlock(ordered.slice(at, at + blockRows), ctx)))

  const postings = buildPostings(ordered)
  const rows = ordered.map(tokenRow)
  const stat = brandStats(rows)
  const lists = brandLists(stat)
  const postsShards = buildPostsShards(postings)
  const postsGz = postsShards.map((shard) => gzip(shard.buffer))
  const pairs = buildPairs(rows, pairMin)
  const heads = buildHeads(ordered, postings, pairs, rows, lists.dominant, ctx, { min: headMin, headRows, pairRows })
  const headsShards = buildHeadsShards(heads)
  const headsGz = headsShards.map((shard) => gzip(shard.text))

  // Popularity level (popQ / 4, 0..7) of every ordinal, one byte each: lets the client rank a candidate set before it reads any summary.
  const popGz = [gzip(Buffer.from(ordered.map((product) => Math.min(POP_LEVELS - 1, Math.floor(product.popQ / 4)))))]

  const sections = [detailGz, blocks, popGz, postsGz, headsGz]
  const { packs, places } = packShards(sections.flat(), maxPackBytes)
  const packNames = packs.map((pack, index) => `branded-p${String(index).padStart(2, '0')}-${sha12(pack)}.bin`)
  let cursor = 0
  const take = (list) => { const slice = places.slice(cursor, cursor + list.length).flat(); cursor += list.length; return slice }
  const common = [...heads.keys()].sort().map((key) => `${key}:${base36((postings.get(key) ?? pairs.get(key)).length)}`).join(' ')
  const manifest = {
    version: FORMAT_VERSION,
    source: SOURCE_LABEL,
    products: products.length,
    nutrients: { core: CORE_KEYS, optional: OPTIONAL_NUTRIENTS.map((spec) => spec.key) },
    categories: categoryNames,
    packs: packNames.map((name, index) => [name, packs[index].length]),
    // Detail shards in GTIN order: starts[i] is the first 14-digit GTIN of shard i (as a number); places is a flat [pack, offset, length] triple list.
    detail: { starts: detail.map((shard) => Number(shard.start)), places: take(detailGz) },
    // Summary blocks in ordinal order: block i holds ordinals [i * rows, (i + 1) * rows).
    summaries: { rows: blockRows, places: take(blocks) },
    pop: { places: take(popGz) },
    // Postings shards in token order: shard i holds tokens first[i] .. (first[i + 1] exclusive).
    posts: { first: postsShards.map((shard) => shard.first), places: take(postsGz) },
    heads: { first: headsShards.map((shard) => shard.first), places: take(headsGz) },
    // Words with more than headMin products, and very common adjacent word pairs ("peanut+butter"), with their product counts (base 36),
    // space separated: "chocolate:2s5 peanut+butter:5k ...". Each has a head list.
    common,
    // Brand-like tokens for typo repair, and the tokens that are mostly brand words.
    brandTokens: lists.tokens,
    brandDominant: lists.dominant,
  }
  const files = { 'manifest.json': JSON.stringify(manifest) }
  packs.forEach((pack, index) => { files[packNames[index]] = pack })
  const sizes = {
    detail: detailGz.reduce((sum, buffer) => sum + buffer.length, 0),
    summaries: blocks.reduce((sum, buffer) => sum + buffer.length, 0),
    posts: postsGz.reduce((sum, buffer) => sum + buffer.length, 0),
    pop: popGz[0].length,
    heads: headsGz.reduce((sum, buffer) => sum + buffer.length, 0),
    manifest: files['manifest.json'].length,
  }
  return { files, manifest, ordered, sizes, counts: { detail: detail.length, summaries: blocks.length, posts: postsShards.length, heads: headsShards.length, tokens: postings.size, common: heads.size, pairs: pairs.size }, stats }
}

export const writeOutput = async (outDir, files) => {
  await fs.mkdir(outDir, { recursive: true })
  for (const existing of await fs.readdir(outDir)) {
    if (existing === 'manifest.json' || /^branded-p\d+-[0-9a-f]{12}\.bin$/.test(existing)) await fs.rm(join(outDir, existing))
  }
  for (const [name, content] of Object.entries(files)) await fs.writeFile(join(outDir, name), content)
}

const FILTER_LABELS = [
  ['brandedRows', 'branded_food rows read'],
  ['droppedNotUS', 'rows dropped: market country not United States/US'],
  ['droppedBadGtin', 'rows dropped: unusable gtin_upc'],
  ['upcsWithUsRecord', 'UPCs (keys) with a US record'],
  ['checkDigitCompleted', 'records filed under a completed check digit'],
  ['upcEMerged', 'UPC-E records merged into their UPC-A twin'],
  ['caseRekeyed', 'case-level GTIN-14 records filed under their consumer code'],
  ['upcsNewestDiscontinued', 'UPCs whose newest record is discontinued (kept: live record, else discontinued one)'],
  ['keptFromDiscontinuedRecord', 'products kept from a discontinued record (no live record passes)'],
  ['recordsOlderThanNewest', 'older records of a UPC (superseded)'],
  ['rescuedByOlderRecord', 'UPCs kept from an older record (newest failed a check)'],
  ['energyFromKj', 'products whose energy came from kJ'],
  ['energyDerivedFromMacros', 'products whose energy was derived from protein, fat, carbs'],
  ['macrosAssumedZero', 'products with absent macros taken as 0 (kcal <= 5)'],
  ['dropped_noEnergy', 'dropped: no energy and no complete macros'],
  ['dropped_missingMacro', 'dropped: protein, fat or carbohydrate missing (kcal > 5)'],
  ['dropped_kcalOver902', 'dropped: kcal per 100 g over 902 (935 for pure fat)'],
  ['dropped_macrosOver105', 'dropped: protein + fat + carbs over 105 g (110 for servings <= 15 g)'],
  ['dropped_atwaterMismatch', 'dropped: Atwater estimate off by more than 40% and 60 kcal'],
  ['dropped_noName', 'dropped: no description'],
  ['dropped_localCodeNoBrand', 'dropped: store-local code (UPC number system 2 or 4, EAN 20-29) without a brand'],
  ['localCodesKept', 'store-local codes kept (searchable, not scannable)'],
  ['serving_mgTreatedAsGrams', 'servings with unit MG treated as grams'],
  ['serving_unitGuessed', 'servings with another unit (IU, MC, none) taken as grams'],
  ['serving_unitDropped', 'servings dropped: unknown unit and implausible'],
  ['serving_fromHousehold', 'servings replaced by the amount the household text states'],
  ['serving_householdDropped', 'servings dropped: household text disagrees and its amount is implausible'],
  ['serving_implausible', 'servings dropped: more than 1200 kcal per serving'],
  ['flaggedServingMissing', 'kept without a serving size'],
  ['labelRounded', 'kept and flagged: label rounds to 0 kcal per serving'],
  ['suspectAllZero', 'suspect: all-zero product whose same-named siblings have values (ranked last, kept out of heads and size counts)'],
  ['zeroRecordReplacedByOlder', 'newest record all zero, an older record of the GTIN with values used instead'],
  ['productsKept', 'PRODUCTS KEPT'],
]

export const formatReport = (stats) => FILTER_LABELS.map(([key, label]) => `${String(stats[key] ?? 0).padStart(10)}  ${label}`).join('\n')

// ---------------------------------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------------------------------

const parseArgs = (args) => {
  let dir
  let out = DEFAULT_OUT
  let quiet = false
  let dropped
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--dir') dir = args[++index]
    else if (arg === '--out') out = resolve(args[++index])
    else if (arg === '--quiet') quiet = true
    else if (arg === '--dropped') dropped = resolve(args[++index])
    else if (arg === '--help' || arg === '-h') { console.log('Usage: node scripts/build-usda-branded.mjs --dir <csv dir> [--out public/data/branded-v1] [--quiet] [--dropped file.jsonl]'); process.exit(0) }
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!dir) throw new Error('Pass the extracted Branded Foods CSV directory with --dir <path>.')
  return { dir: resolve(dir), out, quiet, dropped }
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href
if (isMain) {
  const { dir, out, quiet, dropped } = parseArgs(process.argv.slice(2))
  const log = quiet ? () => {} : (message) => console.error(message)
  const droppedList = dropped ? [] : undefined
  const { products, stats } = await loadProducts(dir, log, { dropped: droppedList })
  if (dropped) await fs.writeFile(dropped, droppedList.map((entry) => JSON.stringify(entry)).join('\n') + '\n')
  const output = buildOutput(products, stats)
  await writeOutput(out, output.files)
  console.log(formatReport(stats))
  const packSizes = output.manifest.packs.map(([name, size]) => `${name} ${(size / 1048576).toFixed(2)} MB`)
  const mb = (bytes) => `${(bytes / 1048576).toFixed(2)} MB`
  const { sizes, counts } = output
  console.log(`\npacks: ${packSizes.join(', ')}\nsections: detail ${mb(sizes.detail)}, summaries ${mb(sizes.summaries)}, pop ${mb(sizes.pop)}, posts ${mb(sizes.posts)}, heads ${mb(sizes.heads)}; manifest ${sizes.manifest} bytes`)
  console.log(`shards: detail ${counts.detail}, summaries ${counts.summaries}, posts ${counts.posts}, heads ${counts.heads}; tokens ${counts.tokens}, heads ${counts.common} (pairs ${counts.pairs})`)
}
