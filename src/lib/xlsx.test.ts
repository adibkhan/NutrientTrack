import { describe, expect, it } from 'vitest'
import { strToU8 as encode, zipSync } from 'fflate'
import { readXlsx, XlsxError } from './xlsx'
import { buildXlsx } from './testkit/xlsxBuilder'

const strToU8 = (text: string) => Uint8Array.from(encode(text))

describe('readXlsx', () => {
  it('reads_shared_strings_inline_strings_numbers_formulas_and_gaps', async () => {
    const shared = buildXlsx([{ name: 'One', rows: [['Name', 'Qty'], ['Oats & "milk"', 1.5], [null, { formula: 'A1', value: 'x' }, 7]] }])
    const inline = buildXlsx([{ name: 'Two', inline: true, rows: [['a', 'b'], ['c', 2]] }])
    const one = await readXlsx(shared)
    expect(one.sheets.map((sheet) => sheet.name)).toEqual(['One'])
    expect(one.sheets[0].rows).toEqual([['Name', 'Qty'], ['Oats & "milk"', '1.5'], ['', 'x', '7']])
    expect((await readXlsx(inline)).sheets[0].rows).toEqual([['a', 'b'], ['c', '2']])
    expect(one.date1904).toBe(false)
  })

  it('reads_prefixed_xml_and_the_1904_flag_and_keeps_sheet_order', async () => {
    const book = await readXlsx(buildXlsx([{ name: 'Z first', rows: [['h'], ['v']] }, { name: 'A second', rows: [['h2']] }], { date1904: true, prefix: 'x:' }))
    expect(book.sheets.map((sheet) => sheet.name)).toEqual(['Z first', 'A second'])
    expect(book.sheets[0].rows).toEqual([['h'], ['v']])
    expect(book.date1904).toBe(true)
  })

  it('refuses_files_that_are_not_workbooks', async () => {
    await expect(readXlsx(strToU8('not a zip'))).rejects.toBeInstanceOf(XlsxError)
    await expect(readXlsx(zipSync({ 'readme.txt': strToU8('hi') }))).rejects.toBeInstanceOf(XlsxError)
  })
})
