import { NUTRIENT_KEYS, type NutrientKey, type NutrientValues } from '../lib/nutrients'
import { scaleNutrientsPer100g } from '../lib/servings'
import type { CatalogFood } from './types'

/**
 * US branded packaged foods (USDA FoodData Central "Branded Foods"), self-hosted as a few PACK files under ./data/branded-v1/ and
 * built by scripts/build-usda-branded.mjs. A pack is a concatenation of individually gzipped shards; manifest.json says where each
 * shard lives ([pack, offset, length]) and this file reads one with an HTTP Range request, gunzips it in the browser and caches it.
 *
 * Nothing here imports the UI or throws at a caller: every public function resolves to an empty value when the network, the
 * manifest or a shard is unavailable, and says why through `options.onReason` and `lastBrandedReason()`. Heavy things stay lazy:
 * nothing is fetched until a function is called, and the app must import this module with a caught dynamic import().
 *
 * Four kinds of shard (the build script is the writer, and documents the formats):
 *   detail     JSON rows in GTIN order: [gtinDelta, fdcId, name, brand, categoryIndex, size, flags, household, kcal, protein, fat,
 *              carbs, mask, ...values]; bit i of mask says manifest.nutrients.optional[i] follows (absent = unknown). flags: 1 = ml.
 *   summaries  blocks of manifest.summaries.rows text lines in "ordinal" order (popular products first); each product is stored once:
 *              gtin(base 36 difference) TAB name TAB brand TAB kcal TAB serving TAB popularity TAB ml TAB category TAB sizes.
 *   posts      binary, per token the ascending ordinals of its products (delta varints); shards are consecutive token ranges.
 *   heads      text; for each common token the summary lines of its best products ("#token" line, then absolute-GTIN lines).
 * A search reads the postings of its rarest words, intersects them, fetches the few summary blocks that hold the most popular
 * candidates (at most MAX_BLOCKS, so a query is about six small requests) and ranks those. A single common word reads one heads shard.
 */

export const BRANDED_BASE = './data/branded-v1/'
export const BRANDED_MANIFEST = 'manifest.json'
export const BRANDED_FORMAT_VERSION = 2

/** Search gives up after this long (all of its requests share the budget); barcode and detail lookups are given a little longer. */
export const SEARCH_TIMEOUT_MS = 3000
export const LOOKUP_TIMEOUT_MS = 6000
const MANIFEST_TIMEOUT_MS = 8000
/** A 200 answer to a Range request whose body is larger than this means the server ignores Range; the pack is then not used. */
const FULL_BODY_LIMIT = 1_500_000
const MAX_REQUESTS_PER_SEARCH = 6
const MAX_BLOCKS = 4
/** When the rarest word of a query has at most this many products, the postings of every word are read and intersected. */
const EXACT_DF = 3000
/** A match set this small is read whole (every summary block it touches, up to SMALL_SET_BLOCKS of them). */
const SMALL_SET = 24
const SMALL_SET_BLOCKS = 20
/** A one-word query is answered by its head list when the limit is no larger than this. */
const HEAD_LIMIT = 200

export type BrandedReason =
  | 'offline' | 'timeout' | 'bad-manifest' | 'bad-response' | 'bad-shard' | 'bad-code' | 'empty-query' | 'not-found' | 'aborted'
  | 'range-unsupported' | 'stale'

export interface BrandedServing {
  /** Grams (or millilitres when unit is 'ml') in one labelled serving. */
  size: number
  unit: 'g' | 'ml'
  /** Household measure as printed, e.g. "1 bar" or "2 Tbsp". */
  household?: string
  /** Ready to show: "1 bar (40 g)". */
  label: string
}

export interface BrandedProduct {
  /** Canonical 14-digit GTIN. */
  gtin: string
  fdcId: number
  name: string
  brand: string
  category: string
  /** 'ml' when the per-100 values are per 100 ml (also when the label has no usable serving). */
  unit?: 'ml'
  /** Absent when the label has no usable serving size. */
  serving?: BrandedServing
  /** Per 100 g (per 100 ml when serving.unit is 'ml'; log such a product in ml, do not convert). */
  per100: { calories: number; protein: number; fat: number; carbs: number }
  /** Every other nutrient the label had, keyed like src/lib/nutrients.ts, per 100 g/ml. Absent means not recorded, never zero. */
  nutrients: NutrientValues
  /** Added sugars per 100 g/ml: the app has no field for it yet. */
  addedSugar?: number
  /** True when the label rounds this serving to 0 kcal although the food has energy (a spray, a sweetener packet): show "0 kcal per serving (label)". */
  labelRounded?: boolean
  /** True when USDA lists the newest record of this barcode as discontinued (the food may still be in people's homes). */
  discontinued?: boolean
}

export interface BrandedSummary {
  gtin: string
  name: string
  brand: string
  /** Kilocalories per 100 g (or 100 ml). */
  kcal: number
  /** "1 bar (40 g)", or '' when the label has no serving. */
  serving: string
  /** The query this result answers (callers drop results whose query is no longer the text box's). */
  query: string
  /** 'ml' when kcal is per 100 ml. */
  unit?: 'g' | 'ml'
  /** How many sizes or packs of this brand and name exist (only when more than one): show "N sizes". */
  sizes?: number
  /** GTINs of the sizes seen for this brand and name (this one included). */
  variants?: string[]
}

export interface BrandedManifest {
  version: number
  source: string
  products: number
  nutrients: { core: string[]; optional: string[] }
  categories: string[]
  packs: Array<[string, number]>
  detail: { starts: number[]; places: number[] }
  summaries: { rows: number; places: number[] }
  /** One shard: a byte per ordinal, popularity level 0..7 (popQ / 4). */
  pop: { places: number[] }
  posts: { first: string[]; places: number[] }
  heads: { first: string[]; places: number[] }
  /** "token:df" (df in base 36), space separated: every token with more than ~300 products. */
  common: string
  brandTokens: string[]
  brandDominant: string[]
}

export interface BrandedOptions {
  /** Called with the reason whenever a call comes back empty because of a failure. */
  onReason?: (reason: BrandedReason) => void
  /** Aborts the call (returns empty with reason 'aborted'). */
  signal?: AbortSignal
}

export interface SearchOptions extends BrandedOptions {
  /** Maximum results (default 20). */
  limit?: number
  /** Most summary blocks fetched for one query (default 4). */
  maxShards?: number
  timeoutMs?: number
  /** When a newer search starts on the same client, this one resolves [] with reason 'stale' (a type-ahead box sets it on every call). */
  latestOnly?: boolean
}

export interface ShardCache {
  get: (key: string) => Promise<Uint8Array | undefined> | Uint8Array | undefined
  put: (key: string, bytes: Uint8Array) => Promise<void> | void
}

export interface BrandedClientOptions {
  fetch?: typeof fetch
  base?: string
  /** Optional persistent cache of gzipped shards (the service worker layer), keyed "<pack file>:<offset>:<length>". */
  shardCache?: ShardCache
  /** Replaces the gunzip step (tests). */
  gunzip?: (bytes: Uint8Array) => Promise<Uint8Array>
}

// ---------------------------------------------------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------------------------------------------------

/** GS1 mod-10 check digit that must follow `body`. */
export const checkDigitFor = (body: string): number => {
  let sum = 0
  for (let index = body.length - 1, weight = 3; index >= 0; index -= 1, weight = weight === 3 ? 1 : 3) sum += Number(body[index]) * weight
  return (10 - (sum % 10)) % 10
}

/** Whether a digit string ends in a correct GS1 check digit. */
export const hasValidCheckDigit = (digits: string): boolean => digits.length >= 2 && checkDigitFor(digits.slice(0, -1)) === Number(digits[digits.length - 1])

/** Canonical 14-digit GTIN of a barcode string or number: separators tolerated, 8 to 14 digits, left-padded with zeros. */
export const normalizeGtin = (raw: string | number): string | undefined => {
  const text = String(raw ?? '').trim()
  if (!/^[\d\s-]+$/.test(text)) return undefined
  const digits = text.replace(/\D/g, '')
  if (digits.length < 8 || digits.length > 14) return undefined
  if (digits.replace(/^0+/, '').length < 6) return undefined
  return digits.padStart(14, '0')
}

/** Expand an 8-digit UPC-E to its 12-digit UPC-A, or undefined when the code is not a UPC-E. */
export const expandUpcE = (code: string): string | undefined => {
  if (!/^\d{8}$/.test(code) || (code[0] !== '0' && code[0] !== '1')) return undefined
  const d = code.slice(1, 7)
  const last = d[5]
  let body: string
  if (last === '0' || last === '1' || last === '2') body = `${d[0]}${d[1]}${last}0000${d[2]}${d[3]}${d[4]}`
  else if (last === '3') body = `${d[0]}${d[1]}${d[2]}00000${d[3]}${d[4]}`
  else if (last === '4') body = `${d[0]}${d[1]}${d[2]}${d[3]}00000${d[4]}`
  else body = `${d[0]}${d[1]}${d[2]}${d[3]}${d[4]}0000${last}`
  return `${code[0]}${body}${code[7]}`
}

/** Store-local codes (UPC-A number systems 2 and 4; EAN-13 20-29) are reused by every store and identify no product: they are never scanned. */
export const isLocalKey = (key: string): boolean => {
  if (key.startsWith('00')) {
    const upc = key.slice(2)
    return upc[0] === '2' || upc[0] === '4'
  }
  return key[0] === '0' && key[1] === '2'
}

/** For a valid case-level GTIN-14 (indicator 1-8), the 14-digit key of the consumer unit it was derived from. */
export const consumerKeyOfCase = (key: string): string | undefined => {
  if (!((key[0] as string) >= '1' && (key[0] as string) <= '8') || !hasValidCheckDigit(key)) return undefined
  const body = key.slice(1, 13)
  return `0${body}${checkDigitFor(body)}`
}

