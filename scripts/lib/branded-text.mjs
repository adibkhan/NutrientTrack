// Text, barcode and ranking helpers shared by the branded-foods build (scripts/build-usda-branded.mjs). The browser side
// (src/catalog/branded.ts) mirrors the tokeniser, the stem, the serving label and the row score; src/catalog/brandedBuild.test.ts
// holds the parity tests, so change both together.

// ---------------------------------------------------------------------------------------------------------------------
// Barcodes
// ---------------------------------------------------------------------------------------------------------------------

/** GS1 mod-10 check digit that must follow `body` (a digit string without its check digit). */
export const checkDigitFor = (body) => {
  let sum = 0
  for (let index = body.length - 1, weight = 3; index >= 0; index -= 1, weight = weight === 3 ? 1 : 3) sum += Number(body[index]) * weight
  return (10 - (sum % 10)) % 10
}

/** Whether a digit string ends in a correct GS1 check digit (any length). */
export const hasValidCheckDigit = (digits) => digits.length >= 2 && checkDigitFor(digits.slice(0, -1)) === Number(digits[digits.length - 1])

/** Digits of a barcode string (separators allowed), or undefined when it holds anything else or cannot be a barcode. */
export const barcodeDigits = (raw) => {
  const text = String(raw ?? '').trim()
  if (!/^[\d\s-]+$/.test(text)) return undefined
  const digits = text.replace(/\D/g, '')
  if (digits.length < 8 || digits.length > 14) return undefined
  // All zeros and other placeholder codes ("00000123") are not barcodes.
  if (digits.replace(/^0+/, '').length < 6) return undefined
  return digits
}

/** Canonical 14-digit GTIN of a barcode string or undefined. No repair: see gtinKey for the build's repairs. */
export const normalizeGtin = (raw) => barcodeDigits(raw)?.padStart(14, '0')

/** Expand an 8-digit UPC-E (number system, six digits, check digit) to its 12-digit UPC-A. Undefined when it is not a UPC-E. */
export const expandUpcE = (code) => {
  if (!/^\d{8}$/.test(code) || (code[0] !== '0' && code[0] !== '1')) return undefined
  const d = code.slice(1, 7)
  const last = d[5]
  let body
  if (last === '0' || last === '1' || last === '2') body = `${d[0]}${d[1]}${last}0000${d[2]}${d[3]}${d[4]}`
  else if (last === '3') body = `${d[0]}${d[1]}${d[2]}00000${d[3]}${d[4]}`
  else if (last === '4') body = `${d[0]}${d[1]}${d[2]}${d[3]}00000${d[4]}`
  else body = `${d[0]}${d[1]}${d[2]}${d[3]}${d[4]}0000${last}`
  return `${code[0]}${body}${code[7]}`
}

/**
 * The key a source barcode is filed under: its 14-digit form, except that a 10 or 11 digit code with a wrong check digit is a
 * code that lost its check digit (a UPC-A without it is 11 digits), so it is completed. Other bad check digits are kept as is.
 * Returns { key, completed } or undefined for an unusable code.
 */
export const gtinKey = (raw) => {
  const digits = barcodeDigits(raw)
  if (!digits) return undefined
  const padded = digits.padStart(14, '0')
  if (hasValidCheckDigit(padded) || digits.length < 10 || digits.length > 11) return { key: padded, completed: false }
  return { key: `${digits}${checkDigitFor(digits)}`.padStart(14, '0'), completed: true }
}

/** Store-local codes (UPC-A number systems 2 and 4; EAN-13 20-29) are reused by every store and say nothing about the product. */
export const isLocalKey = (key) => {
  if (key.startsWith('00')) {
    const upc = key.slice(2)
    return upc[0] === '2' || upc[0] === '4'
  }
  return key[0] === '0' && key[1] === '2'
}

