import { strToU8 as encode, zipSync } from 'fflate'

/** Copied into this realm's Uint8Array: under jsdom, fflate's own `instanceof` checks fail on arrays from another realm. */
const strToU8 = (text: string): Uint8Array => Uint8Array.from(encode(text))

/** Builds small .xlsx files for tests by writing the SpreadsheetML parts by hand and zipping them. */
export type TestCell = string | number | null | { formula: string; value: string | number }
export interface TestSheet { name: string; rows: TestCell[][]; /** Write text as inline strings instead of shared strings. */ inline?: boolean }

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const columnName = (index: number) => { let name = ''; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name; return name }

export const buildXlsx = (sheets: TestSheet[], options: { date1904?: boolean; prefix?: string } = {}): Uint8Array => {
  const shared: string[] = []
  const sharedIndex = (text: string) => { const found = shared.indexOf(text); if (found !== -1) return found; shared.push(text); return shared.length - 1 }
  const p = options.prefix ?? ''
  const worksheets: Record<string, Uint8Array> = {}
  sheets.forEach((sheet, sheetIndex) => {
    const rows = sheet.rows.map((row, rowIndex) => {
      const cells = row.map((value, columnIndex) => {
        const ref = `${columnName(columnIndex)}${rowIndex + 1}`
        if (value === null) return `<${p}c r="${ref}"/>`
        if (typeof value === 'number') return `<${p}c r="${ref}"><${p}v>${value}</${p}v></${p}c>`
        if (typeof value === 'object') return typeof value.value === 'number' ? `<${p}c r="${ref}"><${p}f>${escape(value.formula)}</${p}f><${p}v>${value.value}</${p}v></${p}c>` : `<${p}c r="${ref}" t="str"><${p}f>${escape(value.formula)}</${p}f><${p}v>${escape(value.value)}</${p}v></${p}c>`
        if (sheet.inline) return `<${p}c r="${ref}" t="inlineStr"><${p}is><${p}t>${escape(value)}</${p}t></${p}is></${p}c>`
        return `<${p}c r="${ref}" t="s"><${p}v>${sharedIndex(value)}</${p}v></${p}c>`
      })
      return `<${p}row r="${rowIndex + 1}">${cells.join('')}</${p}row>`
    })
    worksheets[`xl/worksheets/sheet${sheetIndex + 1}.xml`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${p}worksheet xmlns${p ? `:${p.slice(0, -1)}` : ''}="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><${p}sheetData>${rows.join('')}</${p}sheetData></${p}worksheet>`)
  })
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr${options.date1904 ? ' date1904="1"' : ''}/><sheets>${sheets.map((sheet, index) => `<sheet name="${escape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`
  const rels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_sheet, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}</Relationships>`
  const sharedXml = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared.map((text) => `<si><t xml:space="preserve">${escape(text)}</t></si>`).join('')}</sst>`
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(rels),
    'xl/sharedStrings.xml': strToU8(sharedXml),
    ...worksheets,
  })
}

/** Days since 1899-12-30 (the 1900 date system) for an ISO date, plus an optional time fraction. */
export const serialOf = (iso: string, hour = 0, minute = 0): number => {
  const [y, m, d] = iso.split('-').map(Number)
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000 + (hour * 60 + minute) / 1440
}