/**
 * The 14-digit GTINs a scanned code could be, most likely first: UPC-A, EAN-13, EAN-8 and GTIN-14 pad with zeros; 8 digits may be a
 * UPC-E; a case-level GTIN-14 may stand for the consumer unit inside it. Store-local codes are included (getProduct can still open
 * them); lookupBarcode skips them.
 */
export const gtinCandidates = (raw: string | number): string[] => {
  const text = String(raw ?? '').trim()
  const direct = normalizeGtin(text)
  if (!direct) return []
  const out = [direct]
  const digits = text.replace(/\D/g, '')
  const expanded = expandUpcE(digits)
  if (expanded) out.push(expanded.padStart(14, '0'))
  const consumer = consumerKeyOfCase(direct)
  if (consumer && !out.includes(consumer)) out.push(consumer)
  return out
}

// ---------------------------------------------------------------------------------------------------------------------
// Text (mirrors scripts/lib/branded-text.mjs; src/catalog/brandedBuild.test.ts checks they agree)
// ---------------------------------------------------------------------------------------------------------------------

const STOPWORDS = new Set(['a', 'an', 'and', 'or', 'the', 'of', 'with', 'in', 'for', 'to', 'from', 'by', 'on', 'at', 'as', 'no', 'all', 'is', 'it', 'its', 'our', 'your', 'new', 'w', 'n'])
const UNIT_TOKEN = /^\d+(oz|g|gr|ml|ct|lb|lbs|fl|pk|l|kg|mg|pc|pcs|z|ea|in|inch|cal|kcal|pack)$/
const UNIT_WORDS = new Set(['oz', 'ml', 'fl', 'ct', 'lb', 'lbs', 'pk', 'pc', 'pcs', 'kg', 'mg', 'gr', 'g', 'l', 'ea', 'net', 'wt', 'pkg', 'pack', 'packs', 'count', 'ounce', 'ounces', 'pound', 'pounds', 'gal', 'gallon', 'quart', 'pint', 'liter', 'liters', 'litre', 'each', 'inch', 'cm', 'mm', 'cal', 'kcal', 'serving', 'servings'])
const MAX_TOKEN = 24

/** Plural-insensitive stem, identical to the one in src/catalog/index.ts. */
export const stem = (token: string): string => {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`
  if (token.length > 4 && token.endsWith('oes')) return token.slice(0, -2)
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1)
  return token
}

const fold = (text: string): string => String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’`]/g, '')

interface Piece { word: string; separator: string }

const pieces = (text: string): Piece[] => {
  const folded = fold(text)
  const out: Piece[] = []
  const re = /[a-z0-9]+(?:\.\d+)?%?/g
  let previousEnd = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(folded)) !== null) {
    out.push({ word: match[0], separator: folded.slice(previousEnd, match.index) })
    previousEnd = match.index + match[0].length
  }
  return out
}

const RUN_SEPARATOR = /^[\s&+-]*(?:and)?[\s&+-]*$/

/**
 * Search tokens of a text, in order of appearance: ASCII-folded, lower-case, apostrophes dropped (dave's -> dave), no stopwords or
 * units, numbers and percentages kept ("2%", "365") except sizes ("12 oz", "3.5"), single letters joined across & and - ("m&m" -> "mm",
 * "h-e-b" -> "heb", "a&w" -> "aw", "m&m's" -> "mm" and "mms"), stemmed like src/catalog/index.ts.
 */
export const searchTokens = (text: string): string[] => {
  const list = pieces(text)
  const out: string[] = []
  for (let index = 0; index < list.length; index += 1) {
    const word = (list[index] as Piece).word
    if (/^[a-z]$/.test(word)) {
      let joined = word
      let plural = false
      let end = index
      for (;;) {
        const next = list[end + 1]
        if (!next) break
        if (RUN_SEPARATOR.test(next.separator) && /^[a-z]$/.test(next.word)) { joined += next.word; end += 1; continue }
        // "m and m": the word "and" between two single letters joins them like an ampersand.
        const after = list[end + 2]
        if (next.word === 'and' && after && /^[a-z]$/.test(after.word) && /^\s+$/.test(next.separator) && /^\s+$/.test(after.separator)) { joined += after.word; end += 2; continue }
        if (RUN_SEPARATOR.test(next.separator) && /^[a-z]s$/.test(next.word) && next.separator.includes('&')) { joined += next.word[0]; plural = true; end += 1 }
        break
      }
      if (joined.length >= 2) {
        out.push(joined)
        if (plural) out.push(`${joined}s`)
      }
      index = end
      continue
    }
    const nextWord = list[index + 1]?.word
    if (/^\d+(?:\.\d+)?$/.test(word) && nextWord !== undefined && UNIT_WORDS.has(nextWord)) { index += 1; continue }
    if (/^\d+\.\d+$/.test(word)) continue
    if (/^\d+$/.test(word)) { if (word.length <= 4) out.push(word); continue }
    if (/^\d+(?:\.\d+)?%$/.test(word)) { out.push(word); continue }
    if (word.length < 2 || STOPWORDS.has(word) || UNIT_WORDS.has(word) || UNIT_TOKEN.test(word)) continue
    out.push(/^[a-z]+$/.test(word) ? stem(word).slice(0, MAX_TOKEN) : word.slice(0, MAX_TOKEN))
  }
  return out
}

/** Joined adjacent-word forms of a brand ("la croix" -> lacroix), at most three. */
export const compoundTokens = (brand: string): string[] => {
  const words = pieces(brand).map((piece) => piece.word).filter((word) => /^[a-z]{2,}$/.test(word) && !STOPWORDS.has(word))
  const out: string[] = []
  for (let index = 0; index + 1 < words.length && out.length < 3; index += 1) out.push(stem((words[index] as string) + (words[index + 1] as string)).slice(0, MAX_TOKEN))
  return out
}

/** "1 bar (40 g)": the household measure and its weight, or the weight alone. Same as the build. */
export const servingLabel = (household: string | undefined, size: number, unit: 'g' | 'ml'): string | undefined => {
  const weight = size > 0 ? `${Number(size.toFixed(2))} ${unit}` : ''
  if (!household) return weight || undefined
  if (!weight) return household
  const compact = (text: string) => text.toLowerCase().replace(/\s+/g, '')
  // The weight the row shows is the serving size (what the form logs): a household text that states another metric weight has it replaced.
  const metric = /(\d+(?:\.\d+)?)\s?(g|gr|gm|grams?|ml|mls)\b/i.exec(household)
  if (metric) return Math.abs(Number(metric[1]) - size) <= 0.005 * size ? household : household.replace(metric[0], weight)
  return /\d\s?(g|gr|gm|grams?|ml|mls|l|liters?|litres?|kg|mg)\b/i.test(household) || compact(household).includes(compact(weight)) ? household : `${household} (${weight})`
}

// ---------------------------------------------------------------------------------------------------------------------
// Ranking (mirrors rowScore in scripts/lib/branded-text.mjs)
// ---------------------------------------------------------------------------------------------------------------------

export interface RankRow { nameTokens: string[]; brandTokens: string[]; brandCore: string[]; pop: number; category: string }
export interface RankTerm { variants: string[]; prefix: boolean; generic: boolean; qualifier: boolean }

/**
 * Score of one product for a query: name words outrank brand words for generic words and the reverse for brand-like words; a generic
 * word that is only part of a multi-word brand is penalised; whole words beat prefixes; a contiguous phrase in the name, a shorter
 * name and a popular product (records of the GTIN, size of the brand) help.
 */
export const rowScore = (row: RankRow, terms: RankTerm[]): number => {
  let score = 0
  const positions: number[] = []
  terms.forEach((term) => {
    const matches = (token: string) => term.variants.some((variant) => (term.prefix && !term.qualifier ? token.startsWith(variant) : token === variant))
    const exactly = (token: string) => term.variants.includes(token)
    let nameHit = 0
    let brandHit = 0
    let position = -1
    row.nameTokens.forEach((token, at) => {
      if (exactly(token)) { if (nameHit < 2) { nameHit = 2; position = at } } else if (nameHit < 1 && matches(token)) { nameHit = 1; if (position < 0) position = at }
    })
    for (const token of row.brandTokens) {
      if (exactly(token)) brandHit = 2
      else if (brandHit < 1 && matches(token)) brandHit = 1
    }
    positions.push(nameHit === 2 ? position : -1)
    const name = term.generic ? (nameHit === 2 ? 4 : nameHit === 1 ? 2.2 : 0) : (nameHit === 2 ? 2.5 : nameHit === 1 ? 1.5 : 0)
    let brand = term.generic ? (brandHit === 2 ? 0.5 : brandHit === 1 ? 0.25 : 0) : (brandHit === 2 ? 3.5 : brandHit === 1 ? 2 : 0)
    if (term.generic && brandHit > 0 && nameHit === 0 && row.brandTokens.length >= 2) brand -= 1
    score += Math.max(name, brand) + (name > 0 && brand > 0 ? 0.25 : 0)
    if (term.qualifier && nameHit === 2) score += 1.5
    if (term.generic && row.category && term.variants.some((variant) => row.category.includes(variant))) score += 1.2
  })
  if (terms.length > 1 && positions.every((at) => at >= 0)) {
    let inOrder = true
    for (let index = 1; index < positions.length; index += 1) if (positions[index] !== (positions[index - 1] as number) + 1) inOrder = false
    if (inOrder) score += 2.5
  }
  if (positions[0] === 0) score += 0.5
  // The whole brand is in the query ("splenda", "kind bar", "great value peanut butter"): the brand is what was asked for.
  if (row.brandCore.length > 0 && new Set(row.brandCore).size === row.brandCore.length && row.brandCore.every((token) => terms.some((term) => term.variants.includes(token)))) score += 2.2
  score -= 0.06 * Math.max(0, row.nameTokens.length - terms.length)
  return score + 0.35 * row.pop
}