/** For a valid case-level GTIN-14 (indicator 1-8), the 14-digit key of the consumer unit it was derived from, else undefined. */
export const consumerKeyOfCase = (key) => {
  if (!(key[0] >= '1' && key[0] <= '8') || !hasValidCheckDigit(key)) return undefined
  const body = key.slice(1, 13)
  return `0${body}${checkDigitFor(body)}`
}

// ---------------------------------------------------------------------------------------------------------------------
// Text cleaning
// ---------------------------------------------------------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', deg: '°', eacute: 'é', egrave: 'è', ntilde: 'ñ', iacute: 'í', oacute: 'ó', aacute: 'á', uuml: 'ü', ouml: 'ö', auml: 'ä', ccedil: 'ç' }

/** Decode HTML entities (&amp; &#38; &#x26; ...), twice so a doubled &amp;amp; settles. */
export const decodeEntities = (text) => {
  let out = text
  for (let pass = 0; pass < 2 && out.includes('&'); pass += 1) {
    out = out.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
      if (body[0] === '#') {
        const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
        return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match
      }
      return ENTITIES[body.toLowerCase()] ?? match
    })
  }
  return out
}

const CP1252 = { 0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ' }
const CP1252_REVERSE = new Map(Object.entries(CP1252).map(([byte, char]) => [char, Number(byte)]))
const CONT = '[\\u0080-\\u00bf\\u2018-\\u201e\\u2020-\\u2022\\u2026\\u2030\\u2039\\u203a\\u20ac\\u2122\\u0152\\u0153\\u0160\\u0161\\u0178\\u017d\\u017e\\u02c6\\u02dc\\u0192]'
const MOJIBAKE = new RegExp(`[\\u00c2-\\u00df]${CONT}|[\\u00e0-\\u00ef]${CONT}{2}|[\\u00f0-\\u00f4]${CONT}{3}`, 'g')

/** Repair UTF-8 that was read as Windows-1252 / Latin-1 (Ã©, â€™, TÃ‰), sequence by sequence. A sequence that is not valid UTF-8 is left alone. */
export const fixMojibake = (text) =>
  text.replace(MOJIBAKE, (sequence) => {
    const bytes = []
    for (const char of sequence) {
      const code = char.codePointAt(0)
      if (code < 256) bytes.push(code)
      else if (CP1252_REVERSE.has(char)) bytes.push(CP1252_REVERSE.get(char))
      else return sequence
    }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes)) } catch { return sequence }
  })

/** Control characters out, entities decoded, mojibake repaired, whitespace collapsed. */
export const tidySpaces = (text) => fixMojibake(decodeEntities(String(text ?? ''))).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with', 'w', 'n'])
const KEEP_UPPER = new Set(['bbq', 'usa', 'us', 'usda', 'dha', 'epa', 'oj', 'pb', 'pbj', 'ny', 'ipa', 'xl', 'tv', 'blt', 'gf', 'bpa', 'gmo', 'bcaa', 'mct', 'hfcs', 'rtd', 'rtu', 'rtb', 'ii', 'iii', 'iv', 'vi', 'xo', 'ok', 'bj', 'dv', 'uht', 'mm', 'tj', 'cbd', 'thc', 'nfc', 'ggs'])

