/**
 * Turns the text an OCR engine read from a nutrition label into numbers. Pure and self-contained: no imports, so a
 * Node script can run it on real OCR output as well as the app and its tests.
 *
 * The rule it works to: a value it is not sure of is BLANK or FLAGGED ("check"), never silently filled.
 * OCR is noisy on these labels in predictable ways ("0g" read "Og", "g" read "9", "<1g" read "<1lg", a dropped decimal
 * point, a number glued to its %DV, labels and numbers split over two lines), so every number is read as a short list
 * of candidates and the one that agrees with the other printed evidence wins: the % Daily Value in the same cell, the
 * per container column, the parent nutrient (sugars cannot exceed carbs) and the energy balance (4 P + 4 C + 9 F
 * against the calories). A value that only won on priors, that disagrees with the evidence, that sits in a column we
 * cannot identify, or whose text had digits we could not account for, is flagged. A value whose cell was unreadable is
 * left blank and listed in `unread`.
 */

export type LabelKey =
  | 'calories' | 'fat' | 'satFat' | 'transFat' | 'cholesterol' | 'sodium' | 'carbs' | 'fiber' | 'sugars' | 'addedSugars'
  | 'protein' | 'vitaminD' | 'calcium' | 'iron' | 'potassium'

export const LABEL_KEYS: LabelKey[] = ['calories', 'fat', 'satFat', 'transFat', 'cholesterol', 'sodium', 'carbs', 'fiber', 'sugars', 'addedSugars', 'protein', 'vitaminD', 'calcium', 'iron', 'potassium']

export type LabelConfidence = 'ok' | 'check'

export interface LabelValue {
  value: number
  confidence: LabelConfidence
  /** Why it is flagged, or how it was derived. */
  note?: string
  /** Other readings of the same text, tried when the energy balance or a parent nutrient disagrees. */
  alternatives?: number[]
}

/** One line of OCR text with how sure the engine was of it (0 to 100). */
export interface LabelLineInput { text: string; confidence?: number; digitConfidence?: number }

export interface ParsedLabel {
  /** What the numbers are for: one serving, or 100 g / 100 ml (EU style tables). */
  basis: 'per serving' | 'per 100 g' | 'per 100 ml'
  /** Set when the basis was not clearly printed, or two bases were offered. */
  basisCheck?: string
  servingText?: string
  servingAmount?: { value: number; unit: 'g' | 'ml' }
  /** Set when the serving text or its weight is uncertain. The weight is left out when it cannot be right. */
  servingCheck?: string
  servingsPerContainer?: number
  servingsCheck?: string
  values: Partial<Record<LabelKey, LabelValue>>
  /** Nutrients whose row was on the label but whose number could not be read: blank, to be typed in. */
  unread: Partial<Record<LabelKey, string>>
  /** 4 P + 4 C + 9 F is not within ~25% of the calories: the numbers as a set look wrong. */
  checkNumbers: boolean
  notes: string[]
  hasCalories: boolean
  /** Worth opening the review form for: calories were read, or at least three nutrients were. */
  usable: boolean
}

type Unit = 'g' | 'mg' | 'mcg'
interface Meta { unit: Unit; max: number }
type DvTable = Partial<Record<Exclude<LabelKey, 'calories'>, number>>

const META: Record<Exclude<LabelKey, 'calories'>, Meta> = {
  fat: { unit: 'g', max: 120 }, satFat: { unit: 'g', max: 60 }, transFat: { unit: 'g', max: 30 }, cholesterol: { unit: 'mg', max: 1500 },
  sodium: { unit: 'mg', max: 8000 }, carbs: { unit: 'g', max: 300 }, fiber: { unit: 'g', max: 80 }, sugars: { unit: 'g', max: 250 },
  addedSugars: { unit: 'g', max: 200 }, protein: { unit: 'g', max: 150 }, vitaminD: { unit: 'mcg', max: 200 }, calcium: { unit: 'mg', max: 3000 },
  iron: { unit: 'mg', max: 100 }, potassium: { unit: 'mg', max: 8000 },
}

/** FDA Daily Values on 2016+ labels, the pre-2016 values (labels that still print "Calories from Fat"), and the Canadian values. */
const DV_2020: DvTable = { fat: 78, satFat: 20, cholesterol: 300, sodium: 2300, carbs: 275, fiber: 28, addedSugars: 50, protein: 50, vitaminD: 20, calcium: 1300, iron: 18, potassium: 4700 }
const DV_OLD: DvTable = { fat: 65, satFat: 20, cholesterol: 300, sodium: 2400, carbs: 300, fiber: 25, protein: 50, calcium: 1000, iron: 18 }
const DV_CANADA: DvTable = { fat: 75, satFat: 20, sodium: 2300, carbs: 275, fiber: 28, sugars: 100, calcium: 1100, iron: 14, potassium: 3400, cholesterol: 300 }

// --- label wording -----------------------------------------------------------------------------------------------

const LOOKALIKE: Record<string, string> = { o: '[o0]', i: '[i1l]', l: '[l1i]', s: '[s5]' }
/** A regex source for a phrase that also accepts the usual OCR look-alikes (o/0, i/l/1, s/5) and optional spaces. */
const fz = (phrase: string): string => phrase.split('').map((ch) => (ch === ' ' ? '\\s*' : LOOKALIKE[ch] ?? ch)).join('')
const alt = (...phrases: string[]): string => phrases.map(fz).join('|')

type FieldId = LabelKey | 'energy' | 'salt'