/** Edit distance (insert, delete, substitute, swap of neighbours) with an early exit above `max`. */
export const editDistance = (a: string, b: string, max: number): number => {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let previous2: number[] = []
  let previous = Array.from({ length: b.length + 1 }, (_unused, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let value = Math.min((previous[j] as number) + 1, (row[j - 1] as number) + 1, (previous[j - 1] as number) + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, (previous2[j - 2] as number) + 1)
      row.push(value)
      if (value < best) best = value
    }
    if (best > max) return max + 1
    previous2 = previous
    previous = row
  }
  return previous[b.length] as number
}

// ---------------------------------------------------------------------------------------------------------------------
// Gunzip: the browser's DecompressionStream, with a small pure inflate as the fallback
// ---------------------------------------------------------------------------------------------------------------------

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

interface Huffman { count: Uint16Array; symbol: Uint16Array }

const buildHuffman = (lengths: ArrayLike<number>, n: number): Huffman => {
  const count = new Uint16Array(16)
  const symbol = new Uint16Array(n)
  for (let index = 0; index < n; index += 1) count[lengths[index] as number] += 1
  const offsets = new Uint16Array(16)
  for (let len = 1; len < 15; len += 1) offsets[len + 1] = (offsets[len] as number) + (count[len] as number)
  for (let index = 0; index < n; index += 1) {
    const len = lengths[index] as number
    if (len !== 0) { symbol[offsets[len] as number] = index; offsets[len] = (offsets[len] as number) + 1 }
  }
  return { count, symbol }
}

let fixedTables: { literal: Huffman; distance: Huffman } | undefined
const fixed = () => {
  if (!fixedTables) {
    const lengths = new Uint8Array(288)
    lengths.fill(8, 0, 144); lengths.fill(9, 144, 256); lengths.fill(7, 256, 280); lengths.fill(8, 280, 288)
    fixedTables = { literal: buildHuffman(lengths, 288), distance: buildHuffman(new Uint8Array(30).fill(5), 30) }
  }
  return fixedTables
}

/** Inflate a raw DEFLATE stream (RFC 1951). Throws on malformed input. */
export const inflateRaw = (input: Uint8Array, start = 0): Uint8Array => {
  let position = start
  let bitBuffer = 0
  let bitCount = 0
  let out = new Uint8Array(Math.max(1024, input.length * 4))
  let length = 0
  const bits = (need: number): number => {
    while (bitCount < need) {
      if (position >= input.length) throw new Error('Unexpected end of compressed data.')
      bitBuffer |= (input[position++] as number) << bitCount
      bitCount += 8
    }
    const value = bitBuffer & ((1 << need) - 1)
    bitBuffer >>>= need
    bitCount -= need
    return value
  }
  const ensure = (extra: number) => {
    if (length + extra <= out.length) return
    const grown = new Uint8Array(Math.max(out.length * 2, length + extra))
    grown.set(out.subarray(0, length))
    out = grown
  }
  const decode = (table: Huffman): number => {
    let code = 0
    let first = 0
    let index = 0
    for (let len = 1; len <= 15; len += 1) {
      code |= bits(1)
      const count = table.count[len] as number
      if (code - count < first) return table.symbol[index + (code - first)] as number
      index += count
      first += count
      first <<= 1
      code <<= 1
    }
    throw new Error('Invalid Huffman code.')
  }
  const codes = (literal: Huffman, distance: Huffman) => {
    for (;;) {
      const symbol = decode(literal)
      if (symbol < 256) { ensure(1); out[length++] = symbol; continue }
      if (symbol === 256) return
      const lengthIndex = symbol - 257
      if (lengthIndex >= 29) throw new Error('Invalid length symbol.')
      const copy = (LENGTH_BASE[lengthIndex] as number) + bits(LENGTH_EXTRA[lengthIndex] as number)
      const distanceSymbol = decode(distance)
      if (distanceSymbol >= 30) throw new Error('Invalid distance symbol.')
      const back = (DIST_BASE[distanceSymbol] as number) + bits(DIST_EXTRA[distanceSymbol] as number)
      if (back > length) throw new Error('Distance too far back.')
      ensure(copy)
      for (let step = 0; step < copy; step += 1) { out[length] = out[length - back] as number; length += 1 }
    }
  }
  let last = 0
  do {
    last = bits(1)
    const type = bits(2)
    if (type === 0) {
      bitBuffer = 0
      bitCount = 0
      if (position + 4 > input.length) throw new Error('Unexpected end of compressed data.')
      const stored = (input[position] as number) | ((input[position + 1] as number) << 8)
      position += 4
      if (position + stored > input.length) throw new Error('Unexpected end of compressed data.')
      ensure(stored)
      out.set(input.subarray(position, position + stored), length)
      length += stored
      position += stored
    } else if (type === 1) {
      const tables = fixed()
      codes(tables.literal, tables.distance)
    } else if (type === 2) {
      const literalCount = bits(5) + 257
      const distanceCount = bits(5) + 1
      const codeLengthCount = bits(4) + 4
      const lengths = new Uint8Array(320)
      for (let index = 0; index < codeLengthCount; index += 1) lengths[CODE_LENGTH_ORDER[index] as number] = bits(3)
      const lengthTable = buildHuffman(lengths.subarray(0, 19), 19)
      const all = new Uint8Array(literalCount + distanceCount)
      let index = 0
      while (index < all.length) {
        const symbol = decode(lengthTable)
        if (symbol < 16) { all[index++] = symbol; continue }
        let repeat = 0
        let value = 0
        if (symbol === 16) { if (index === 0) throw new Error('Invalid repeat.'); value = all[index - 1] as number; repeat = 3 + bits(2) }
        else if (symbol === 17) repeat = 3 + bits(3)
        else repeat = 11 + bits(7)
        if (index + repeat > all.length) throw new Error('Invalid repeat.')
        while (repeat-- > 0) all[index++] = value
      }
      codes(buildHuffman(all.subarray(0, literalCount), literalCount), buildHuffman(all.subarray(literalCount), distanceCount))
    } else throw new Error('Invalid block type.')
  } while (last === 0)
  return out.subarray(0, length)
}

let crcTable: Uint32Array | undefined

/** CRC-32 (the gzip trailer's checksum). */
export const crc32 = (bytes: Uint8Array): number => {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (let index = 0; index < bytes.length; index += 1) crc = (crcTable[(crc ^ (bytes[index] as number)) & 255] as number) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** Strip the gzip header (RFC 1952), inflate, and check the trailer's CRC-32 and length. Throws on malformed or corrupt data. */
export const gunzipPure = (bytes: Uint8Array): Uint8Array => {
  if (bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 8) throw new Error('Not gzip data.')
  const flags = bytes[3] as number
  let position = 10
  if (flags & 4) position += 2 + ((bytes[position] as number) | ((bytes[position + 1] as number) << 8))
  if (flags & 8) { while (position < bytes.length && bytes[position] !== 0) position += 1; position += 1 }
  if (flags & 16) { while (position < bytes.length && bytes[position] !== 0) position += 1; position += 1 }
  if (flags & 2) position += 2
  const out = inflateRaw(bytes, position)
  const n = bytes.length
  const word = (at: number) => (((bytes[at] as number) | ((bytes[at + 1] as number) << 8) | ((bytes[at + 2] as number) << 16) | ((bytes[at + 3] as number) << 24)) >>> 0)
  if (out.length >>> 0 !== word(n - 4) || crc32(out) !== word(n - 8)) throw new Error('Corrupt gzip data: checksum or length mismatch.')
  return out
}

const decoder = new TextDecoder('utf-8')

/**
 * Gunzip to bytes: the browser's DecompressionStream when it exists, otherwise the pure implementation. A data error from the
 * browser's decoder is final (it is thrown, never retried with the pure one: the same bytes would fail there too).
 */
export const gunzipBytes = async (bytes: Uint8Array): Promise<Uint8Array> => {
  if (typeof DecompressionStream === 'function' && typeof Response === 'function' && typeof Blob === 'function') {
    let stream: ReadableStream<Uint8Array> | undefined
    try { stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip')) as ReadableStream<Uint8Array> } catch { stream = undefined }
    if (stream) return new Uint8Array(await new Response(stream).arrayBuffer())
  }
  return gunzipPure(bytes)
}

/** Gunzip to text. */
export const gunzipText = async (bytes: Uint8Array): Promise<string> => decoder.decode(await gunzipBytes(bytes))

// ---------------------------------------------------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------------------------------------------------

class Lru<V> {
  private readonly map = new Map<string, V>()
  constructor(private readonly capacity: number) {}
  get(key: string): V | undefined {
    const value = this.map.get(key)
    if (value !== undefined) { this.map.delete(key); this.map.set(key, value) }
    return value
  }
  set(key: string, value: V): void {
    this.map.delete(key)
    this.map.set(key, value)
    while (this.map.size > this.capacity) this.map.delete(this.map.keys().next().value as string)
  }
  clear(): void { this.map.clear() }
}

class Failure extends Error {
  constructor(readonly reason: BrandedReason, readonly pack?: string) { super(reason) }
}

interface DetailShard { gtins: number[]; rows: unknown[][] }

/** A summary line, decoded. `ordinal` is -1 for a line read from a heads shard. */
interface Row {
  ordinal: number
  gtin: number
  name: string
  brand: string
  kcal: number
  serving: string
  popQ: number
  ml: boolean
  category: string
  sizes: number
  rank?: RankRow
  words?: Set<string>
}

interface PostsShard { bytes: Uint8Array; tokens: string[]; df: number[]; starts: number[]; ends: number[] }

interface Index { common: Map<string, number>; commonTokens: string[]; typoTokens: string[]; brand: Set<string>; dominant: Set<string> }

export interface BrandedStats { requests: number; bytes: number; fullPackFallbacks: number }

export interface BrandedClient {
  loadManifest: (options?: BrandedOptions) => Promise<BrandedManifest | undefined>
  lookupBarcode: (code: string | number, options?: BrandedOptions) => Promise<BrandedProduct | undefined>
  getProduct: (gtin: string | number, options?: BrandedOptions) => Promise<BrandedProduct | undefined>
  searchBranded: (query: string, options?: SearchOptions) => Promise<BrandedSummary[]>
  /** Load the manifest and the popularity list on a signal nothing can abort, so the first search finds them in memory. Never rejects. */
  warm: () => Promise<void>
  /** Why the most recent call that returned nothing failed (undefined after a success). */
  lastReason: () => BrandedReason | undefined
  stats: BrandedStats
  reset: () => void
}

const delay = (ms: number): { promise: Promise<never>; cancel: () => void } => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const promise = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Failure('timeout')), ms) })
  promise.catch(() => undefined)
  return { promise, cancel: () => { if (timer) clearTimeout(timer) } }
}