const titleWord = (word, first) => {
  const lower = word.toLowerCase()
  if (KEEP_UPPER.has(lower)) return word.toUpperCase()
  if (!first && SMALL_WORDS.has(lower)) return lower
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/** Sentence-style title case for an all-caps string; a string that already has lower-case letters is left alone. */
export const titleCaseIfShouting = (text) => {
  if (/\p{Ll}/u.test(text) || !/\p{Lu}/u.test(text)) return text
  let first = true
  return text.replace(/\p{L}[\p{L}']*/gu, (word, offset, whole) => {
    // A letter run glued to digits (12OZ, 2PK) is a unit: lower-case it.
    const before = offset > 0 ? whole[offset - 1] : ''
    const after = whole[offset + word.length] ?? ''
    if (/\d/.test(before) || (/\d/.test(after) && word.length <= 2)) { first = false; return word.toLowerCase() }
    const out = titleWord(word, first)
    first = false
    return out
  })
}

const SIZE_TAIL = /[\s,;-]+\(?(\d+(?:\.\d+)?)\s*(g|gr|gm|gms|grams?|oz|ounces?|ml|fl\.?\s?oz|floz)\.?\)?$/i
const unitFactor = (unit) => {
  const u = unit.toLowerCase().replace(/[.\s]/g, '')
  if (u === 'oz' || u.startsWith('ounce')) return { factor: 28.3495, kind: 'g' }
  if (u === 'floz') return { factor: 29.5735, kind: 'ml' }
  if (u === 'ml') return { factor: 1, kind: 'ml' }
  return { factor: 1, kind: 'g' }
}

/** Product name: whitespace collapsed, shouting converted to title case, a trailing "12 OZ" removed only when it is the serving size. */
export const cleanName = (raw, serving) => {
  let name = tidySpaces(raw)
  const tail = SIZE_TAIL.exec(name)
  if (tail && serving && serving.size > 0) {
    const { factor, kind } = unitFactor(tail[2])
    const grams = Number(tail[1]) * factor
    if (kind === serving.unit && Math.abs(grams - serving.size) <= Math.max(0.6, serving.size * 0.02) && name.length - tail[0].length >= 3) name = name.slice(0, name.length - tail[0].length)
  }
  name = titleCaseIfShouting(name)
  // Many descriptions end with the variety twice: "Kind, Bars, Almond, Almond".
  const parts = name.split(', ')
  if (parts.length >= 3 && parts[parts.length - 1].toLowerCase() === parts[parts.length - 2].toLowerCase()) parts.pop()
  return parts.join(', ')
}

const COMPANY_TAIL = /[\s,]+(inc|llc|ltd|l\.?l\.?c|l\.?p|corp|corporation|co|company)\.?$/i
/** Brand: brand_name, else brand_owner without its corporate suffix; title-cased when shouting. */
export const cleanBrand = (brandName, brandOwner) => {
  let brand = tidySpaces(brandName)
  if (!brand) {
    brand = tidySpaces(brandOwner)
    for (let pass = 0; pass < 2; pass += 1) {
      const stripped = brand.replace(COMPANY_TAIL, '')
      if (stripped.length >= 2) brand = stripped
    }
  }
  return titleCaseIfShouting(brand)
}

/** Household serving text: undefined when it is label noise ("Amount per serving"), codes spelled out (ONZ, OZA, GRM), shouting lowered. */
export const cleanHousehold = (raw) => {
  let text = tidySpaces(raw)
  if (!text || !/^(\d|\.\d|[¼½¾⅓⅔])/.test(text)) return undefined
  text = text.replace(/\s*\|.*$/, '').replace(/\bONZ\b/gi, 'oz').replace(/\bOZA\b/gi, 'fl oz').replace(/\bGRM\b/gi, 'g').replace(/\bMLT\b/gi, 'ml').replace(/\bGRAM\b/gi, 'g')
  if (!/[a-z]/.test(text)) text = text.toLowerCase()
  return text.length > 60 ? undefined : text
}

const WEIGHT_IN_TEXT = /\d\s?(g|gr|gm|grams?|ml|mls|l|liters?|litres?|kg|mg)\b/i

/**
 * "1 bar (40 g)": the household measure and its weight; the weight alone when there is no household text. The weight is not
 * repeated when the household text already states one in metric ("12 fl oz (355 mL)", "3/4 cup (20g)").
 */
export const servingLabel = (household, size, unit) => {
  const weight = size > 0 ? `${Number(size.toFixed(2))} ${unit}` : ''
  if (!household) return weight || undefined
  if (!weight) return household
  const compact = (text) => text.toLowerCase().replace(/\s+/g, '')
  // The weight the row shows is the serving size (what the form logs): a household text that states another metric weight
  // ("12 fl oz (355 mL)" with a size of 360) has that weight replaced by the size.
  const metric = /(\d+(?:\.\d+)?)\s?(g|gr|gm|grams?|ml|mls)\b/i.exec(household)
  if (metric) return Math.abs(Number(metric[1]) - size) <= 0.005 * size ? household : household.replace(metric[0], weight)
  return WEIGHT_IN_TEXT.test(household) || compact(household).includes(compact(weight)) ? household : `${household} (${weight})`
}

const OZ_G = 28.3495
const FL_OZ_ML = 29.5735

/**
 * The amount a household text states explicitly, as a number of grams or millilitres, or NaN when it states none ("1 bar").
 * `unit` is the unit of the serving it is compared with: a bare "oz" means ounces of weight for grams and fluid ounces for millilitres.
 */
export const householdAmount = (household, unit) => {
  if (!household) return Number.NaN
  const pick = (text) => {
    const match = /^\s*(\d+(?:\.\d+)?)\s*(g|gr|gm|grams?|ml|mls|l|liters?|litres?|kg|mg|oz|ounces?|fl\.?\s?oz|floz)\.?\s*$/i.exec(text)
    if (!match) return Number.NaN
    const value = Number(match[1])
    const u = match[2].toLowerCase().replace(/[.\s]/g, '')
    const weight = u === 'g' || u === 'gr' || u === 'gm' || u.startsWith('gram') || u === 'mg' || u === 'kg'
    const volume = u === 'ml' || u === 'mls' || u === 'l' || u.startsWith('lit') || u === 'floz'
    if ((weight && unit !== 'g') || (volume && unit !== 'ml')) return Number.NaN
    if (u === 'g' || u === 'gr' || u === 'gm' || u.startsWith('gram')) return value
    if (u === 'mg') return value / 1000
    if (u === 'kg') return value * 1000
    if (u === 'ml' || u === 'mls') return value
    if (u === 'l' || u.startsWith('lit')) return value * 1000
    if (u === 'floz') return value * FL_OZ_ML
    return value * (unit === 'ml' ? FL_OZ_ML : OZ_G)
  }
  const inParens = /\(([^()]*)\)/.exec(household)
  const fromParens = inParens ? pick(inParens[1]) : Number.NaN
  if (!Number.isNaN(fromParens)) return fromParens
  const lead = /^\s*(\d+(?:\.\d+)?\s*[a-z.\s]+?)(?:\s*\(|\s*$)/i.exec(household)
  return lead ? pick(lead[1]) : Number.NaN
}

// ---------------------------------------------------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------------------------------------------------

const STOPWORDS = new Set(['a', 'an', 'and', 'or', 'the', 'of', 'with', 'in', 'for', 'to', 'from', 'by', 'on', 'at', 'as', 'no', 'all', 'is', 'it', 'its', 'our', 'your', 'new', 'w', 'n'])
const UNIT_TOKEN = /^\d+(oz|g|gr|ml|ct|lb|lbs|fl|pk|l|kg|mg|pc|pcs|z|ea|in|inch|cal|kcal|pack)$/
const UNIT_WORDS = new Set(['oz', 'ml', 'fl', 'ct', 'lb', 'lbs', 'pk', 'pc', 'pcs', 'kg', 'mg', 'gr', 'g', 'l', 'ea', 'net', 'wt', 'pkg', 'pack', 'packs', 'count', 'ounce', 'ounces', 'pound', 'pounds', 'gal', 'gallon', 'quart', 'pint', 'liter', 'liters', 'litre', 'each', 'inch', 'cm', 'mm', 'cal', 'kcal', 'serving', 'servings'])
const MAX_TOKEN = 24

/** Plural-insensitive stem, identical to the one in src/catalog/index.ts. */
export const stem = (token) => {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`
  if (token.length > 4 && token.endsWith('oes')) return token.slice(0, -2)
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1)
  return token
}

const fold = (text) => String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’`]/g, '')

/** Word pieces of a text with the separator that precedes each: "2%", "0.5%", "7up", "m", "ms". */
const pieces = (text) => {
  const folded = fold(text)
  const out = []
  const re = /[a-z0-9]+(?:\.\d+)?%?/g
  let previousEnd = 0
  let match
  while ((match = re.exec(folded)) !== null) {
    out.push({ word: match[0], separator: folded.slice(previousEnd, match.index) })
    previousEnd = match.index + match[0].length
  }
  return out
}

const RUN_SEPARATOR = /^[\s&+\-]*(?:and)?[\s&+\-]*$/

/**
 * Search tokens of a text, in order of appearance (duplicates kept): ASCII-folded, lower-case, apostrophes dropped (dave's -> dave),
 * no stopwords or units, numbers and percentages kept ("2%", "365", "5") except sizes ("12 oz", "3.5"), single letters joined across
 * & and - ("m&m" -> "mm", "h-e-b" -> "heb", "a&w" -> "aw", "m&m's" -> "mm" and "mms"), stemmed like src/catalog/index.ts.
 */
export const searchTokens = (text) => {
  const list = pieces(text)
  const out = []
  for (let index = 0; index < list.length; index += 1) {
    const word = list[index].word
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
        if (next.word === 'and' && after && /^[a-z]$/.test(after.word) && /^[\s]+$/.test(next.separator) && /^[\s]+$/.test(after.separator)) { joined += after.word; end += 2; continue }
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

/** The unstemmed alphabetic words of a text (for compound forms: "la croix" -> lacroix). */
export const plainWords = (text) => pieces(text).map((piece) => piece.word).filter((word) => /^[a-z]{2,}$/.test(word) && !STOPWORDS.has(word))

/** Joined adjacent-word forms of a brand ("la croix" -> lacroix, "trader joe's" -> traderjoe), at most three. */
export const compoundTokens = (brand) => {
  const words = plainWords(brand)
  const out = []
  for (let index = 0; index + 1 < words.length && out.length < 3; index += 1) out.push(stem(words[index] + words[index + 1]).slice(0, MAX_TOKEN))
  return out
}

/** Distinct tokens a product is indexed under: name and brand words plus the brand's joined forms. */
export const indexTokensOf = (name, brand) => [...new Set([...searchTokens(name), ...searchTokens(brand), ...compoundTokens(brand)])]

// ---------------------------------------------------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------------------------------------------------

/** Popularity prior from the number of historical records of a GTIN and the number of products of its brand. */
export const popularityOf = (records, brandProducts) => Math.log(1 + records) + Math.log(1 + brandProducts) / 2

/**
 * Score of one product for a query. `row` = { nameTokens, brandTokens, pop, category (lower-case text) }; `terms` = one entry per
 * query token { variants: string[], prefix: boolean, generic: boolean, qualifier: boolean }. `row.brandCore` = searchTokens(brand) without the compound forms.
 * Name words outrank brand words for generic words; brand words outrank for brand-like words; a generic word that is only part of
 * a multi-word brand is penalised; whole words beat prefixes; a contiguous phrase in the name, a shorter name and popularity help.
 */
export const rowScore = (row, terms) => {
  let score = 0
  const positions = []
  terms.forEach((term) => {
    const matches = (token) => term.variants.some((variant) => (term.prefix && !term.qualifier ? token.startsWith(variant) : token === variant))
    const exactly = (token) => term.variants.includes(token)
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
    for (let index = 1; index < positions.length; index += 1) if (positions[index] !== positions[index - 1] + 1) inOrder = false
    if (inOrder) score += 2.5
  }
  if (positions[0] === 0) score += 0.5
  // The whole brand is in the query ("splenda", "kind bar", "great value peanut butter"): the brand is what was asked for.
  if (row.brandCore.length > 0 && new Set(row.brandCore).size === row.brandCore.length && row.brandCore.every((token) => terms.some((term) => term.variants.includes(token)))) score += 2.2
  score -= 0.06 * Math.max(0, row.nameTokens.length - terms.length)
  return score + 0.35 * row.pop
}