/** Text is accent-folded and lower-cased before matching, so "Protéines" and "azúcares" need no accents here. */
const PATTERNS: Array<[FieldId, string]> = [
  ['transFat', alt('trans fats', 'trans fat', 'gras trans', 'grasas trans', 'grasa trans', 'trans')],
  ['satFat', alt('saturated fats', 'saturated fat', 'sat fat', 'sat. fat', 'saturates', 'saturated', 'gras satures', 'grasas saturadas', 'grasa saturada', 'saturadas', 'satures')],
  ['addedSugars', `(?:incl(?:udes?|\\.)?|incluye|dont)?\\s*(?:[<]?[0-9oli.,]+\\s*(?:mg|g|9)?\\s*)?(?:de\\s*)?(?:${alt('added sugars', 'added sugar', 'sucres ajoutes', 'sucre ajoute', 'azucares anadidos', 'azucares agregados', 'azucar anadido')})`],
  ['sugars', alt('total sugars', 'sugars', 'sugar', 'sucres totaux', 'sucres', 'azucares totales', 'azucares')],
  ['fiber', alt('dietary fiber', 'dietary fibre', 'fibres alimentaires', 'fibre', 'fiber', 'fibra dietetica', 'fibras', 'fibra')],
  ['carbs', alt('total carbohydrates', 'total carbohydrate', 'total carb', 'carbohydrates', 'carbohydrate', 'glucides', 'carbohidratos totales', 'carbohidratos', 'hidratos de carbono', 'carbs')],
  ['fat', alt('total fat', 'total fats', 'fat', 'lipides', 'lipidos', 'grasas totales', 'grasa total', 'matieres grasses', 'grasas', 'grasa')],
  ['cholesterol', alt('cholesterol', 'colesterol', 'cholest.', 'cholest', 'choles')],
  ['sodium', alt('sodium', 'sodio', 'natrium')],
  ['salt', `\\b(?:${alt('salt', 'sel', 'sal')})\\b`],
  ['protein', alt('proteins', 'protein', 'proteines', 'proteinas', 'proteina', 'eiweiss')],
  ['vitaminD', `vit(?:amin[ea]?|amina)?\\.?\\s*d\\b`],
  ['calcium', alt('calcium', 'calcio')],
  ['iron', `\\b(?:${alt('iron', 'hierro', 'fer')})\\b`],
  ['potassium', alt('potassium', 'potasio', 'potas.', 'potas')],
  ['calories', `(?:${alt('calories', 'calorie', 'calorias')})(?![a-z])(?!\\s*(?:from|de\\b|des\\b|provenant|derivees))`],
  ['energy', alt('energy', 'energie', 'energia', 'valeur energetique')],
]
const COMPILED = PATTERNS.map(([id, source]) => [id, new RegExp(`(?<![a-z])(?:${source})`, 'g')] as const)

const fold = (line: string): string =>
  line.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[|¦]/g, ' ').replace(/[‐‑–—−]/g, '-').replace(/[   ]/g, ' ')

// --- cells -----------------------------------------------------------------------------------------------------------

/** What the text after a label turned into. A cell is one column's amount, with its %DV when it had one. */
interface Option { value: number; dv?: number; note?: string; weak?: boolean }
interface Cell {
  /** Readings of the amount (several when the text was ambiguous). Empty when the cell held no usable amount. */
  options: Option[]
  unit?: string
  lessThan: boolean
  guessedOne: boolean
  /** %DV printed in the cell, when separate from the amount. */
  dv?: number
  /** The cell had digits we could not account for. */
  garbled: boolean
  /** Only a %DV was readable. */
  pctOnly: boolean
}

const UNIT = '(?:mcg|ug|µg|μg|mg|m9|rng|rn9|kcal|kj|ml|g|9|q)'
const AMT = new RegExp(`^(<|≤)?([0-9oli]+(?:[.,][0-9oli]+)?|[.,][0-9]+)(${UNIT})?$`)
const PCT = /^([0-9oli]{1,3})%$/
const GLUE_UNIT = /^(<)?([0-9oli.,]+)(mcg|ug|mg|m9|g|q)([0-9oli]{1,3})%$/
const GLUE_BARE = /^(<)?([0-9oli.,]{3,})%$/
const UNIT_ONLY = /^(?:mcg|ug|µg|μg|mg|m9|g|9|q|kj|kcal)$/

const normalizeUnit = (unit: string | undefined): string | undefined => {
  if (!unit) return undefined
  if (unit === 'm9' || unit === 'rng' || unit === 'rn9') return 'mg'
  if (unit === '9' || unit === 'q') return 'g'
  if (unit === 'µg' || unit === 'μg' || unit === 'ug') return 'mcg'
  return unit
}

const digitsOf = (token: string): { text: string; guessedOne: boolean } | undefined => {
  // A look-alike letter only counts next to a real digit, or as a lone zero ("Og", "omg").
  const real = /\d/.test(token)
  if (!real && !/^o+$/.test(token)) return undefined
  return { text: token.replace(/o/g, '0').replace(/[li]/g, '1'), guessedOne: real && /[li]/.test(token) }
}

const numberOf = (text: string, thousands: boolean): number => {
  let t = text
  if (t.includes(',') && t.includes('.')) t = t.replace(/,/g, '')
  else if (t.includes(',')) t = thousands && /^\d{1,3},\d{3}$/.test(t) ? t.replace(',', '') : t.replace(',', '.')
  if (t.startsWith('.')) t = `0${t}`
  return Number(t)
}

const tidy = (value: number): number => Math.round(value * 100) / 100