interface Shared<T> { promise: Promise<T>; controller: AbortController; refs: number }

/**
 * Join (or start) the shared in-flight work for `key`. The work runs on its OWN AbortController: a caller that aborts or times out
 * rejects only its own promise, and the work is cancelled only when no caller is left.
 */
const joinShared = <T>(map: Map<string, Shared<T>>, key: string, start: (signal: AbortSignal) => Promise<T>, callerSignal: AbortSignal): Promise<T> => {
  let entry = map.get(key)
  if (!entry) {
    const controller = new AbortController()
    const created: Shared<T> = { promise: start(controller.signal), controller, refs: 0 }
    entry = created
    map.set(key, created)
    created.promise.then(() => undefined, () => undefined).finally(() => { if (map.get(key) === created) map.delete(key) })
  }
  const shared = entry
  shared.refs += 1
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const leave = () => {
      if (settled) return false
      settled = true
      callerSignal.removeEventListener('abort', onAbort)
      shared.refs -= 1
      if (shared.refs <= 0) { shared.controller.abort(); if (map.get(key) === shared) map.delete(key) }
      return true
    }
    const onAbort = () => { if (leave()) reject(new Failure('aborted')) }
    callerSignal.addEventListener('abort', onAbort)
    if (callerSignal.aborted) { onAbort(); return }
    shared.promise.then(
      (value) => { if (!settled) { settled = true; callerSignal.removeEventListener('abort', onAbort); shared.refs -= 1; resolve(value) } },
      (error) => { if (!settled) { settled = true; callerSignal.removeEventListener('abort', onAbort); shared.refs -= 1; reject(error) } },
    )
  })
}

/** Read a response body of at most `limit` bytes; undefined (and the body cancelled) when it is longer. */
const readCapped = async (response: Response, limit: number): Promise<Uint8Array | undefined> => {
  const reader = response.body?.getReader()
  if (!reader) {
    const whole = new Uint8Array(await response.arrayBuffer())
    return whole.length > limit ? undefined : whole
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > limit) { await reader.cancel().catch(() => undefined); return undefined }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length }
  return out
}

const sortedIndexOf = (list: string[], token: string): number => {
  let low = 0
  let high = list.length - 1
  let found = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if ((list[mid] as string) <= token) { found = mid; low = mid + 1 } else high = mid - 1
  }
  return found
}

/** Spellings the stemmer can split: cookie/cookies (cooky), berrie/berries (berry); a word still being typed may be a cut-off -y: cherri -> cherry. */
const spellings = (token: string, typing: boolean): string[] => {
  const out = [token]
  if (token.length >= 4 && token.endsWith('ie')) out.push(`${token.slice(0, -2)}y`)
  else if (token.length >= 4 && token.endsWith('y')) out.push(`${token.slice(0, -1)}ie`)
  else if (typing && token.length >= 4 && token.endsWith('i')) out.push(`${token.slice(0, -1)}y`)
  return out
}

/** Intersection of two ascending lists. */
const intersectSorted = (a: number[], b: number[]): number[] => {
  const out: number[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const x = a[i] as number
    const y = b[j] as number
    if (x === y) { out.push(x); i += 1; j += 1 } else if (x < y) i += 1
    else j += 1
  }
  return out
}

/** Union of two ascending lists. */
const unionSorted = (a: number[], b: number[]): number[] => {
  const out: number[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    const x = i < a.length ? (a[i] as number) : Infinity
    const y = j < b.length ? (b[j] as number) : Infinity
    if (x === y) { out.push(x); i += 1; j += 1 } else if (x < y) { out.push(x); i += 1 } else { out.push(y); j += 1 }
  }
  return out
}

const parseVarints = (bytes: Uint8Array, start: number, end: number): number[] => {
  const out: number[] = []
  let value = 0
  let scale = 1
  let running = 0
  for (let at = start; at < end; at += 1) {
    const byte = bytes[at] as number
    value += (byte & 127) * scale
    if (byte & 128) { scale *= 128; continue }
    running += value
    out.push(running)
    value = 0
    scale = 1
  }
  return out
}

