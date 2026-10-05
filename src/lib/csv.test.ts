import { describe, expect, it } from 'vitest'
import type { DiaryEntry, Food, WeightEntry } from '../types'
import { csvCell, entriesCsv, foodsCsv, toCsv, weightsCsv } from './csv'

const stamp = '2026-01-01T00:00:00.000Z'
const BOM = '﻿'
const rows = (csv: string) => csv.replace(BOM, '').split('\r\n').slice(0, -1)

describe('csvCell', () => {
  it.each([
    ['plain', 'plain'],
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['line\nbreak', '"line\nbreak"'],
    ['line\r\nbreak', '"line\r\nbreak"'],
  ])('writes %j as %j', (input, out) => expect(csvCell(input)).toBe(out))

  it('writes numbers unquoted, including zero and decimals', () => {
    expect(csvCell(0)).toBe('0')
    expect(csvCell(12.5)).toBe('12.5')
  })

  it.each([NaN, Infinity, -Infinity])('writes %s as empty', (n) => expect(csvCell(n)).toBe(''))

  it('writes undefined and null as empty', () => {
    expect(csvCell(undefined)).toBe('')
    expect(csvCell(null)).toBe('')
  })

  it('writes booleans as true and false', () => {
    expect(csvCell(true)).toBe('true')
    expect(csvCell(false)).toBe('false')
  })

  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tx'])('prefixes an apostrophe on formula-like text %j', (s) => {
    expect(csvCell(s)).toBe(`'${s}`)
  })

  it('prefixes then quotes text that starts with a formula character and has a comma', () => {
    expect(csvCell('=a,b')).toBe('"\'=a,b"')
  })

  it('quotes carriage-return text and protects it', () => {
    expect(csvCell('\rx')).toBe('"\'\rx"')
  })

  it('does not alter negative numbers', () => {
    expect(csvCell(-5)).toBe('-5')
    expect(csvCell(-0.25)).toBe('-0.25')
  })

  it('does not protect a formula character that is not first', () => {
    expect(csvCell('a=b')).toBe('a=b')
  })
})

describe('toCsv', () => {
  it('writes a BOM, header, CRLF line ends and a trailing CRLF', () => {
    const csv = toCsv([{ a: 1, b: 'x' }], [{ key: 'a', header: 'A' }, { key: 'b', header: 'B' }])
    expect(csv).toBe(`${BOM}A,B\r\n1,x\r\n`)
  })

  it('writes only the header for no rows', () => {
    expect(toCsv([], [{ key: 'a', header: 'A' }])).toBe(`${BOM}A\r\n`)
  })
})

const entry = (over: Partial<DiaryEntry> & { id: string }): DiaryEntry => ({
  date: '2026-03-02', meal: 'lunch', name: 'Food', calories: 100, protein: 1, carbs: 2, fat: 3, createdAt: stamp, updatedAt: stamp, ...over,
})

describe('entriesCsv', () => {
  it('has the expected header', () => {
    expect(rows(entriesCsv([]))[0]).toBe('Date,Time,Meal,Food,Grams,Calories,Protein (g),Carbs (g),Fat (g),Fiber (g),Sodium (mg),Sugar (g),Saturated fat (g),Cholesterol (mg),Planned')
  })

  it('sorts by date then time, with missing time first', () => {
    const csv = rows(entriesCsv([
      entry({ id: 'a', name: 'C', date: '2026-03-03' }),
      entry({ id: 'b', name: 'B', time: '12:00' }),
      entry({ id: 'c', name: 'A', time: '08:00' }),
      entry({ id: 'd', name: 'N' }),
    ]))
    expect(csv.slice(1).map((r) => r.split(',')[3])).toEqual(['N', 'A', 'B', 'C'])
  })

  it('does not mutate the input order', () => {
    const input = [entry({ id: 'a', date: '2026-03-03' }), entry({ id: 'b' })]
    entriesCsv(input)
    expect(input.map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('leaves missing time and grams empty rather than zero, and planned empty when unset', () => {
    expect(rows(entriesCsv([entry({ id: 'a' })]))[1]).toBe('2026-03-02,,lunch,Food,,100,1,2,3,,,,,,')
  })

  it('keeps a recorded grams of zero and writes planned true', () => {
    expect(rows(entriesCsv([entry({ id: 'a', grams: 0, planned: true })]))[1]).toBe('2026-03-02,,lunch,Food,0,100,1,2,3,,,,,,true')
  })
})

describe('weightsCsv', () => {
  const w = (over: Partial<WeightEntry> & { id: string }): WeightEntry => ({ date: '2026-03-02', weight: 180, unit: 'lb', createdAt: stamp, ...over }) as WeightEntry

  it('sorts by date and leaves a missing note empty', () => {
    const csv = rows(weightsCsv([w({ id: 'b', date: '2026-03-05', weight: 179 }), w({ id: 'a', note: 'a, b' })]))
    expect(csv).toEqual(['Date,Weight,Unit,Body fat (%),Note', '2026-03-02,180,lb,,"a, b"', '2026-03-05,179,lb,,'])
  })
})

describe('foodsCsv', () => {
  const f = (name: string): Food => ({ id: name, name, serving: '1 cup', calories: 10, protein: 1, carbs: 2, fat: 3, createdAt: stamp, updatedAt: stamp })

  it('sorts by name', () => {
    expect(rows(foodsCsv([f('Rice'), f('Apple')])).slice(1).map((r) => r.split(',')[0])).toEqual(['Apple', 'Rice'])
  })

  it('neutralises a food named like a formula', () => {
    const line = rows(foodsCsv([f('=HYPERLINK("x")')]))[1]
    expect(line.startsWith('"\'=HYPERLINK(""x"")",')).toBe(true)
  })
})