const chunkText = (rest: string): string[] => {
  let s = rest.replace(/[~"“”‘’'`_=*•·«»¦()[\]{};:]/g, ' ').replace(/\bdv\b/g, ' ').replace(/\//g, ' ')
  s = s.replace(/\bless\s*than\b/g, ' < ').replace(/(\d)\s+%/g, '$1%')
  const raw = s.split(/\s+/).filter(Boolean)
  const out: string[] = []
  for (let i = 0; i < raw.length; i += 1) {
    let chunk = raw[i]
    if (chunk === '<' || chunk === '≤') { if (raw[i + 1]) { chunk = `<${raw[i + 1]}`; i += 1 } else continue }
    // "12 g" and "2 9": a unit that came apart from its number.
    if (/^[<≤]?[0-9oli]+(?:[.,][0-9oli]+)?$/.test(chunk) && raw[i + 1] && UNIT_ONLY.test(raw[i + 1])) { chunk += raw[i + 1]; i += 1 }
    out.push(chunk)
  }
  return out
}

const splitGlued = (digits: string, less: boolean, thousands: boolean): Cell => {
  // "29911%" is "29 g 11%" with the g read as 9: try every place the %DV can start and let the DV pick.
  const options: Option[] = []
  const compact = digits
  for (let p = 1; p <= 3 && p < compact.length; p += 1) {
    const dvText = compact.slice(compact.length - p)
    const amountText = compact.slice(0, compact.length - p)
    const dvDigits = digitsOf(dvText)
    const amountDigits = digitsOf(amountText)
    if (!dvDigits || !amountDigits || (dvDigits.text.length > 1 && dvDigits.text.startsWith('0'))) continue
    const dv = Number(dvDigits.text)
    if (dv > 300) continue
    const base = numberOf(amountDigits.text, thousands)
    if (Number.isFinite(base)) options.push({ value: base, dv })
    if (amountDigits.text.length >= 2 && amountDigits.text.endsWith('9') && !amountDigits.text.includes('.')) {
      const stripped = numberOf(amountDigits.text.slice(0, -1), thousands)
      if (Number.isFinite(stripped)) options.push({ value: stripped, dv, note: 'a trailing 9 was read as "g"' })
    }
  }
  return { options, lessThan: less, guessedOne: false, garbled: options.length === 0, pctOnly: false }
}

const makeCells = (chunks: string[], thousands: boolean): { cells: Cell[]; unparsedDigits: boolean } => {
  const cells: Cell[] = []
  let unparsed = false
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i]
    const pct = PCT.exec(chunk)
    const glueUnit = GLUE_UNIT.exec(chunk)
    const glueBare = !pct && GLUE_BARE.exec(chunk)
    const amt = AMT.exec(chunk)
    if (pct) {
      const digits = digitsOf(pct[1])
      const last = cells[cells.length - 1]
      // A %DV that follows an amount belongs to it; handled when the amount is made. A stray one is its own cell.
      if (digits && last && last.dv === undefined && last.options.length > 0 && !last.pctOnly && chunks[i - 1] !== undefined && !PCT.test(chunks[i - 1])) last.dv = Number(digits.text)
      else if (digits) cells.push({ options: [], lessThan: false, guessedOne: false, dv: Number(digits.text), garbled: false, pctOnly: true })
      else { unparsed = true; cells.push({ options: [], lessThan: false, guessedOne: false, garbled: true, pctOnly: false }) }
    } else if (glueUnit) {
      const amount = digitsOf(glueUnit[2])
      const dv = digitsOf(glueUnit[4])
      if (amount && dv) {
        const value = numberOf(amount.text, thousands)
        cells.push({ options: Number.isFinite(value) ? [{ value }] : [], unit: normalizeUnit(glueUnit[3]), lessThan: Boolean(glueUnit[1]), guessedOne: amount.guessedOne, dv: Number(dv.text), garbled: !Number.isFinite(value), pctOnly: false })
      } else { unparsed = true; cells.push({ options: [], lessThan: false, guessedOne: false, garbled: true, pctOnly: false }) }
    } else if (glueBare) {
      cells.push(splitGlued(glueBare[2], Boolean(glueBare[1]), thousands))
    } else if (amt) {
      // "<1g" read "<lg": after a less-than sign a lone look-alike letter is the digit 1.
      const digits = digitsOf(amt[2]) ?? (amt[1] && /^[li]$/.test(amt[2]) ? { text: '1', guessedOne: true } : undefined)
      if (!digits) {
        // A look-alike letter with a unit ("lg") is a number we cannot read: keep its place so the columns do not shift.
        if (amt[3] && /^[li]+$/.test(amt[2])) { unparsed = true; cells.push({ options: [], lessThan: false, guessedOne: false, garbled: true, pctOnly: false }) }
        continue
      }
      const unit = normalizeUnit(amt[3])
      const value = numberOf(digits.text, thousands)
      const options: Option[] = []
      if (Number.isFinite(value)) options.push({ value })
      cells.push({ options, unit, lessThan: Boolean(amt[1]), guessedOne: digits.guessedOne, garbled: options.length === 0, pctOnly: false })
    } else if (/\d/.test(chunk)) {
      // Digits we cannot account for ("29x3", "1b0").
      unparsed = true
      cells.push({ options: [], lessThan: false, guessedOne: false, garbled: true, pctOnly: false })
    }
    // Letters only: the label's own words before the number ("of which", a second language) are ignored, but a word after
    // the number is the next row's label that we do not know, so the cells end there.
    else if (cells.length > 0 && /^[a-z.]{3,}$/.test(chunk) && !/^(?:less|than|daily|value|values|each|per|dv)$/.test(chunk)) break
  }
  return { cells, unparsedDigits: unparsed }
}

// --- resolving one value ---------------------------------------------------------------------------------------------

/** Does a printed %DV agree with this amount, allowing for how labels round the amount and the percentage? */
const dvAgrees = (meta: Meta, dvAmount: number, value: number, dv: number): boolean => {
  const half = (meta.unit === 'g' ? (value < 5 ? 0.25 : 0.5) : meta.unit === 'mg' ? (value < 5 ? 0.5 : value < 140 ? 2.5 : 5) : 0.25) + 0.03 * value
  const low = ((value - half) / dvAmount) * 100
  const high = ((value + half) / dvAmount) * 100
  return dv >= low - 0.5 && dv <= high + 0.5
}

interface Resolution { value?: number; confidence: LabelConfidence; note?: string; alternatives?: number[]; unread?: string; /** The chosen amount agrees with the printed %DV or the per container column. */ corroborated?: boolean }

const optionsFor = (meta: Meta, cell: Cell): Option[] => {
  if (cell.options.length === 0) return []
  const list: Option[] = []
  const add = (option: Option) => { if (!list.some((existing) => existing.value === option.value && existing.dv === option.dv)) list.push(option) }
  for (const option of cell.options) {
    const original = option.note === undefined
    const numeric = String(option.value)
    const decimals = numeric.includes('.') ? numeric.split('.')[1].length : 0
    const hadTrailingNine = cell.options.length === 1 && cell.unit === undefined && meta.unit === 'g' && !cell.lessThan && /\d9$/.test(numeric) && decimals === 0
    const decimalNine = cell.unit === undefined && meta.unit === 'g' && /^\d+\.\d*9$/.test(numeric)
    if (original && cell.dv !== undefined || original) {
      if (hadTrailingNine || decimalNine) {
        // "12g" read "129" and "1.5g" read "1.59": a trailing 9 with no unit is usually the g.
        const stripped = numeric.slice(0, -1).replace(/\.$/, '')
        add({ value: Number(stripped), dv: option.dv, note: 'a trailing 9 was read as "g"' })
        // Labels round below 5 g to halves, so a second decimal place cannot be real.
        if (!decimalNine || decimals < 2) add({ ...option })
        continue
      }
      if (meta.unit === 'mg' && cell.unit === 'g') {
        if (option.value < 20) { add({ value: tidy(option.value * 1000), dv: option.dv, note: 'read grams as milligrams' }); add({ ...option }) }
        else add({ ...option, note: 'the "m" of mg was missing' })
        continue
      }
      if (meta.unit === 'g' && cell.unit === 'mg') {
        if (option.value >= 1000) { add({ value: tidy(option.value / 1000), dv: option.dv, note: 'read milligrams as grams' }); add({ ...option }) }
        else add({ ...option, note: 'the unit looked like mg' })
        continue
      }
    }
    add(option)
  }
  // A dropped decimal point ("3.2 g" read "32"): weak, only used when other evidence picks it.
  for (const option of [...list]) {
    if (!option.weak && Number.isInteger(option.value) && option.value >= 10 && meta.unit !== 'mg' && option.note === undefined) add({ value: option.value / 10, dv: option.dv, note: 'a decimal point looked lost', weak: true })
  }
  return list
}

interface Evidence { dvAmount?: number; sharedDv?: number; perContainer?: { amount: number; servings: number } }

