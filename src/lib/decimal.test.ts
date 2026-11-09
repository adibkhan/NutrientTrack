import { describe, expect, it } from 'vitest'
import { ambiguityMessage, inputText, parseDecimal, parseDecimalDetailed } from './decimal'

describe('parseDecimal: accepted text', () => {
  it.each([
    ['1,5', 1.5], ['1.5', 1.5], [',5', 0.5], ['.5', 0.5], ['5,', 5], ['1.', 1], ['00012', 12], ['2000', 2000], ['82,4', 82.4],
    ['12,50', 12.5], ['0,125', 0.125], ['0.125', 0.125], ['  7 ', 7], ['-3', -3], ['-1,5', -1.5], ['0', 0], ['-0', 0],
    ['1.234,5', 1234.5], ['1,234.5', 1234.5], ['1,234,567', 1234567], ['1.234.567', 1234567], ['12,3456', 12.3456],
    ['1 234,5', 1234.5], ['1 234,5', 1234.5], ['1 234.5', 1234.5], ['1 234 567', 1234567], ['1 234', 1234],
    ['1,2', 1.2], ['1200', 1200], ['10,5', 10.5], ['1.234,567', 1234.567],
  ])('%j -> %d', (text, expected) => {
    const result = parseDecimalDetailed(text)
    expect(result.reason).toBeUndefined()
    expect(result.value).toBe(expected)
    expect(parseDecimal(text)).toBe(expected)
  })
})

describe('parseDecimal: Unicode digits', () => {
  it.each([
    ['١٫٥', 1.5], ['٨٢٫٤', 82.4], ['۱٫۵', 1.5], ['۸۲.۴', 82.4], ['１２３', 123], ['１，５', NaN], ['１.５', 1.5], ['١٬٢٣٤٫٥', 1234.5], ['١٬٢٣٤', 1234], ['٢٬٠٠٠', 2000],
  ])('%j -> %d', (text, expected) => {
    expect(parseDecimal(text)).toBe(expected)
  })
  it('treats the Arabic decimal mark like a decimal mark for ambiguity', () => {
    expect(parseDecimalDetailed('٢٫٠٠٠').reason).toBe('ambiguous')
  })
})

describe('parseDecimal: refused text', () => {
  it.each(['', '   ', '-', '.', ',', '+5', '1e9', '1,5e2', '1E3', 'abc', '150 g', '1/2', '½', '$5', '5%', '1_000', '- 5', '1,2,3', '1.2.3', '1,23,456', '1 23', '1  234', ' 1 2 ', '1.234,5,6', ',234.5', '1,234.56,7', '--1', '1-', '0,000,123', 'Infinity', '0x10', '1٬5'])('%j is invalid', (text) => {
    const result = parseDecimalDetailed(text)
    expect(result.value).toBeNaN()
    expect(result.reason).toBe('invalid')
    expect(parseDecimal(text)).toBeNaN()
  })
})

describe('parseDecimal: ambiguity', () => {
  it.each(['2,000', '1,200', '2.000', '10,000', '1,125', '999.999', '12,345', '100,000', ' 2,000 ', '-2,000'])('%j is ambiguous', (text) => {
    const result = parseDecimalDetailed(text)
    expect(result.value).toBeNaN()
    expect(result.reason).toBe('ambiguous')
    expect(parseDecimal(text)).toBeNaN()
  })
  it.each([['0,125', 0.125], ['1,5', 1.5], ['82,4', 82.4], ['12,50', 12.5], ['2000', 2000], ['1,2000', 1.2], ['1.234,5', 1234.5], ['1,000,000', 1000000], ['1 234', 1234]])('%j is not ambiguous', (text, value) => {
    expect(parseDecimalDetailed(text).reason).toBeUndefined()
    expect(parseDecimal(text)).toBe(value)
  })
})

describe('ambiguityMessage', () => {
  it('is undefined for anything that is not ambiguous', () => {
    for (const text of ['', '1,5', '2000', 'abc', '0,125']) expect(ambiguityMessage(text)).toBeUndefined()
  })
  it('leaves negative text to the callers, which refuse it as a negative', () => {
    expect(ambiguityMessage('-2,000')).toBeUndefined()
    expect(parseDecimalDetailed('-2,000').reason).toBe('ambiguous')
  })
  it('names both readings for a thousand-like number', () => {
    expect(ambiguityMessage('2,000')).toBe('“2,000” could mean 2000 or 2. Type 2000, or 2.')
    expect(ambiguityMessage('2.000')).toBe('“2.000” could mean 2000 or 2. Type 2000, or 2.')
    expect(ambiguityMessage('1,200')).toBe('“1,200” could mean 1200 or 1.2. Type 1200, or 1.2.')
    expect(ambiguityMessage('10,000')).toBe('“10,000” could mean 10000 or 10. Type 10000, or 10.')
  })
  it('asks for fewer decimals or no separator when the small reading needs three decimals', () => {
    expect(ambiguityMessage('1,125')).toBe('“1,125” could mean 1125 or 1.125. Type 1125, or 1.1250.')
  })
})

describe('inputText', () => {
  it('writes plain numbers with no grouping and no exponent', () => {
    expect(inputText(1500)).toBe('1500')
    expect(inputText(1.5)).toBe('1.5')
    expect(inputText(0)).toBe('0')
    expect(inputText(-2.5)).toBe('-2.5')
    expect(inputText(1e-7)).toBe('0.0000001')
    expect(inputText(1e21)).toBe('1000000000000000000000')
    expect(inputText(0.1 + 0.2)).toBe('0.30000000000000004')
  })
  it('adds a trailing zero when the text would be ambiguous, so an untouched prefill re-parses to the same number', () => {
    expect(inputText(1.125)).toBe('1.1250')
    expect(inputText(2)).toBe('2')
    expect(inputText(2.5)).toBe('2.5')
    expect(inputText(-1.125)).toBe('-1.1250')
    for (const value of [1.125, 999.999, 2.001, 10.5, 0.125, 1234.567, 1e-7, 123456789.125]) expect(parseDecimal(inputText(value))).toBe(value)
  })
  it('is empty for numbers that are not finite', () => {
    expect(inputText(NaN)).toBe('')
    expect(inputText(Infinity)).toBe('')
  })
})