export const createBrandedClient = (clientOptions: BrandedClientOptions = {}): BrandedClient => {
  const base = clientOptions.base ?? BRANDED_BASE
  const getFetch = (): typeof fetch | undefined => clientOptions.fetch ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined)
  const gunzip = clientOptions.gunzip ?? gunzipBytes
  const stats: BrandedStats = { requests: 0, bytes: 0, fullPackFallbacks: 0 }
  let manifestValue: BrandedManifest | undefined
  let indexValue: { manifest: BrandedManifest; index: Index } | undefined
  const inflightManifest = new Map<string, Shared<BrandedManifest>>()
  const inflightBytes = new Map<string, Shared<Uint8Array>>()
  const rangeOff = new Set<string>()
  const detailCache = new Lru<DetailShard>(12)
  const blockCache = new Lru<Row[]>(24)
  const postsCache = new Lru<PostsShard>(16)
  const headsCache = new Lru<Map<string, Row[]>>(8)
  let reason: BrandedReason | undefined
  let searchSeq = 0
  let previousSearch: AbortController | undefined

  /**
   * Run `work` against a deadline; every failure becomes a Failure with a reason. The work's signal is aborted by the deadline and
   * by options.signal; `override` may name a reason that wins (a newer search made this one stale).
   */
  const guarded = async <T>(options: BrandedOptions | undefined, timeoutMs: number, work: (deadline: { signal: AbortSignal }) => Promise<T>, control?: AbortController, override?: () => BrandedReason | undefined): Promise<T | undefined> => {
    const controller = control ?? new AbortController()
    const timer = delay(timeoutMs)
    const onAbort = () => controller.abort()
    options?.signal?.addEventListener('abort', onAbort)
    try {
      if (options?.signal?.aborted) throw new Failure('aborted')
      const outcome = await Promise.race([work({ signal: controller.signal }), timer.promise])
      reason = undefined
      return outcome
    } catch (error) {
      let failure: BrandedReason
      if (options?.signal?.aborted) failure = 'aborted'
      else if (error instanceof Failure) failure = error.reason
      else failure = 'offline'
      if (failure === 'timeout') controller.abort()
      failure = override?.() ?? failure
      reason = failure
      options?.onReason?.(failure)
      return undefined
    } finally {
      timer.cancel()
      options?.signal?.removeEventListener('abort', onAbort)
    }
  }

  const request = async (path: string, headers: Record<string, string>, signal: AbortSignal, cache: RequestCache = 'default'): Promise<Response> => {
    const doFetch = getFetch()
    if (!doFetch) throw new Failure('offline')
    stats.requests += 1
    let response: Response
    try {
      response = await doFetch(base + path, { headers, signal, cache })
    } catch {
      throw new Failure(signal.aborted ? 'aborted' : 'offline')
    }
    // The service worker answers 503 when it is offline and has nothing cached.
    if (response.status === 503) throw new Failure('offline')
    return response
  }

  const validManifest = (value: unknown): value is BrandedManifest => {
    const m = value as BrandedManifest
    return !!m && m.version === BRANDED_FORMAT_VERSION && Array.isArray(m.packs) && !!m.detail && Array.isArray(m.detail.starts) && Array.isArray(m.detail.places) &&
      !!m.summaries && typeof m.summaries.rows === 'number' && m.summaries.rows > 0 && Array.isArray(m.summaries.places) &&
      !!m.pop && Array.isArray(m.pop.places) && m.pop.places.length === 3 && !!m.posts && Array.isArray(m.posts.first) && Array.isArray(m.posts.places) && !!m.heads && Array.isArray(m.heads.first) && Array.isArray(m.heads.places) &&
      typeof m.common === 'string' && Array.isArray(m.brandTokens) && Array.isArray(m.brandDominant) && Array.isArray(m.categories) && !!m.nutrients && Array.isArray(m.nutrients.optional) && typeof m.products === 'number'
  }

  const readManifest = async (signal: AbortSignal, reload: boolean): Promise<BrandedManifest> => {
    const response = await request(BRANDED_MANIFEST, {}, signal, reload ? 'reload' : 'force-cache')
    if (!response.ok) throw new Failure('bad-manifest')
    let manifest: unknown
    try { manifest = await response.json() } catch { throw new Failure('bad-manifest') }
    if (!validManifest(manifest)) throw new Failure('bad-manifest')
    return manifest
  }

  const manifestFor = async (signal: AbortSignal): Promise<BrandedManifest> => {
    if (manifestValue) return manifestValue
    const loaded = await joinShared(inflightManifest, 'manifest', (s) => readManifest(s, false), signal)
    manifestValue ??= loaded
    return manifestValue
  }

  /**
   * After a pack 404 or a short body: the deployed packs may have changed under a cached manifest, or a bad answer was cached. Fetch the
   * manifest past the HTTP cache, forget the decoded shards, and read packs past the HTTP cache once.
   */
  const reloadManifest = async (signal: AbortSignal, old: BrandedManifest): Promise<BrandedManifest> => {
    const fresh = await joinShared(inflightManifest, 'manifest-reload', (s) => readManifest(s, true), signal)
    if (JSON.stringify(fresh.packs) !== JSON.stringify(old.packs)) {
      manifestValue = fresh
      popValue = undefined; detailCache.clear(); blockCache.clear(); postsCache.clear(); headsCache.clear()
    }
    return fresh
  }

  /** A pack that failed twice (404 or a short body, also past the HTTP cache) is not asked for again for this long. */
  const PACK_BACKOFF_MS = 10_000
  const packFailed = new Map<string, number>()
  let bypassPackCache = false

  /** Run `op` against the manifest; one pack 404 (or short body) triggers one manifest refetch and one retry past the HTTP cache. */
  const withManifest = async <T>(signal: AbortSignal, op: (manifest: BrandedManifest) => Promise<T>): Promise<T> => {
    const manifest = await manifestFor(signal)
    try {
      return await op(manifest)
    } catch (error) {
      if (!(error instanceof Failure) || error.reason !== 'stale') throw error
      const fresh = await reloadManifest(signal, manifest)
      bypassPackCache = true
      try {
        const out = await op(fresh)
        for (const key of [...packFailed.keys()]) if (!fresh.packs.some((entry) => entry[0] === key)) packFailed.delete(key)
        return out
      } catch (again) {
        if (again instanceof Failure && again.reason === 'stale') {
          if (again.pack) packFailed.set(again.pack, Date.now() + PACK_BACKOFF_MS)
          throw new Failure('bad-response')
        }
        throw again
      } finally { bypassPackCache = false }
    }
  }

  /** Gzipped bytes [offset, offset+length) of pack `index` through one shared Range request. */
  const fetchRaw = (manifest: BrandedManifest, pack: number, offset: number, length: number, signal: AbortSignal): Promise<Uint8Array> => {
    const entry = manifest.packs[pack]
    if (!entry) return Promise.reject(new Failure('bad-manifest'))
    if (rangeOff.has(entry[0])) return Promise.reject(new Failure('range-unsupported'))
    const blockedUntil = packFailed.get(entry[0])
    if (blockedUntil !== undefined && Date.now() < blockedUntil) return Promise.reject(new Failure('bad-response'))
    const key = `${entry[0]}:${offset}:${length}`
    return joinShared(inflightBytes, key, async (s) => {
      const response = await request(entry[0], { Range: `bytes=${offset}-${offset + length - 1}` }, s, bypassPackCache ? 'reload' : 'default')
      if (response.status === 404) throw new Failure('stale', entry[0])
      if (response.status === 206) {
        const body = new Uint8Array(await response.arrayBuffer())
        if (body.length !== length) throw new Failure('stale', entry[0])
        stats.bytes += body.length
        return body
      }
      if (response.status === 200) {
        // The server ignored Range and is sending the whole pack. Take it only when it is small; otherwise stop reading, and use no
        // more of this pack in this session.
        stats.fullPackFallbacks += 1
        const declared = Number(response.headers.get('content-length'))
        const body = declared > Math.min(FULL_BODY_LIMIT, Math.max(length * 8, 262_144)) ? (await response.body?.cancel().catch(() => undefined), undefined) : await readCapped(response, FULL_BODY_LIMIT)
        if (!body) { rangeOff.add(entry[0]); throw new Failure('range-unsupported') }
        stats.bytes += body.length
        if (offset + length > body.length) throw new Failure('bad-response')
        return body.slice(offset, offset + length)
      }
      throw new Failure('bad-response')
    }, signal)
  }

  /** A gunzipped shard: from the persistent cache when it decodes, else from the network (cached only once it decodes). */
  const loadShard = async (manifest: BrandedManifest, places: number[], shard: number, signal: AbortSignal): Promise<Uint8Array> => {
    const pack = places[shard * 3] as number
    const offset = places[shard * 3 + 1] as number
    const length = places[shard * 3 + 2] as number
    if (!Number.isInteger(pack) || !Number.isInteger(offset) || !Number.isInteger(length)) throw new Failure('bad-manifest')
    const entry = manifest.packs[pack]
    if (!entry) throw new Failure('bad-manifest')
    const key = `${entry[0]}:${offset}:${length}`
    const cached = await clientOptions.shardCache?.get(key)
    if (cached && cached.length === length) {
      try { return await gunzip(cached) } catch { /* a bad cached copy: fetch it again */ }
    }
    const raw = await fetchRaw(manifest, pack, offset, length, signal)
    let bytes: Uint8Array
    try { bytes = await gunzip(raw) } catch { throw new Failure('bad-shard') }
    if (clientOptions.shardCache) void Promise.resolve(clientOptions.shardCache.put(key, raw)).catch(() => undefined)
    return bytes
  }

  const loadText = async (manifest: BrandedManifest, places: number[], shard: number, signal: AbortSignal): Promise<string> => decoder.decode(await loadShard(manifest, places, shard, signal))

  // ---- detail ------------------------------------------------------------------------------------------------------

  const detailShardIndex = (manifest: BrandedManifest, gtin: number): number => {
    const starts = manifest.detail.starts
    let low = 0
    let high = starts.length - 1
    let found = -1
    while (low <= high) {
      const mid = (low + high) >> 1
      if ((starts[mid] as number) <= gtin) { found = mid; low = mid + 1 } else high = mid - 1
    }
    return found
  }

  const loadDetail = async (manifest: BrandedManifest, shard: number, signal: AbortSignal): Promise<DetailShard> => {
    const key = `d${shard}`
    const cached = detailCache.get(key)
    if (cached) return cached
    const text = await loadText(manifest, manifest.detail.places, shard, signal)
    let rows: unknown
    try { rows = JSON.parse(text) } catch { throw new Failure('bad-shard') }
    if (!Array.isArray(rows)) throw new Failure('bad-shard')
    const gtins: number[] = []
    let running = 0
    for (const row of rows as unknown[][]) {
      if (!Array.isArray(row) || typeof row[0] !== 'number') throw new Failure('bad-shard')
      running += row[0]
      gtins.push(running)
    }
    const decoded = { gtins, rows: rows as unknown[][] }
    detailCache.set(key, decoded)
    return decoded
  }

  const productFromRow = (manifest: BrandedManifest, gtin: number, row: unknown[]): BrandedProduct | undefined => {
    const [, fdc, name, brand, category, size, flags, household, kcal, protein, fat, carbs, mask] = row
    if (typeof name !== 'string' || typeof kcal !== 'number' || typeof protein !== 'number' || typeof fat !== 'number' || typeof carbs !== 'number' || typeof mask !== 'number') return undefined
    const flagBits = typeof flags === 'number' ? flags : 0
    const unit: 'g' | 'ml' = flagBits & 1 ? 'ml' : 'g'
    const nutrients: NutrientValues = {}
    let addedSugar: number | undefined
    let cursor = 13
    manifest.nutrients.optional.forEach((key, index) => {
      if (Math.floor(mask / 2 ** index) % 2 !== 1) return
      const value = row[cursor]
      cursor += 1
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return
      if (key === 'addedSugar') addedSugar = value
      else if ((NUTRIENT_KEYS as string[]).includes(key)) nutrients[key as NutrientKey] = value
    })
    const servingSize = typeof size === 'number' && size > 0 ? size : 0
    const householdText = typeof household === 'string' && household !== '' ? household : undefined
    const label = servingSize > 0 ? servingLabel(householdText, servingSize, unit) : undefined
    return {
      gtin: String(gtin).padStart(14, '0'),
      fdcId: typeof fdc === 'number' ? fdc : 0,
      name,
      brand: typeof brand === 'string' ? brand : '',
      category: typeof category === 'number' ? manifest.categories[category] ?? '' : '',
      ...(unit === 'ml' ? { unit: 'ml' as const } : {}),
      ...(servingSize > 0 && label ? { serving: { size: servingSize, unit, ...(householdText ? { household: householdText } : {}), label } } : {}),
      per100: { calories: kcal, protein, fat, carbs },
      nutrients,
      ...(addedSugar !== undefined ? { addedSugar } : {}),
      ...(flagBits & 2 ? { labelRounded: true } : {}),
      ...(flagBits & 4 ? { discontinued: true } : {}),
    }
  }

  const findProduct = async (candidates: string[], signal: AbortSignal): Promise<BrandedProduct | undefined> =>
    withManifest(signal, async (manifest) => {
      for (const candidate of candidates) {
        const gtin = Number(candidate)
        const shard = detailShardIndex(manifest, gtin)
        if (shard < 0) continue
        const detail = await loadDetail(manifest, shard, signal)
        let low = 0
        let high = detail.gtins.length - 1
        while (low <= high) {
          const mid = (low + high) >> 1
          const value = detail.gtins[mid] as number
          if (value === gtin) {
            const product = productFromRow(manifest, gtin, detail.rows[mid] as unknown[])
            if (!product) throw new Failure('bad-shard')
            return product
          }
          if (value < gtin) low = mid + 1; else high = mid - 1
        }
      }
      return undefined
    })

  const lookup = async (code: string | number, options: BrandedOptions | undefined, scanning: boolean): Promise<BrandedProduct | undefined> => {
    const all = gtinCandidates(code)
    const candidates = scanning ? all.filter((candidate) => !isLocalKey(candidate)) : all
    if (all.length === 0) { reason = 'bad-code'; options?.onReason?.('bad-code'); return undefined }
    if (candidates.length === 0) { reason = 'not-found'; options?.onReason?.('not-found'); return undefined }
    const product = await guarded(options, LOOKUP_TIMEOUT_MS, ({ signal }) => findProduct(candidates, signal))
    if (product === undefined && reason === undefined) { reason = 'not-found'; options?.onReason?.('not-found') }
    return product
  }

  // ---- search ------------------------------------------------------------------------------------------------------

  const indexFor = (manifest: BrandedManifest): Index => {
    if (indexValue?.manifest === manifest) return indexValue.index
    const common = new Map<string, number>()
    for (const entry of manifest.common.split(' ')) {
      const at = entry.lastIndexOf(':')
      if (at > 0) common.set(entry.slice(0, at), parseInt(entry.slice(at + 1), 36))
    }
    const brand = new Set(manifest.brandTokens)
    const index: Index = { common, commonTokens: [...common.keys()].filter((key) => !key.includes('+')).sort(), typoTokens: [...new Set([...manifest.brandTokens, ...[...common.keys()].filter((key) => !key.includes('+'))])], brand, dominant: new Set(manifest.brandDominant) }
    indexValue = { manifest, index }
    return index
  }

  const parseSummaryLines = (lines: string[], startOrdinal: number, absolute: boolean, manifest: BrandedManifest): Row[] => {
    const rows: Row[] = []
    let running = 0
    lines.forEach((line, at) => {
      const parts = line.split('\t')
      if (parts.length < 9) return
      running = (absolute ? 0 : running) + parseInt(parts[0] as string, 36)
      rows.push({
        ordinal: startOrdinal < 0 ? -1 : startOrdinal + at,
        gtin: running,
        name: parts[1] as string,
        brand: parts[2] as string,
        kcal: Number(parts[3]),
        serving: parts[4] as string,
        popQ: parseInt(parts[5] as string, 36) || 0,
        ml: parts[6] === '1',
        category: manifest.categories[parseInt(parts[7] as string, 36)] ?? '',
        sizes: Number(parts[8]) || 1,
      })
    })
    return rows
  }

  const loadBlock = async (manifest: BrandedManifest, block: number, signal: AbortSignal): Promise<Row[]> => {
    const key = `b${block}`
    const cached = blockCache.get(key)
    if (cached) return cached
    const text = await loadText(manifest, manifest.summaries.places, block, signal)
    const rows = parseSummaryLines(text.split('\n'), block * manifest.summaries.rows, false, manifest)
    blockCache.set(key, rows)
    return rows
  }

  let popValue: { manifest: BrandedManifest; bytes: Uint8Array } | undefined
  const loadPop = async (manifest: BrandedManifest, signal: AbortSignal): Promise<Uint8Array> => {
    if (popValue?.manifest === manifest) return popValue.bytes
    const bytes = await loadShard(manifest, manifest.pop.places, 0, signal)
    if (bytes.length !== manifest.products) throw new Failure('bad-shard')
    popValue = { manifest, bytes }
    return bytes
  }

  const loadPosts = async (manifest: BrandedManifest, shard: number, signal: AbortSignal): Promise<PostsShard> => {
    const key = `p${shard}`
    const cached = postsCache.get(key)
    if (cached) return cached
    const bytes = await loadShard(manifest, manifest.posts.places, shard, signal)
    const tokens: string[] = []
    const df: number[] = []
    const starts: number[] = []
    const ends: number[] = []
    let at = 0
    const varint = (): number => {
      let value = 0
      let scale = 1
      for (;;) {
        if (at >= bytes.length) throw new Failure('bad-shard')
        const byte = bytes[at++] as number
        value += (byte & 127) * scale
        if (!(byte & 128)) return value
        scale *= 128
      }
    }
    const count = varint()
    for (let index = 0; index < count; index += 1) {
      const length = varint()
      if (at + length > bytes.length) throw new Failure('bad-shard')
      tokens.push(decoder.decode(bytes.subarray(at, at + length)))
      at += length
      df.push(varint())
      const size = varint()
      if (at + size > bytes.length) throw new Failure('bad-shard')
      starts.push(at)
      ends.push(at + size)
      at += size
    }
    const decoded = { bytes, tokens, df, starts, ends }
    postsCache.set(key, decoded)
    return decoded
  }

  const loadHeads = async (manifest: BrandedManifest, shard: number, signal: AbortSignal): Promise<Map<string, Row[]>> => {
    const key = `h${shard}`
    const cached = headsCache.get(key)
    if (cached) return cached
    const text = await loadText(manifest, manifest.heads.places, shard, signal)
    const out = new Map<string, Row[]>()
    let token: string | undefined
    let lines: string[] = []
    const flush = () => { if (token !== undefined) out.set(token, parseSummaryLines(lines, -1, true, manifest)); lines = [] }
    for (const line of text.split('\n')) {
      if (line.startsWith('#')) { flush(); token = line.slice(1) } else lines.push(line)
    }
    flush()
    headsCache.set(key, out)
    return out
  }

  const rankOf = (row: Row): RankRow => {
    if (!row.rank) {
      const nameTokens = searchTokens(row.name)
      const brandCore = searchTokens(row.brand)
      const brandTokens = [...brandCore, ...compoundTokens(row.brand)]
      row.rank = { nameTokens, brandTokens, brandCore, pop: row.popQ / 4, category: row.category.toLowerCase() }
      row.words = new Set([...nameTokens, ...brandTokens])
    }
    return row.rank
  }

  interface Resolved { typed: string; token: string; forms: string[]; prefix: boolean; common: boolean; df: number; required: boolean; shard?: number; alts?: Resolved[] }

  /** Find a token's entry in the postings shard that holds it. */
  const postsEntry = (shard: PostsShard | undefined, token: string): number => (shard ? shard.tokens.indexOf(token) : -1)

  const runSearchOnce = async (query: string, limit: number, maxBlocks: number | undefined, signal: AbortSignal, preset: string[] | undefined, typing: boolean): Promise<BrandedSummary[]> => {
    let typedTokens = preset ?? [...new Set(searchTokens(query))]
    if (typedTokens.length === 0) throw new Failure('empty-query')
    return withManifest(signal, async (manifest) => {
      const index = indexFor(manifest)
      // "la croix" also finds LaCroix: two neighbouring words whose join is a known brand word are also searched as that one word (the
      // index files "La Croix" under lacroix as well), and the answers are merged. Two common words ('peanut butter') are never joined.
      if (!preset) {
        for (let at = 0; at + 1 < typedTokens.length; at += 1) {
          const joined = stem((typedTokens[at] as string) + (typedTokens[at + 1] as string)).slice(0, MAX_TOKEN)
          const bothCommon = index.common.has(typedTokens[at] as string) && index.common.has(typedTokens[at + 1] as string)
          if (!/^[a-z]+$/.test(joined) || !index.brand.has(joined) || bothCommon) continue
          const [main, extra] = await Promise.all([runSearchOnce(query, limit, maxBlocks, signal, typedTokens, typing), runSearchOnce(query, limit, maxBlocks, signal, [...typedTokens.slice(0, at), joined, ...typedTokens.slice(at + 2)], typing)])
          const seen = new Set(main.flatMap((item) => [item.gtin, ...(item.variants ?? [])]))
          return [...main, ...extra.filter((item) => !seen.has(item.gtin))].slice(0, limit)
        }
      }
      const lastTyped = typedTokens[typedTokens.length - 1] as string
      // The word being typed may be a prefix, unless the query ends in a space.
      const endsTyping = typing && !/\s$/.test(query)
      let requests = 0
      const counted = async <T>(work: Promise<T>): Promise<T> => { requests += 1; return work }

      // Keep at most four words: rare ones first, then the least common of the rest.
      let tokens = typedTokens
      if (tokens.length > 4) {
        const rank = (token: string) => index.common.get(token) ?? 0
        tokens = [...tokens].sort((a, b) => rank(a) - rank(b) || tokens.indexOf(a) - tokens.indexOf(b)).slice(0, 4)
        tokens.sort((a, b) => typedTokens.indexOf(a) - typedTokens.indexOf(b))
      }
      const formsOf = new Map(tokens.map((token) => [token, spellings(token, token === lastTyped && endsTyping)]))

      const rankTerms = (list: Resolved[]): RankTerm[] => list.map((entry) => {
        const qualifier = /^\d/.test(entry.token)
        return { variants: entry.prefix ? [entry.typed] : entry.forms, prefix: entry.prefix, generic: !qualifier && !index.dominant.has(entry.token), qualifier }
      })
      const matches = (row: Row, list: Resolved[]): boolean => {
        rankOf(row)
        const words = row.words as Set<string>
        return list.every((entry) => {
          if (!entry.required) return true
          if (entry.prefix) { for (const word of words) if (word.startsWith(entry.typed)) return true; return false }
          return entry.forms.some((form) => words.has(form))
        })
      }
      /** Rank rows against the resolved words, collapse identical brand + name into one result with a size count. */
      const finish = (rows: Row[], list: Resolved[]): BrandedSummary[] => {
        const scoreTerms = rankTerms(list)
        const scored = rows.filter((row) => matches(row, list)).map((row) => ({ row, score: rowScore(rankOf(row), scoreTerms) }))
        scored.sort((a, b) => b.score - a.score || a.row.gtin - b.row.gtin)
        // One result per brand + name. A suspect record (all zero while its siblings have values; popQ 0) never represents a group that
        // has other members; sizes are the distinct (energy, serving) pairs, one barcode each.
        const signature = (row: Row) => `${Math.round(row.kcal)}|${row.serving}|${row.ml ? 'ml' : 'g'}`
        const groups = new Map<string, Array<{ row: Row; score: number }>>()
        for (const entry of scored) {
          const key = `${entry.row.name.toLowerCase()}|${entry.row.brand.toLowerCase()}`
          const list = groups.get(key)
          if (list) list.push(entry); else groups.set(key, [entry])
        }
        return [...groups.values()].slice(0, limit).map((members) => {
          const real = members.filter((entry) => entry.row.popQ > 0)
          const pool = real.length > 0 ? real : members
          const best = pool[0] as { row: Row; score: number }
          const bySignature = new Map<string, Row>()
          for (const entry of pool) if (!bySignature.has(signature(entry.row))) bySignature.set(signature(entry.row), entry.row)
          const row = best.row
          const sizes = bySignature.size // exactly the barcodes in variants, so "N sizes" equals the picker chips
          const variants = [...bySignature.values()].map((item) => item.gtin).sort((a, b) => a - b).map((gtin) => String(gtin).padStart(14, '0'))
          return {
            gtin: String(row.gtin).padStart(14, '0'), name: row.name, brand: row.brand, kcal: row.kcal, serving: row.serving, query,
            ...(row.ml ? { unit: 'ml' as const } : {}),
            ...(sizes > 1 ? { sizes } : {}),
            ...(variants.length > 1 ? { variants } : {}),
          }
        })
      }
      const headRows = async (key: string): Promise<Row[]> => {
        const shard = sortedIndexOf(manifest.heads.first, key)
        if (shard < 0) return []
        const heads = await counted(loadHeads(manifest, shard, signal))
        return heads.get(key) ?? []
      }

      // Stage 1: a single common word is answered by its head list (a limit above the head size asks for the whole match set).
      const provisional: Resolved[] = tokens.map((token) => {
        const forms = formsOf.get(token) as string[]
        const hit = forms.find((form) => index.common.has(form))
        return hit !== undefined
          ? { typed: token, token: hit, forms, prefix: false, common: true, df: index.common.get(hit) as number, required: true }
          : { typed: token, token, forms, prefix: token === lastTyped && endsTyping, common: false, df: 0, required: true }
      })
      if (provisional.length === 1 && provisional[0]?.common && limit <= HEAD_LIMIT) return finish(await headRows((provisional[0] as Resolved).token), provisional)

      // Stage 2: words that are not common live in a postings shard. Load those shards in parallel.
      const shardFor = (token: string) => sortedIndexOf(manifest.posts.first, token)
      const loaded = new Map<number, PostsShard>()
      const ensure = async (shards: number[]) => {
        const wanted = [...new Set(shards)].filter((shard) => shard >= 0 && !loaded.has(shard))
        const got = await Promise.all(wanted.map((shard) => counted(loadPosts(manifest, shard, signal))))
        wanted.forEach((shard, at) => loaded.set(shard, got[at] as PostsShard))
      }
      await ensure(tokens.flatMap((token) => (provisional.find((entry) => entry.typed === token)?.common ? [] : (formsOf.get(token) as string[]).map(shardFor))))

      const resolve = (entry: Resolved): Resolved | undefined => {
        if (entry.common) return entry
        for (const form of entry.forms) {
          const shard = shardFor(form)
          const at = postsEntry(loaded.get(shard), form)
          if (at >= 0) return { ...entry, token: form, df: (loaded.get(shard) as PostsShard).df[at] as number, shard, prefix: false }
        }
        return undefined
      }
      const resolved: Array<Resolved | undefined> = provisional.map(resolve)

      // The word being typed is ALWAYS a prefix union: the exact word and every longer word that starts with it (the most common few).
      // No earlier word is ever dropped to get results. Words with no entry at all are spelled again (a near known word).
      const PREFIX_ALTS = 6
      const repairs: Array<Promise<void>> = []
      resolved.forEach((entry, at) => {
        const token = tokens[at] as string
        const typing = token === lastTyped && endsTyping && token.length >= 2 && /^[a-z]/.test(token)
        if (entry && !typing) return
        repairs.push((async () => {
          if (typing) {
            const found: Resolved[] = []
            for (const candidate of index.commonTokens) {
              if (candidate !== entry?.token && candidate.startsWith(token)) found.push({ typed: token, token: candidate, forms: [token], prefix: true, common: true, df: index.common.get(candidate) as number, required: true })
            }
            if (token.length >= 3) {
              const shard = shardFor(token)
              const around = shard >= 0 ? [shard, ...(manifest.posts.first[shard + 1]?.startsWith(token) ? [shard + 1] : [])] : []
              await ensure(around)
              for (const at2 of around) {
                const posts = loaded.get(at2)
                if (!posts) continue
                for (let k = 0; k < posts.tokens.length; k += 1) {
                  const candidate = posts.tokens[k] as string
                  if (candidate !== entry?.token && candidate.startsWith(token) && !index.common.has(candidate)) found.push({ typed: token, token: candidate, forms: [token], prefix: true, common: false, df: posts.df[k] as number, required: true, shard: at2 })
                }
              }
            }
            if (found.length > 0) {
              found.sort((x, y) => y.df - x.df)
              const top = found.slice(0, PREFIX_ALTS)
              const primary = top[0] as Resolved
              const alts = [...top.slice(1), ...(entry ? [entry] : [])]
              primary.alts = alts
              primary.df = top.reduce((sum, item) => sum + item.df, 0) + (entry?.df ?? 0)
              resolved[at] = primary
              return
            }
          }
          if (entry) return
          const max = token.length >= 8 ? 2 : token.length >= 5 ? 1 : 0
          if (max > 0 && /^[a-z]+$/.test(token)) {
            let bestToken: string | undefined
            let bestDistance = max + 1
            for (const candidate of index.typoTokens) {
              const bound = Math.min(max, bestDistance)
              const distance = editDistance(token, candidate, bound)
              // The nearest spelling wins; among equally near ones the commoner word ('butter', not 'butera').
              if (distance < bestDistance || (distance === bestDistance && bestToken !== undefined && (index.common.get(candidate) ?? 0) > (index.common.get(bestToken) ?? 0))) { bestDistance = distance; bestToken = candidate }
            }
            if (bestToken) {
              const df = index.common.get(bestToken)
              if (df !== undefined) { resolved[at] = { typed: token, token: bestToken, forms: [bestToken], prefix: false, common: true, df, required: true }; return }
              const shard = shardFor(bestToken)
              await ensure([shard])
              const found = postsEntry(loaded.get(shard), bestToken)
              if (found >= 0) resolved[at] = { typed: token, token: bestToken, forms: [bestToken], prefix: false, common: false, df: (loaded.get(shard) as PostsShard).df[found] as number, required: true, shard }
            }
          }
        })())
      })
      await Promise.all(repairs)
      // A word that matches nothing and cannot be spelled again means no product carries every word: no results, not results without it.
      if (resolved.some((entry, at) => !entry && /^[a-z]{3,}$/.test(tokens[at] as string))) return []
      const kept = resolved.filter((entry): entry is Resolved => entry !== undefined)
      if (kept.length === 0) return []

      const commons = kept.filter((entry) => entry.common).sort((a, b) => a.df - b.df)
      const rares = kept.filter((entry) => !entry.common).sort((a, b) => a.df - b.df)
      const listOf = (entry: Resolved): number[] => {
        const shard = loaded.get(entry.shard as number) as PostsShard
        const at = shard.tokens.indexOf(entry.token)
        return parseVarints(shard.bytes, shard.starts[at] as number, shard.ends[at] as number)
      }
      // A repaired single common word (a typo, a prefix) has its head too.
      if (rares.length === 0 && commons.length === 1 && limit <= HEAD_LIMIT) return finish(await headRows((commons[0] as Resolved).token), kept)

      // Candidates, EXACTLY: the ordinals that carry every word. When the rarest word has few products, every word's postings are read
      // and intersected; when all words are huge, the two rarest are intersected and the summaries check the rest.
      const smallest = Math.min(rares[0]?.df ?? Infinity, commons[0]?.df ?? Infinity)
      let sources: Resolved[] = smallest <= EXACT_DF ? [...rares, ...commons] : [...rares, ...commons].sort((a, b) => a.df - b.df).slice(0, 2)
      sources = sources.slice(0, 4)
      const toLoad = sources.flatMap((entry) => [entry, ...(entry.alts ?? [])]).filter((entry) => entry.common)
      for (const entry of toLoad) entry.shard = shardFor(entry.token)
      await ensure(toLoad.map((entry) => entry.shard as number))
      sources = [...sources].sort((a, b) => a.df - b.df)
      const lists = new Map<Resolved, number[]>()
      const listFor = (entry: Resolved): number[] => {
        let list = lists.get(entry)
        if (!list) {
          list = listOf(entry)
          for (const extra of entry.alts ?? []) list = unionSorted(list, listOf(extra))
          lists.set(entry, list)
        }
        return list
      }
      // Every word counts: when the words do not meet in one product, the answer is nothing (the caller keeps showing the last rows).
      let candidates: number[] = listFor(sources[0] as Resolved)
      for (const entry of sources.slice(1)) candidates = intersectSorted(candidates, listFor(entry))
      if (candidates.length === 0) return []

      // Summaries: a small match set is read whole (every block it touches); a large one is ranked by popularity first, and only the
      // blocks that hold its best candidates are read.
      const blockRows = manifest.summaries.rows
      const blockOf = (ordinal: number) => Math.floor(ordinal / blockRows)
      const unlimited = maxBlocks !== undefined && maxBlocks > 64
      const requestCap = unlimited ? Infinity : MAX_REQUESTS_PER_SEARCH
      const wanted = new Set(candidates)
      const collected: Row[] = []
      const readBlocks = async (blocks: number[]) => {
        for (let at = 0; at < blocks.length; at += 24) {
          const lists2 = await Promise.all(blocks.slice(at, at + 24).map((block) => counted(loadBlock(manifest, block, signal))))
          for (const list of lists2) for (const row of list) if (wanted.has(row.ordinal)) collected.push(row)
        }
      }
      const touched = [...new Set(candidates.map(blockOf))]
      if (unlimited || (candidates.length <= SMALL_SET && touched.length <= (maxBlocks ?? SMALL_SET_BLOCKS))) {
        await readBlocks(touched)
        return finish(collected, kept)
      }
      // A big match set: the head of its most specific adjacent word pair, else of its least common common word (the best products of
      // that word), usually already holds the best answers; only products that carry every word count.
      let fromHead: Row[] = []
      if (limit <= HEAD_LIMIT) {
        let headKey = commons[0]?.token
        let headDf = Infinity
        for (let at = 0; at + 1 < tokens.length; at += 1) {
          const a = kept.find((entry) => entry.typed === tokens[at])
          const b = kept.find((entry) => entry.typed === tokens[at + 1])
          if (!a || !b || a.prefix || b.prefix) continue
          for (const key of [`${a.token}+${b.token}`, `${b.token}+${a.token}`]) { const df = index.common.get(key); if (df !== undefined && df < headDf) { headKey = key; headDf = df } }
        }
        if (headKey !== undefined) {
          fromHead = await headRows(headKey)
          const good = finish(fromHead, kept)
          if (good.length >= Math.min(limit, 12)) return good
        }
      }
      collected.push(...fromHead)
      const pop = await counted(loadPop(manifest, signal))
      const order = [...candidates].sort((a, b) => (pop[b] as number) - (pop[a] as number) || a - b)
      const weight = new Map<number, number>()
      order.slice(0, Math.max(60, limit * 3)).forEach((ordinal, rank) => { const block = blockOf(ordinal); weight.set(block, (weight.get(block) ?? 0) + 1 / (1 + rank)) })
      const ranked = [...weight.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map((entry) => entry[0])
      const allowed = maxBlocks ?? MAX_BLOCKS
      const first = Math.max(1, Math.min(allowed, 3, requestCap - requests))
      await readBlocks(ranked.slice(0, first))
      const results = finish(collected, kept)
      const left = Math.min(requestCap - requests, allowed - first)
      if (results.length >= Math.min(limit, 8) || left <= 0 || ranked.length <= first) return results
      await readBlocks(ranked.slice(first, first + left))
      return finish(collected, kept)
    })
  }

  /**
   * The last word is first read as still being typed (a prefix union). Only when that finds nothing, and the query is not just a
   * short word, is the same query read as typed in full, which is when a misspelling may be repaired.
   */
  const runSearch = async (query: string, limit: number, maxBlocks: number | undefined, signal: AbortSignal): Promise<BrandedSummary[]> => {
    const rows = await runSearchOnce(query, limit, maxBlocks, signal, undefined, true)
    const words = searchTokens(query)
    if (rows.length > 0 || /\s$/.test(query) || (words[words.length - 1] ?? '').length < 4) return rows
    return runSearchOnce(query, limit, maxBlocks, signal, undefined, false)
  }

  return {
    stats,
    warm: async () => {
      try {
        const keep = new AbortController()
        const manifest = await manifestFor(keep.signal)
        await loadPop(manifest, keep.signal)
      } catch { /* the first search will try again */ }
    },
    lastReason: () => reason,
    reset: () => {
      manifestValue = undefined; indexValue = undefined; inflightManifest.clear(); inflightBytes.clear(); rangeOff.clear()
      popValue = undefined; detailCache.clear(); blockCache.clear(); postsCache.clear(); headsCache.clear(); reason = undefined
    },
    loadManifest: async (options) => guarded(options, MANIFEST_TIMEOUT_MS, ({ signal }) => manifestFor(signal)),
    lookupBarcode: (code, options) => lookup(code, options, true),
    getProduct: (gtin, options) => lookup(gtin, options, false),
    searchBranded: async (query, options) => {
      const limit = Math.max(1, Math.floor(options?.limit ?? 20))
      const maxBlocks = options?.maxShards === undefined ? undefined : Math.max(1, Math.floor(options.maxShards))
      const sequence = (searchSeq += 1)
      const control = new AbortController()
      if (options?.latestOnly) { previousSearch?.abort(); previousSearch = control }
      const stale = () => (options?.latestOnly && sequence !== searchSeq ? 'stale' as const : undefined)
      const timeoutMs = options?.timeoutMs ?? SEARCH_TIMEOUT_MS
      // A search that timed out is tried once more: the shards that did arrive are in the cache by then.
      let result = await guarded({ ...options, onReason: undefined }, timeoutMs, ({ signal }) => runSearch(query, limit, maxBlocks, signal), control, stale)
      if (result === undefined && reason === 'timeout' && !stale() && !options?.signal?.aborted) {
        const again = new AbortController()
        if (options?.latestOnly) previousSearch = again
        result = await guarded(options, timeoutMs, ({ signal }) => runSearch(query, limit, maxBlocks, signal), again, stale)
      } else if (result === undefined && reason) options?.onReason?.(reason)
      if (stale()) { reason = 'stale'; if (result !== undefined) options?.onReason?.('stale'); return [] }
      return result ?? []
    },
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Shared client and CatalogFood bridge
// ---------------------------------------------------------------------------------------------------------------------

const shared = createBrandedClient()

/** Fetch (once) and cache the manifest. Resolves undefined, never rejects, when it cannot be loaded; a failure is not remembered. */
export const loadManifest = (options?: BrandedOptions): Promise<BrandedManifest | undefined> => shared.loadManifest(options)
/** The product with this barcode (UPC-A, EAN-13, EAN-8, UPC-E, GTIN-14, with or without separators), or undefined. Store-local codes never match. */
export const lookupBarcode = (code: string | number, options?: BrandedOptions): Promise<BrandedProduct | undefined> => shared.lookupBarcode(code, options)
/** The full record for a GTIN from a search result. */
export const getProduct = (gtin: string | number, options?: BrandedOptions): Promise<BrandedProduct | undefined> => shared.getProduct(gtin, options)
/**
 * Ranked summaries for a typed query: every word must match a word of the name or brand (the word being typed may be a prefix; a
 * mistyped brand word is repaired). Each result carries `query`; pass `latestOnly` from a type-ahead box. [] on any failure.
 */
export const searchBranded = (query: string, options?: SearchOptions): Promise<BrandedSummary[]> => shared.searchBranded(query, options)
/** Why the last call that came back empty failed, for diagnostics. */
export const lastBrandedReason = (): BrandedReason | undefined => shared.lastReason()
/** Forget everything cached in memory (tests, and a retry after a long outage). */
export const resetBranded = (): void => shared.reset()

/**
 * A catalog food from the branded index. Identical to CatalogFood except `source` (widening CatalogFood.source, DiaryEntry.catalogSource
 * and its validator in src/lib/backup.ts is the UI phase's job: a stored entry with an unknown source would fail backup validation),
 * plus `unit` ('ml' for a liquid: per100g then means per 100 ml and portion sizes are millilitres; log such a food in ml) and
 * `labelRounded` (show "0 kcal per serving (label)").
 */
export type BrandedCatalogFood = Omit<CatalogFood, 'source'> & { source: 'USDA Branded'; unit?: 'ml'; labelRounded?: boolean; discontinued?: boolean }

export const BRANDED_ID_PREFIX = 'usda-branded-'

/** Whether a catalog id belongs to a branded product. */
export const isBrandedId = (id: string): boolean => id.startsWith(BRANDED_ID_PREFIX)

/**
 * The shape the app uses for USDA foods. The name carries the brand unless it already starts or contains it. Portions come from the
 * label serving, in grams, or in millilitres when `unit` is 'ml' (a liquid is never converted to grams here). Fields the CatalogFood
 * type has no slot for (micronutrients) go through brandedNutrientSnapshot.
 */
export const toCatalogFood = (product: BrandedProduct): BrandedCatalogFood => {
  const brand = product.brand.trim()
  const name = brand && !product.name.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${product.name}` : product.name
  const ml = product.unit === 'ml' || product.serving?.unit === 'ml'
  return {
    id: `${BRANDED_ID_PREFIX}${product.gtin}`,
    fdcId: product.fdcId,
    name,
    category: product.category,
    source: 'USDA Branded',
    per100g: { calories: product.per100.calories, protein: product.per100.protein, carbs: product.per100.carbs, fat: product.per100.fat },
    ...(product.serving ? { portions: [[product.serving.label, product.serving.size]] as Array<[string, number]> } : {}),
    brand: brand || undefined,
    gtin: product.gtin,
    ...(ml ? { unit: 'ml' as const } : {}),
    ...(product.labelRounded ? { labelRounded: true } : {}),
    ...(product.discontinued ? { discontinued: true } : {}),
  }
}

/** Per-100 g (or per 100 ml) nutrients of a product, the same keys as the SR Legacy nutrient table. Absent stays absent. */
export const brandedNutrientsPer100g = (product: BrandedProduct): NutrientValues => ({ ...product.nutrients })

/** The snapshot of every nutrient the label has for `grams` (millilitres for a liquid) of the product, ready to spread into a diary entry (rounded like the SR Legacy snapshot). */
export const brandedNutrientSnapshot = (product: BrandedProduct, grams: number): NutrientValues => {
  if (!(grams > 0) || !Number.isFinite(grams)) return {}
  return scaleNutrientsPer100g(product.nutrients, grams)
}