const resolveCell = (meta: Meta, cell: Cell, secondAmount: number | undefined, servings: number | undefined, evidence: Evidence): Resolution => {
  if (cell.garbled || cell.pctOnly) return { confidence: 'check', unread: cell.pctOnly ? 'only the % Daily Value could be read' : 'the number could not be read' }
  if (cell.lessThan) {
    const bound = cell.options[0]?.value ?? 1
    return { value: tidy(bound / 2), confidence: 'check', note: `printed as "<${bound}"; used half of that` }
  }
  const options = optionsFor(meta, cell)
  if (options.length === 0) return { confidence: 'check', unread: 'the number could not be read' }
  const perContainer = servings && secondAmount !== undefined ? { amount: secondAmount, servings } : undefined
  const scored = options.map((option, index) => {
    const dv = option.dv ?? evidence.sharedDv
    const dvMatch = dv !== undefined && evidence.dvAmount !== undefined ? dvAgrees(meta, evidence.dvAmount, option.value, dv) : undefined
    const pcMatch = perContainer ? Math.abs(option.value * perContainer.servings - perContainer.amount) <= Math.max(0.15 * perContainer.amount, 1) : undefined
    return { option, index, dvMatch, pcMatch, score: (dvMatch ? 2 : 0) + (pcMatch ? 2 : 0) - (dvMatch === false ? 1 : 0) - (pcMatch === false ? 1 : 0) }
  })
  const hasEvidence = scored.some((entry) => entry.dvMatch !== undefined || entry.pcMatch !== undefined)
  const eligible = scored.filter((entry) => !entry.option.weak || entry.score > 0).sort((a, b) => b.score - a.score || a.index - b.index)
  const best = eligible[0]
  const strong = scored.filter((entry) => !entry.option.weak)
  const supported = best.score > 0
  const rivals = eligible.filter((entry) => entry !== best && entry.score === best.score)

  let confidence: LabelConfidence = 'ok'
  let note = best.option.note
  if (hasEvidence && !supported) {
    confidence = 'check'
    note = scored.some((entry) => entry.dvMatch !== undefined) ? 'does not match its % Daily Value' : 'does not match the per container column'
  } else if (rivals.length > 0 || (!hasEvidence && strong.length > 1)) {
    confidence = 'check'
    note = 'could be read two ways'
  }
  if (cell.guessedOne && !supported) { confidence = 'check'; note = note ?? 'a letter was read as the digit 1' }
  if (best.option.value > meta.max) { confidence = 'check'; note = 'unusually large' }
  const alternatives = scored.filter((entry) => entry !== best).map((entry) => tidy(entry.option.value)).filter((value) => value !== tidy(best.option.value))
  return { value: tidy(best.option.value), confidence, note: confidence === 'check' ? note : undefined, alternatives: alternatives.length > 0 ? alternatives : undefined, corroborated: best.dvMatch === true || best.pcMatch === true }
}

// --- lines, columns, serving -----------------------------------------------------------------------------------------

interface Segment { id: FieldId; lineIndex: number; rest: string; lead: string }

const FOOTER = /percent\s*daily\s*values?\s*(?:are|is)\s*based|daily\s*values?\s*(?:are\s*)?based|\bdv\)?\s*tells\s*you|\b2[,.]?000\s*calor|valeurs?\s*quotidiennes\s*(?:sont|se)\s*basees|valores\s*diarios\s*(?:se\s*)?basan/
const INGREDIENTS = /^\W*(?:ingredients?|ingredientes|contains|contiene|contient|may\s*contain|allergens?|allergy)\b/
const SKIP_LINE = /(?:less\s*than|moins\s*de|menos\s*de)\s*[\d,.]+\s*(?:g|mg)?\s+[\d,.]+|(?:poly|mono|poli)\s*-?\s*(?:un)?\s*satur|unsaturated|sugar\s*alcohols?|polyols?|erythritol|sorbitol|xylitol|maltitol|alcohols?\b/
const PER_HUNDRED = /(?:per|pour|por|pro)\s*100\s*(g|ml)\b/

const findSegments = (line: string, lineIndex: number): Segment[] => {
  const hits: Array<{ id: FieldId; start: number; end: number }> = []
  for (const [id, regex] of COMPILED) {
    regex.lastIndex = 0
    for (const match of line.matchAll(regex)) {
      const start = match.index ?? 0
      let end = start + match[0].length
      if (id === 'satFat' && /(?:un|poly|mono)$/.test(line.slice(Math.max(0, start - 6), start).replace(/[^a-z]/g, ''))) continue
      // "Calories from Fat": the Fat is not the fat amount.
      if (id === 'fat' && /(?:from|de|des|provenant\s*des?)\s*$/.test(line.slice(0, start)) && /calor/.test(line)) continue
      // A bare "Fat" after the tail of a garbled "Saturated" is not total fat.
      if (id === 'fat' && !/total|lipid|grasa|gras/.test(match[0]) && /(?:rated|urated|turated|sat\.?)\s*$/.test(line.slice(0, start))) continue
      end += (/^[\s:.]*/.exec(line.slice(end)) ?? [''])[0].length
      hits.push({ id, start, end: Math.max(end, start + match[0].length) })
    }
  }
  hits.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start))
  const kept: typeof hits = []
  for (const hit of hits) {
    const last = kept[kept.length - 1]
    if (last && hit.start < last.end) continue
    kept.push(hit)
  }
  return kept.map((hit, i) => {
    const next = kept[i + 1]
    return { id: hit.id, lineIndex, rest: line.slice(hit.end, next ? next.start : undefined), lead: line.slice(hit.start, hit.end) }
  })
}

const amountsOnly = (line: string): boolean => {
  const chunks = chunkText(line)
  if (chunks.length === 0) return false
  return chunks.every((chunk) => PCT.test(chunk) || AMT.test(chunk) || GLUE_UNIT.test(chunk) || GLUE_BARE.test(chunk)) && /\d/.test(line)
}

type ColumnKind = 'S' | 'C' | 'H' | 'P'
interface Columns { order: ColumnKind[]; each: boolean }

/** Which column is which, read from the header text printed above the nutrients. */
const detectColumns = (lines: string[]): Columns => {
  let end = lines.findIndex((line) => findSegments(line, 0).some((segment) => segment.id !== 'calories' && segment.id !== 'energy'))
  if (end < 0) end = lines.length
  const header = lines.slice(0, Math.min(Math.max(end + 1, 6), 14)).join(' \n ')
  const marks: Array<{ kind: ColumnKind; pos: number }> = []
  const push = (kind: ColumnKind, regex: RegExp) => { for (const match of header.matchAll(regex)) marks.push({ kind, pos: match.index ?? 0 }) }
  push('C', /(?<!servings\s)(?<!servings)\bper\s*(?:container|pack(?:age)?)\b|(?<!portions\s)(?<!portions)par\s*contenant|(?<!porciones\s)(?<!porciones)por\s*envase/g)
  push('S', /\bper\s*(?:serving|portion)\b|par\s*portion\b|(?<!tamano\s)(?<!tamano)por\s*porcion\b|\bper\s*\d+\s*(?:g|ml)\s*(?:serving|portion)|\bper\s*(?:\d+\s*)?(?:g|ml)?\s*serving\b|\beach\s*\d*\s*(?:g|ml)?\s*serving\b/g)
  push('H', /(?:per|pour|por|pro)\s*100\s*(?:g|ml)\b/g)
  push('P', /as\s*prepared|with\s*(?:1\/2\s*cup\s*)?(?:skim\s*)?milk/g)
  // "Per Per / serving container" printed as a stacked header.
  const stacked = /\bper\s+per\b[\s\S]{0,12}?(serving|container)[\s\S]{0,6}?(serving|container)/.exec(header)
  let order: ColumnKind[] = marks.sort((a, b) => a.pos - b.pos).map((mark) => mark.kind)
  if (stacked && stacked[1] !== stacked[2]) order = [stacked[1] === 'serving' ? 'S' : 'C', stacked[1] === 'serving' ? 'C' : 'S']
  // Collapse repeats.
  order = order.filter((kind, i) => order.indexOf(kind) === i)
  const each = /\beach\b[\s\S]{0,24}\bserving\b[\s\S]{0,12}\bcontains?\b/.test(header)
  return { order, each }
}

