/**
 * A small .xlsx reader. An xlsx is a zip of XML parts; this reads sheet names, shared strings, inline strings and cell values,
 * and returns every sheet as rows of text. Numbers come back as the raw text stored in the file and are flagged in `rowKinds`
 * (dates are serial numbers in the cell; the caller decides which columns are dates). Formulas are read by their cached value.
 *
 * The XML is scanned with indexOf, never with backtracking patterns, so time is linear in the size of the part.
 * The unzip library (fflate) is imported only when a file is opened here, so it never loads with the app.
 */
export interface Sheet {
  name: string
  rows: string[][]
  /** Per row, one character per cell: "n" for a number stored as a number, "t" for text. Missing for CSV sheets (all text). */
  rowKinds?: string[]
  /** Hidden in the workbook; the caller skips these. */
  hidden?: boolean
}
export interface Workbook { sheets: Sheet[]; /** Mac Excel's 1904 date system; Windows files use 1900. */ date1904: boolean }

export class XlsxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'XlsxError'
  }
}

/** Most XML any one part may inflate to, and the most all parts together may. */
export const MAX_PART_BYTES = 40_000_000
export const MAX_TOTAL_BYTES = 60_000_000
const MAX_ROWS = 400_000
const MAX_COLUMNS = 200
const YIELD_EVERY_ROWS = 3000

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decode = (text: string): string => {
  if (text.indexOf('&') === -1 && text.indexOf('_x') === -1) return text
  return text
    .replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi, (_all, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
      if (name) return ENTITIES[name.toLowerCase()]
      const code = dec !== undefined ? Number(dec) : parseInt(hex as string, 16)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    })
    .replace(/_x([0-9a-f]{4})_/gi, (_all, hex: string) => String.fromCharCode(parseInt(hex, 16)))
}

const attribute = (tag: string, name: string): string | undefined => {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag)
  return match ? decode(match[2] ?? match[3] ?? '') : undefined
}

const isNameEnd = (character: string | undefined) => character === ' ' || character === '>' || character === '/' || character === '\t' || character === '\n' || character === '\r'
/** Index of the next `<tag` that is a whole tag name (not a longer one), or -1. */
const findOpen = (xml: string, tag: string, from: number): number => {
  let index = from
  for (;;) {
    index = xml.indexOf(tag, index)
    if (index === -1) return -1
    if (isNameEnd(xml[index + tag.length])) return index
    index += tag.length
  }
}
interface Element { attrs: string; inner: string; next: number }
/** The element opening at `index`, with its attribute text, inner text and where to continue. */
const elementAt = (xml: string, index: number, tag: string, close: string): Element => {
  const end = xml.indexOf('>', index)
  if (end === -1) return { attrs: xml.slice(index + tag.length), inner: '', next: xml.length }
  const attrs = xml.slice(index + tag.length, end)
  if (xml[end - 1] === '/') return { attrs, inner: '', next: end + 1 }
  const closing = xml.indexOf(close, end + 1)
  if (closing === -1) return { attrs, inner: xml.slice(end + 1), next: xml.length }
  return { attrs, inner: xml.slice(end + 1, closing), next: closing + close.length }
}
const prefixOf = (xml: string, root: string): string => {
  const match = new RegExp(`<(\\w+:)?${root}[\\s>]`).exec(xml.slice(0, 4000))
  return match?.[1] ?? ''
}

/** The text of every <t> in a fragment (rich text runs are joined; phonetic hints are left out). */
const textOf = (fragment: string, px: string): string => {
  let clean = fragment
  const ph = `<${px}rPh`
  for (let at = findOpen(clean, ph, 0); at !== -1; at = findOpen(clean, ph, at)) {
    const closing = clean.indexOf(`</${px}rPh>`, at)
    clean = closing === -1 ? clean.slice(0, at) : clean.slice(0, at) + clean.slice(closing + `</${px}rPh>`.length)
  }
  let out = ''
  const tag = `<${px}t`
  for (let at = findOpen(clean, tag, 0); at !== -1;) {
    const element = elementAt(clean, at, tag, `</${px}t>`)
    out += decode(element.inner)
    at = findOpen(clean, tag, element.next)
  }
  return out
}

const columnIndex = (reference: string): number => {
  let index = 0
  for (const character of reference.toUpperCase()) {
    if (character < 'A' || character > 'Z') break
    index = index * 26 + (character.charCodeAt(0) - 64)
  }
  return index - 1
}

const parseSharedStrings = (xml: string): string[] => {
  const px = prefixOf(xml, 'sst')
  const tag = `<${px}si`
  const strings: string[] = []
  for (let at = findOpen(xml, tag, 0); at !== -1;) {
    const element = elementAt(xml, at, tag, `</${px}si>`)
    strings.push(textOf(element.inner, px))
    at = findOpen(xml, tag, element.next)
  }
  return strings
}

const yieldToUi = () => new Promise<void>((resolve) => { setTimeout(resolve, 0) })

