/**
 * Decimal parsing for typed numbers. Number fields are plain text so that "1,5" is read as 1.5 instead of being
 * silently turned into 15 (or refused) by the browser. Text that could be read two ways ("2,000") is refused with a
 * message instead of guessed at.
 */

export type DecimalReason = 'ambiguous' | 'invalid'
export interface DecimalResult { value: number; reason?: DecimalReason }

const DIGIT_BLOCKS: number[] = [0x0660, 0x06f0, 0xff10]
const GROUP_MARK = '\u0001'
const SPACES = /[   ]/
const AMBIGUOUS = /^[1-9]\d{0,2}[.,]\d{3}$/

const toAscii = (text: string): string => {
  let out = ''
  for (const char of text) {
    const code = char.codePointAt(0) as number
    const block = DIGIT_BLOCKS.find((start) => code >= start && code <= start + 9)
    if (block !== undefined) out += String(code - block)
    else if (char === '٫') out += '.'
    else if (char === '٬') out += GROUP_MARK
    else out += char
  }
  return out
}

const stripSign = (text: string): string => (text.startsWith('-') ? text.slice(1) : text)

const isAmbiguous = (ascii: string): boolean => AMBIGUOUS.test(stripSign(ascii))

const invalid = (): DecimalResult => ({ value: NaN, reason: 'invalid' })

export const parseDecimalDetailed = (text: string): DecimalResult => {
  if (typeof text !== 'string') return invalid()
  const ascii = toAscii(text).trim()
  if (ascii === '') return invalid()
  if (isAmbiguous(ascii)) return { value: NaN, reason: 'ambiguous' }
  const negative = ascii.startsWith('-')
  let body = stripSign(ascii)
  if (!/^[0-9.,\u0001   ]+$/.test(body)) return invalid()
  // Thousands marks: spaces and the Arabic thousands mark, only between groups of three digits.
  if (SPACES.test(body) || body.includes(GROUP_MARK)) {
    const mark = body.includes(GROUP_MARK) ? GROUP_MARK : '[ \\u00a0\\u202f]'
    if (!new RegExp(`^[1-9]\\d{0,2}(${mark}\\d{3})+([.,]\\d*)?$`).test(body)) return invalid()
    body = body.replace(new RegExp(mark, 'g'), '')
  }
  if (!/^[0-9.,]+$/.test(body) || !/\d/.test(body)) return invalid()
  const commas = (body.match(/,/g) ?? []).length
  const dots = (body.match(/\./g) ?? []).length
  let normalized: string
  if (commas === 0 && dots === 0) {
    normalized = body
  } else if (commas > 0 && dots > 0) {
    const last = Math.max(body.lastIndexOf(','), body.lastIndexOf('.'))
    const decimalChar = body[last]
    const otherChar = decimalChar === ',' ? '.' : ','
    const whole = body.slice(0, last)
    const fraction = body.slice(last + 1)
    if (!/^\d*$/.test(fraction)) return invalid()
    const escaped = otherChar === '.' ? '\\.' : ','
    if (!new RegExp(`^[1-9]\\d{0,2}(${escaped}\\d{3})+$`).test(whole)) return invalid()
    normalized = `${whole.split(otherChar).join('')}.${fraction}`
  } else if (commas + dots === 1) {
    normalized = body.replace(',', '.')
  } else {
    const sep = commas > 0 ? ',' : '.'
    const escaped = sep === '.' ? '\\.' : ','
    if (!new RegExp(`^[1-9]\\d{0,2}(${escaped}\\d{3})+$`).test(body)) return invalid()
    normalized = body.split(sep).join('')
  }
  if (normalized.startsWith('.')) normalized = `0${normalized}`
  if (normalized.endsWith('.')) normalized = normalized.slice(0, -1)
  const value = Number(normalized)
  if (!Number.isFinite(value)) return invalid()
  const signed = negative ? -value : value
  return { value: signed === 0 ? 0 : signed }
}

/** The number typed, or NaN when the text is blank, invalid or ambiguous. */
export const parseDecimal = (text: string): number => parseDecimalDetailed(text).value

/** The field-level message for non-negative text that could be read two ways, or undefined when it is not ambiguous (or is negative, which callers refuse on its own). */
export const ambiguityMessage = (text: string): string | undefined => {
  const shown = toAscii(text).trim()
  if (parseDecimalDetailed(text).reason !== 'ambiguous') return undefined
  // Every number box here takes zero or more, so a negative is refused as a negative, not offered readings that are also refused.
  if (shown.startsWith('-')) return undefined
  const unsigned = stripSign(shown)
  const match = /^(\d+)([.,])(\d{3})$/.exec(unsigned)
  if (!match) return undefined
  const [, whole, , fraction] = match
  const sign = ''
  const big = `${sign}${whole}${fraction}`
  const trimmed = fraction.replace(/0+$/, '')
  if (trimmed === '') return `“${shown}” could mean ${big} or ${sign}${whole}. Type ${big}, or ${sign}${whole}.`
  if (trimmed.length < 3) return `“${shown}” could mean ${big} or ${sign}${whole}.${trimmed}. Type ${big}, or ${sign}${whole}.${trimmed}.`
  return `“${shown}” could mean ${big} or ${sign}${whole}.${fraction}. Type ${big}, or ${sign}${whole}.${fraction}0.`
}

/** Text for an input field from a stored number: no exponent, no grouping, and never something that would re-parse as ambiguous. */
export const inputText = (value: number): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  const text = value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 })
  const plain = text === '-0' ? '0' : text
  return isAmbiguous(plain) ? `${plain}0` : plain
}

/** Like inputText, for a value that may be missing. */
export const inputTextOpt = (value: number | undefined): string => (value === undefined ? '' : inputText(value))

/** Parse text that may be blank: undefined when blank, NaN when not a number. */
export const parseOptionalDecimal = (text: string): number | undefined => (text.trim() === '' ? undefined : parseDecimal(text))