const SERVING_SIZE = /(?<![a-z])(?:serv(?:ing|\.)?s?\.?\s*size|serving(?!s)|tamano\s*(?:de\s*la|por)\s*porcion|taille\s*(?:de\s*la|d'une)?\s*portion|portion\s*size)\s*:?\s*(.*)$/
const SERVINGS_PER = /(?:(\d+(?:[.,]\d+)?)\s*(?:servings?|serv[i1l]ngs?|porciones|portions)\s*(?:per|por|par)\s*(?:container|envase|contenant|package|pkg)|(?:servings?|porciones|portions)\s*(?:per|por|par)\s*(?:container|envase|contenant|package)\s*:?\s*(?:about|aprox\w*|environ|approx\w*)?\s*(\d+(?:[.,]\d+)?))/

interface Serving { text?: string; amount?: { value: number; unit: 'g' | 'ml' }; ambiguousGrams?: number }

const servingAmountFrom = (text: string): { amount?: { value: number; unit: 'g' | 'ml' }; ambiguousGrams?: number } => {
  const paren = /\(\s*(?:[a-z.]*\s*)?(\d+(?:[.,]\d+)?)\s*(g|ml|gr)\b/.exec(text)
  if (paren) {
    // "(59g)" read "(599g)": a g that doubled as a 9. The shorter weight is used and flagged, since both can be real.
    if (paren[2] !== 'ml' && /^\d{2,3}9$/.test(paren[1])) return { amount: { value: Number(paren[1].slice(0, -1)), unit: 'g' }, ambiguousGrams: Number(paren[1]) }
    return { amount: { value: Number(paren[1].replace(',', '.')), unit: paren[2] === 'ml' ? 'ml' : 'g' } }
  }
  // "(59g)" read "(599)": the same trailing-9 ambiguity as a nutrient, so the weight is the shorter reading and is flagged.
  const nine = /\(\s*(\d{2,4})\s*[)/]/.exec(text)
  if (nine && nine[1].endsWith('9') && nine[1].length >= 3) return { amount: { value: Number(nine[1].slice(0, -1)), unit: 'g' }, ambiguousGrams: Number(nine[1]) }
  const bare = /^(\d+(?:[.,]\d+)?)\s*(g|ml)\b/.exec(text)
  if (bare) return { amount: { value: Number(bare[1].replace(',', '.')), unit: bare[2] === 'ml' ? 'ml' : 'g' } }
  return {}
}

const parseServing = (lines: string[]): Serving => {
  for (let i = 0; i < lines.length; i += 1) {
    const match = SERVING_SIZE.exec(lines[i])
    if (!match) continue
    let rest = match[1]
    if (/^serving(?!s)/.test(match[0]) && !/size/.test(match[0])) {
      // "Serving" on one line and "size ..." on the next.
      const next = lines[i + 1] ?? ''
      if (/^size\b/.test(next)) rest = `${rest} ${next.replace(/^size\s*/, '')}`.trim()
      else if (!/\(|\d/.test(rest)) continue
    }
    rest = rest.replace(/\s*(?:amount per serving|servings?\s*per\s*container).*$/, '').trim()
    // Text after the closing bracket is the next column of a two column layout, not part of the serving.
    rest = rest.replace(/^(.*?\([^)]*\)).*$/, '$1')
    if (rest === '') rest = (lines[i + 1] ?? '').trim()
    if (rest === '') continue
    return { text: rest, ...servingAmountFrom(rest).amount ? { amount: servingAmountFrom(rest).amount } : {}, ambiguousGrams: servingAmountFrom(rest).ambiguousGrams }
  }
  return {}
}

const tidyServingText = (text: string): string => text.replace(/\((\d{2,4})9\)/, '($1g)').replace(/\s+/g, ' ').replace(/[,;]+$/, '').trim()

// --- the whole label ---------------------------------------------------------------------------------------------------

/** Lowest line confidence (0 to 100) at which a number is still trusted without a flag. */
export const CONFIDENT_DIGITS = 70
const LOW_CONFIDENCE = 'the reader was not sure of this line'
const BALANCE_TIGHT = 0.03
const BALANCE_MIN_CONFIDENCE = 50

interface Found { resolution: Resolution; lineIndexes: number[]; secondAmounts?: number; cellCount: number }

const MG_FIELDS = new Set<FieldId>(['sodium', 'cholesterol', 'calcium', 'potassium'])

const resolveCalories = (id: 'energy' | 'calories', cells: Cell[]): Resolution | undefined => {
  if (cells.length === 0) return undefined
  let list = cells
  let joined = false
  if (id === 'calories') {
    // "Calories 1 10": a number split by a space. Joined when the first piece is short and the second is two digits.
    const pure = cells.filter((cell) => !cell.pctOnly && cell.unit === undefined && cell.options.length === 1)
    if (pure.length >= 2 && cells[0] === pure[0] && String(pure[0].options[0].value).length === 1 && /^\d{2}$/.test(String(pure[1].options[0].value))) {
      const value = Number(`${pure[0].options[0].value}${pure[1].options[0].value}`)
      list = [{ ...pure[0], options: [{ value }] }, ...cells.slice(2)]
      joined = true
    }
  }
  const kcal = list.find((cell) => cell.unit === 'kcal')
  const kj = list.find((cell) => cell.unit === 'kj')
  let cell: Cell | undefined = kcal
  let converted = false
  if (!cell && id === 'energy') {
    // EU tables print kJ first, and OCR often loses the unit: "1046 k) / 250 kcal" or "1046 / 250".
    const numbers = list.filter((c) => c.options.length > 0)
    if (kj) { cell = kj; converted = true }
    else if (numbers.length >= 2 && numbers[0].options[0].value > numbers[1].options[0].value * 3) cell = numbers[1]
    else cell = numbers[0]
  }
  if (!cell) cell = list.find((c) => c.unit !== 'kj' && !c.pctOnly) ?? list[0]
  if (!cell || cell.options.length === 0) return { confidence: 'check', unread: 'the number could not be read' }
  const raw = cell.options[0].value
  const value = converted ? Math.round(raw / 4.184) : raw
  if (cell.lessThan) return { value: 0, confidence: 'ok' }
  const notes: string[] = []
  let confidence: LabelConfidence = 'ok'
  if (cell.guessedOne) { confidence = 'check'; notes.push('a letter was read as the digit 1') }
  if (joined) { confidence = 'check'; notes.push('a space inside the number was closed up') }
  if (converted) notes.push('converted from kJ')
  if (value > 2500) { confidence = 'check'; notes.push('unusually large') }
  return { value: tidy(value), confidence, note: notes.join('; ') || undefined }
}

const toLines = (input: string | LabelLineInput[]): LabelLineInput[] => (typeof input === 'string' ? input.split(/\r?\n/).map((text) => ({ text })) : input)

export const parseLabel = (input: string | LabelLineInput[]): ParsedLabel => {
  const raw = toLines(input).map((line) => ({ ...line, text: fold(line.text).replace(/\s+/g, ' ').trim() })).filter((line) => line.text !== '')
  const lines = raw.map((line) => line.text)
  const whole = lines.join('\n')
  const notes: string[] = []

  const usStyle = /nutrition\s*facts|valeur\s*nutritive|informacion\s*nutricional|serving\s*size|serv\.?\s*size|servings?\s*per\s*container|amount\s*per\s*serving|amount\/serving/.test(whole)
  const canadian = /valeur\s*nutritive/.test(whole)
  const pre2016 = /calories\s*from\s*fat|calories\s*provenant/.test(whole)
  const dvTable: DvTable = canadian ? DV_CANADA : pre2016 ? DV_OLD : DV_2020
  const perServingCue = /per\s*serving|per\s*portion|amount\s*per\s*serving|serving\s*size|each\s*\d*\s*(?:g|ml)?\s*serving/.test(whole)

  const columns = detectColumns(lines)
  const hasH = columns.order.includes('H') || PER_HUNDRED.test(whole)
  const hasS = columns.order.includes('S')
  let basis: ParsedLabel['basis'] = 'per serving'
  let basisCheck: string | undefined
  let columnKind: ColumnKind | undefined
  const hundredUnit = PER_HUNDRED.exec(whole)?.[1]
  if (usStyle) {
    basis = 'per serving'
  } else if (hasH && hasS && columns.each) {
    // "Each 30g serving contains ..." on the front of a UK pack, with "per 100g" typical values further down: the serving is what was printed first.
    basis = 'per serving'
    columnKind = 'S'
    notes.push('This label shows both per serving and per 100 g. Used per serving.')
  } else if (hasH && hasS) {
    // A table with a per 100 g column and a per serving column: take the serving.
    basis = 'per serving'
    columnKind = 'S'
    basisCheck = 'This label has per 100 g and per serving columns. Used per serving; check that the numbers are the serving column.'
    notes.push(basisCheck)
  } else if (hasH) {
    basis = hundredUnit === 'ml' ? 'per 100 ml' : 'per 100 g'
  } else if (hasS || perServingCue) {
    basis = 'per serving'
  } else {
    basis = 'per serving'
    basisCheck = 'The label did not say what the numbers are for. Assumed one serving; check.'
  }
  const perServingBasis = basis === 'per serving'

  const servingsMatch = SERVINGS_PER.exec(whole)
  let servingsPerContainer = servingsMatch ? Number((servingsMatch[1] ?? servingsMatch[2]).replace(',', '.')) : undefined
  let servingsCheck: string | undefined
  if (servingsPerContainer !== undefined && servingsPerContainer >= 20 && Number.isInteger(servingsPerContainer)) servingsCheck = 'a large number of servings; a decimal point may have been lost'

  const serving: Serving = perServingBasis ? parseServing(lines) : { text: basis === 'per 100 ml' ? '100 ml' : '100 g', amount: { value: 100, unit: basis === 'per 100 ml' ? 'ml' : 'g' } }

  // Dual columns: which one is per serving.
  const order = columns.order.filter((kind) => kind === 'S' || kind === 'C' || kind === 'H' || kind === 'P')
  let columnIndex = 0
  let columnsKnown = true
  let sawHeaderDual = false
  if (order.length === 1 && order[0] === 'P') {
    // "Cereal | With 1/2 cup skim milk": the second column is headed, so the unheaded first one is the product as packaged.
    sawHeaderDual = true
    columnIndex = 0
  } else if (order.length >= 2) {
    sawHeaderDual = true
    const wanted: ColumnKind = columnKind ?? (perServingBasis ? 'S' : 'H')
    const at = order.indexOf(wanted)
    if (order.includes('P')) { columnsKnown = false; columnIndex = 0 } else if (at >= 0) columnIndex = at
    else columnsKnown = false
  }
  if (perServingBasis && sawHeaderDual && order.includes('C') && order.includes('S')) {
    notes.push(order.indexOf('S') <= order.indexOf('C') ? 'This label has per serving and per container columns. Used per serving.' : 'This label lists per container before per serving. Used per serving.')
  }
  if (order.includes('P')) notes.push('This label has two columns (as packaged and as prepared). Used the first; check.')

  // Secondary reading: UK front-of-pack with "typical values per 100g" below the fields.
  let firstFieldLine = -1
  const found: Partial<Record<FieldId, Found>> = {}
  let stop = false
  const seen = new Set<FieldId>()
  let anyDualCells = 0
  const lineConf = (index: number): number | undefined => {
    const line = raw[index]
    if (!line) return undefined
    return line.digitConfidence ?? line.confidence
  }

  lines.forEach((line, index) => {
    if (stop) return
    if (FOOTER.test(line) || INGREDIENTS.test(line)) { stop = true; return }
    if (SKIP_LINE.test(line)) return
    if (perServingBasis && columns.each && firstFieldLine >= 0 && PER_HUNDRED.test(line) && !/serving/.test(line)) { stop = true; return }
    const segments = findSegments(line, index)
    // A label printed in two languages ("Saturated Fat/Grasa Saturada 0g") is two segments for one field; the one with the number wins.
    const hasNumber = (segment: Segment): boolean => makeCells(chunkText(segment.rest), true).cells.some((cell) => !cell.pctOnly)
    for (const segment of segments) {
      const { id } = segment
      if (firstFieldLine < 0 && id !== 'calories' && id !== 'energy') firstFieldLine = index
      seen.add(id)
      if (found[id]) continue
      if (!hasNumber(segment) && segments.some((other) => other !== segment && other.id === id && hasNumber(other))) continue
      const thousands = MG_FIELDS.has(id)
      let chunks = chunkText(id === 'addedSugars' ? `${segment.lead.replace(/(?:added|sucres|azucar|azucares).*$/, '')} ${segment.rest}` : segment.rest)
      let { cells, unparsedDigits } = makeCells(chunks, thousands)
      const sourceLines = [index]
      if (cells.filter((cell) => cell.options.length > 0 || cell.garbled).length === 0) {
        // The number sits on a neighbouring line when a column was split: "170mg 1020mg" above "Sodium 7% 44%".
        const hasPct = cells.some((cell) => cell.pctOnly)
        const usable = (candidate: string | undefined): candidate is string => Boolean(candidate) && amountsOnly(candidate as string) && findSegments(candidate as string, index).length === 0
        const order2 = hasPct ? [index - 1, index + 1] : [index + 1, index - 1]
        const pick = order2.find((i) => usable(lines[i]))
        if (pick !== undefined) {
          chunks = chunkText(lines[pick])
          const second = makeCells(chunks, thousands)
          // The percentages already on the label line stay with it.
          const pcts = cells.filter((cell) => cell.pctOnly)
          cells = second.cells
          unparsedDigits = second.unparsedDigits
          pcts.forEach((cell, i) => { const target = cells.filter((c) => c.options.length > 0)[i]; if (target && target.dv === undefined) target.dv = cell.dv })
          sourceLines.push(pick)
        }
      }
      const amountCells = cells.filter((cell) => !cell.pctOnly)
      if (amountCells.length >= 2) anyDualCells += 1
      if (id === 'energy' || id === 'calories') {
        const resolution = resolveCalories(id, cells)
        if (resolution) found.calories = found.calories ?? { resolution, lineIndexes: sourceLines, cellCount: amountCells.length }
        continue
      }
      if (id === 'salt') {
        const cell = amountCells[0]
        if (cell && cell.options[0]) found.salt = { resolution: { value: tidy(cell.options[0].value), confidence: 'ok' }, lineIndexes: sourceLines, cellCount: amountCells.length }
        continue
      }
      const meta = META[id]
      const ordered = cells.filter((cell) => !cell.pctOnly || cells.every((c) => c.pctOnly))
      const lonely = sawHeaderDual && ordered.length === 1
      const cell = ordered[columnIndex] ?? (lonely ? ordered[0] : undefined)
      const dvAmount = dvTable[id]
      let resolution: Resolution
      if (!cell) {
        resolution = { confidence: 'check', unread: 'the number could not be read' }
      } else {
        // A separate %DV cell sitting right after the chosen amount.
        const sharedDv = cell.dv
        const second = ordered.filter((c) => !c.pctOnly)[1]
        resolution = resolveCell(meta, cell, second?.options[0]?.value, order.includes('C') && order.includes('S') ? servingsPerContainer : undefined, { dvAmount, sharedDv })
        if (lonely && resolution.value !== undefined) resolution = { ...resolution, confidence: 'check', note: 'only one column was readable, so it is not clear which it is' }
        else if (!sawHeaderDual && ordered.filter((c) => !c.pctOnly).length >= 2 && resolution.value !== undefined && resolution.confidence === 'ok') resolution = { ...resolution, confidence: 'check', note: 'two numbers were read on this row; it may be one number split in two' }
      }
      if (unparsedDigits && resolution.value !== undefined && resolution.confidence === 'ok') resolution = { ...resolution, confidence: 'check', note: 'some of the text around it could not be read' }
      else if (unparsedDigits && resolution.value === undefined) resolution = { ...resolution, unread: resolution.unread ?? 'the number could not be read' }
      found[id] = { resolution, lineIndexes: sourceLines, cellCount: amountCells.length, secondAmounts: undefined }
    }
  })

  // A row we saw whose number never turned up: blank, to be typed in.
  for (const id of seen) if (id !== 'salt' && id !== 'energy' && !found[id]) found[id] = { resolution: { confidence: 'check', unread: 'the number could not be read' }, lineIndexes: [], cellCount: 0 }
  // Per-field results, with the line confidence and the "columns we could not identify" flags applied.
  const values: Partial<Record<LabelKey, LabelValue>> = {}
  const unread: Partial<Record<LabelKey, string>> = {}
  const lowConf: Partial<Record<LabelKey, number>> = {}
  const unknownColumns = !sawHeaderDual && anyDualCells >= 2
  if (unknownColumns) notes.push('The label seems to have two columns and the headers could not be read. Check every number against the package.')
  for (const key of LABEL_KEYS) {
    const entry = found[key]
    if (!entry) continue
    const { resolution } = entry
    if (resolution.value === undefined) { unread[key] = resolution.unread ?? 'the number could not be read'; continue }
    let confidence = resolution.confidence
    let note = resolution.note
    const conf = Math.min(...entry.lineIndexes.map((i) => lineConf(i) ?? 100))
    if (confidence === 'ok' && !resolution.corroborated && conf < CONFIDENT_DIGITS) { confidence = 'check'; note = LOW_CONFIDENCE; lowConf[key] = conf }
    if (confidence === 'ok' && (unknownColumns || !columnsKnown)) { confidence = 'check'; note = 'the column could not be identified' }
    if (confidence === 'ok' && sawHeaderDual && basisCheck) { confidence = 'check'; note = 'from the per serving column of a two column table' }
    values[key] = { value: resolution.value, confidence, ...(note && confidence === 'check' ? { note } : {}), ...(resolution.alternatives ? { alternatives: resolution.alternatives } : {}) }
  }

  // Salt on per 100 g labels, and per-100 plausibility.
  const salt = found.salt?.resolution.value
  if (!values.sodium && salt !== undefined) {
    const high = !perServingBasis && salt > 6
    values.sodium = { value: Math.round(salt * 400), confidence: high ? 'check' : 'ok', ...(high ? { note: 'unusually salty; check the salt figure' } : {}) }
    if (perServingBasis) values.sodium = { ...values.sodium, confidence: 'check', note: `from ${salt} g salt (1 g salt is 400 mg sodium)` }
  }
  if (!perServingBasis) {
    const fibre = values.fiber
    if (fibre && fibre.value >= 15) values.fiber = { ...fibre, confidence: 'check', note: 'unusually high; a decimal point may have been lost' }
  }

  const checkNumbers = applyConsistency(values, unread)
  // The four energy numbers check each other: when they balance tightly, a doubtful read of one line is not worth a flag.
  const four = ['calories', 'protein', 'carbs', 'fat'] as const
  if (!checkNumbers && four.every((key) => values[key])) {
    const [c, p, k, f] = four.map((key) => (values[key] as LabelValue).value)
    if (Math.abs(energyOf(p, k, f) - c) <= BALANCE_TIGHT * c + 5) {
      for (const key of four) {
        const entry = values[key]
        if (entry && entry.confidence === 'check' && entry.note === LOW_CONFIDENCE && (lowConf[key] ?? 0) >= BALANCE_MIN_CONFIDENCE) values[key] = { value: entry.value, confidence: 'ok' }
      }
    }
  }
  if (checkNumbers) notes.push('Check these numbers: the calories do not match the protein, carbs and fat.')

  // Serving weight sanity: kcal per gram.
  let servingCheck: string | undefined
  let servingAmount = serving.amount
  if (serving.ambiguousGrams !== undefined) servingCheck = 'the weight in brackets could be read two ways'
  const kcal = values.calories?.value
  if (servingAmount && perServingBasis && kcal !== undefined && kcal > 0) {
    const perGram = kcal / servingAmount.value
    if (servingAmount.unit === 'g' && (perGram > 9.1 || perGram < 0.05)) {
      servingAmount = undefined
      servingCheck = 'the weight in brackets did not fit the calories, so it was left out'
    }
  }
  if (!servingAmount && serving.text && /\(\s*[\d.,]+/.test(serving.text) && !servingCheck) servingCheck = 'the weight in brackets could not be read'

  // Dual columns that disagree with the printed servings.
  if (servingsPerContainer !== undefined && servingsPerContainer <= 0) { servingsPerContainer = undefined }

  const nutrientsRead = Object.keys(values).length - (values.calories ? 1 : 0)
  const hasCalories = values.calories !== undefined
  return {
    basis,
    ...(basisCheck ? { basisCheck } : {}),
    servingText: serving.text ? tidyServingText(serving.text) : undefined,
    servingAmount,
    ...(servingCheck ? { servingCheck } : {}),
    servingsPerContainer,
    ...(servingsCheck ? { servingsCheck } : {}),
    values,
    unread,
    checkNumbers,
    notes,
    hasCalories,
    usable: hasCalories || nutrientsRead >= 3,
  }
}

// --- consistency -----------------------------------------------------------------------------------------------------

const energyOf = (protein: number, carbs: number, fat: number): number => 4 * protein + 4 * carbs + 9 * fat
const energyAgrees = (calories: number, estimate: number): boolean => Math.abs(estimate - calories) <= 0.25 * Math.max(calories, estimate) + 8

const valuesFor = (entry: LabelValue | undefined): number[] => (entry ? [entry.value, ...(entry.alternatives ?? [])] : [])

const flag = (values: Partial<Record<LabelKey, LabelValue>>, key: LabelKey, note: string) => {
  const entry = values[key]
  if (entry) values[key] = { ...entry, confidence: 'check', note: entry.confidence === 'check' && entry.note ? entry.note : note }
}

/** Parent / child rules and the energy balance. Returns true when the set as a whole still looks wrong. */
const applyConsistency = (values: Partial<Record<LabelKey, LabelValue>>, unread: Partial<Record<LabelKey, string>>): boolean => {
  const pairs: Array<[LabelKey, LabelKey[]]> = [['satFat', ['fat']], ['transFat', ['fat']], ['sugars', ['carbs']], ['fiber', ['carbs']], ['addedSugars', ['sugars', 'carbs']]]
  for (const [child, parents] of pairs) {
    const entry = values[child]
    if (!entry) continue
    const limit = Math.min(...parents.map((parent) => values[parent]?.value ?? Infinity))
    if (entry.value <= limit + 0.5) continue
    const fix = valuesFor(entry).find((value) => value <= limit + 0.5)
    if (fix !== undefined && fix !== entry.value) values[child] = { value: fix, confidence: 'check', note: 'the number was larger than the nutrient it belongs to, so it was re-read' }
    else if (Number.isInteger(entry.value) && entry.value >= 10 && entry.value / 10 <= limit + 0.5) values[child] = { value: entry.value / 10, confidence: 'check', note: 'a decimal point looked lost' }
    else values[child] = { ...entry, confidence: 'check', note: 'larger than the nutrient it belongs to' }
  }
  // Per 100 g: the macros cannot add up to more than 100 g.
  const { calories, protein, carbs, fat } = values
  const macroUnread = !protein || !carbs || !fat
  if (!calories) return false

  // Bounds that hold even when a macro is missing.
  let boundBroken = false
  for (const [key, factor] of [['fat', 9], ['protein', 4], ['carbs', 4]] as const) {
    const entry = values[key]
    if (entry && factor * entry.value > calories.value * 1.15 + 8) {
      flag(values, key, 'more calories than the label total')
      flag(values, 'calories', 'less than the nutrients add up to')
      boundBroken = true
    }
  }
  const macroGrams = (fat?.value ?? 0) + (protein?.value ?? 0) + (carbs?.value ?? 0)
  if (calories.value < 5 && macroGrams >= 1) { flag(values, 'calories', 'very low for the nutrients on the label'); boundBroken = true }

  if (macroUnread) {
    // Cannot check the energy balance: say so rather than trust the number.
    for (const key of ['protein', 'carbs', 'fat'] as const) if (!values[key] && !unread[key]) unread[key] = 'not found on the label photo'
    flag(values, 'calories', 'could not be checked against protein, carbs and fat')
    return boundBroken
  }
  if (energyAgrees(calories.value, energyOf(protein.value, carbs.value, fat.value)) && !boundBroken) return false
  if (energyAgrees(calories.value, energyOf(protein.value, carbs.value, fat.value))) return boundBroken

  // Try the other readings of the flagged numbers; adopt one only when exactly one combination balances.
  const mutable = (entry: LabelValue): number[] => (entry.confidence === 'check' ? valuesFor(entry) : [entry.value])
  const working: Array<{ c: number; p: number; k: number; f: number }> = []
  for (const c of mutable(calories)) for (const p of mutable(protein)) for (const k of mutable(carbs)) for (const f of mutable(fat)) {
    if (energyAgrees(c, energyOf(p, k, f))) working.push({ c, p, k, f })
  }
  if (working.length === 1) {
    const [fix] = working
    const mark = (key: 'calories' | 'protein' | 'carbs' | 'fat', value: number) => {
      const entry = values[key] as LabelValue
      if (entry.value !== value) values[key] = { value, confidence: 'check', note: 'another reading of the text fits the other numbers better' }
    }
    mark('calories', fix.c)
    mark('protein', fix.p)
    mark('carbs', fix.k)
    mark('fat', fix.f)
    // Whatever was re-read stays flagged; the rest is as sure as before, but the balance itself is only a coincidence check.
    for (const key of ['calories', 'protein', 'carbs', 'fat'] as const) flag(values, key, 'checked against the other numbers')
    return false
  }
  for (const key of ['calories', 'protein', 'carbs', 'fat'] as const) flag(values, key, 'the calories do not match the protein, carbs and fat')
  return true
}