const parseSheet = async (xml: string, shared: string[]): Promise<{ rows: string[][]; rowKinds: string[] }> => {
  const px = prefixOf(xml, 'worksheet')
  const rowTag = `<${px}row`
  const cellTag = `<${px}c`
  const valueTag = `<${px}v`
  const rows: string[][] = []
  const rowKinds: string[] = []
  let scanned = 0
  for (let at = findOpen(xml, rowTag, 0); at !== -1 && rows.length < MAX_ROWS;) {
    const rowElement = elementAt(xml, at, rowTag, `</${px}row>`)
    const row: string[] = []
    const kinds: string[] = []
    let next = 0
    const body = rowElement.inner
    for (let cellAt = findOpen(body, cellTag, 0); cellAt !== -1;) {
      const cell = elementAt(body, cellAt, cellTag, `</${px}c>`)
      cellAt = findOpen(body, cellTag, cell.next)
      const reference = attribute(cell.attrs, 'r')
      const index = reference ? columnIndex(reference) : next
      next = index + 1
      if (index < 0 || index >= MAX_COLUMNS) continue
      const type = attribute(cell.attrs, 't')
      const valueAt = findOpen(cell.inner, valueTag, 0)
      const raw = valueAt === -1 ? undefined : elementAt(cell.inner, valueAt, valueTag, `</${px}v>`).inner
      let value = ''
      let kind = 't'
      if (type === 'inlineStr') value = textOf(cell.inner, px)
      else if (raw === undefined) value = ''
      else if (type === 's') value = shared[Number(raw)] ?? ''
      else if (type === 'b') value = raw.trim() === '1' ? 'TRUE' : 'FALSE'
      else if (type === 'e') value = ''
      else if (type === 'str') value = decode(raw).trim()
      else { value = decode(raw).trim(); kind = 'n' }
      while (row.length < index) { row.push(''); kinds.push('t') }
      row[index] = value
      kinds[index] = kind
    }
    if (row.some((value) => value.trim() !== '')) { rows.push(row); rowKinds.push(kinds.join('')) }
    at = findOpen(xml, rowTag, rowElement.next)
    scanned += 1
    if (scanned % YIELD_EVERY_ROWS === 0) await yieldToUi()
  }
  return { rows, rowKinds }
}

const resolveTarget = (target: string): string => {
  const parts = (target.startsWith('/') ? target.slice(1) : `xl/${target}`).split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '..') out.pop()
    else if (part !== '.' && part !== '') out.push(part)
  }
  return out.join('/')
}

/** Read every sheet of an .xlsx. Throws XlsxError when the bytes are not a readable or reasonably sized workbook. */
export const readXlsx = async (data: ArrayBuffer | Uint8Array): Promise<Workbook> => {
  const { unzipSync, strFromU8 } = await import('fflate')
  let files: Record<string, Uint8Array>
  let total = 0
  try {
    files = unzipSync(data instanceof Uint8Array ? data : new Uint8Array(data), {
      filter: (file) => {
        if (!/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/i.test(file.name)) return false
        total += file.originalSize
        if (file.originalSize > MAX_PART_BYTES || total > MAX_TOTAL_BYTES) throw new XlsxError('That workbook is too large to read here. Export a shorter date range.')
        return true
      },
    })
  } catch (error) {
    if (error instanceof XlsxError) throw error
    throw new XlsxError('That file is not a readable Excel workbook.')
  }
  const part = (name: string): string | undefined => {
    const key = Object.keys(files).find((candidate) => candidate.toLowerCase() === name.toLowerCase())
    return key ? strFromU8(files[key]) : undefined
  }
  const workbookXml = part('xl/workbook.xml')
  if (workbookXml === undefined) throw new XlsxError('That file is not an Excel workbook.')
  const date1904 = /<(?:\w+:)?workbookPr\b[^>]*\bdate1904\s*=\s*"(?:1|true)"/i.test(workbookXml)

  const targets = new Map<string, string>()
  for (const match of (part('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attribute(match[0], 'Id')
    const target = attribute(match[0], 'Target')
    if (id && target) targets.set(id, resolveTarget(target))
  }
  const declared = [...workbookXml.matchAll(/<(?:\w+:)?sheet\b[^>]*>/g)].map((match, position) => {
    const relationship = /\s\w+:id\s*=\s*"([^"]*)"/.exec(match[0])?.[1]
    const state = attribute(match[0], 'state')
    return { name: attribute(match[0], 'name') ?? `Sheet${position + 1}`, path: (relationship && targets.get(relationship)) || `xl/worksheets/sheet${position + 1}.xml`, hidden: state === 'hidden' || state === 'veryHidden' }
  })
  if (declared.length === 0) throw new XlsxError('That workbook has no sheets.')
  const shared = parseSharedStrings(part('xl/sharedStrings.xml') ?? '')
  const sheets: Sheet[] = []
  for (const { name, path, hidden } of declared) {
    const xml = part(path)
    if (xml === undefined) continue
    if (hidden) { sheets.push({ name, rows: [], hidden: true }); continue }
    const { rows, rowKinds } = await parseSheet(xml, shared)
    sheets.push({ name, rows, rowKinds })
    await yieldToUi()
  }
  return { sheets, date1904 }
}
