// Streaming CSV reader for the multi-gigabyte USDA FoodData Central files: RFC 4180 quoting (including newlines inside quotes),
// no dependencies, one row array per call. Only the first `maxColumns` fields of a row are materialised.
import { createReadStream } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'

/**
 * Parse every complete row of `text` starting at `start`. Calls onRow(fields) per row and returns the offset of the first
 * unparsed character (the start of an incomplete trailing row) so the caller can carry it into the next chunk.
 * With `final` true a missing trailing newline still ends the last row.
 */
export const parseChunk = (text, start, final, maxColumns, onRow) => {
  const length = text.length
  let rowStart = start
  let position = start
  while (position < length) {
    const fields = []
    let rowEnd = -1
    let cursor = position
    for (;;) {
      let value
      let terminator
      if (text.charCodeAt(cursor) === 34) {
        // Quoted field: find the closing quote, treating "" as an escaped quote.
        let scan = cursor + 1
        let hasEscape = false
        let close = -1
        for (;;) {
          const quote = text.indexOf('"', scan)
          if (quote < 0) break
          if (quote + 1 < length && text.charCodeAt(quote + 1) === 34) { hasEscape = true; scan = quote + 2; continue }
          close = quote
          break
        }
        if (close < 0 || (close + 1 >= length && !final)) { rowEnd = -2; break }
        value = text.slice(cursor + 1, close)
        if (hasEscape) value = value.replace(/""/g, '"')
        cursor = close + 1
        terminator = cursor < length ? text.charCodeAt(cursor) : 10
        // Tolerate junk between a closing quote and the separator.
        if (terminator !== 44 && terminator !== 10 && terminator !== 13) {
          let skip = cursor
          while (skip < length && text.charCodeAt(skip) !== 44 && text.charCodeAt(skip) !== 10) skip += 1
          if (skip >= length && !final) { rowEnd = -2; break }
          cursor = skip
          terminator = skip < length ? text.charCodeAt(skip) : 10
        }
      } else {
        let scan = cursor
        let code = 0
        while (scan < length) {
          code = text.charCodeAt(scan)
          if (code === 44 || code === 10) break
          scan += 1
        }
        if (scan >= length && !final) { rowEnd = -2; break }
        value = text.slice(cursor, scan)
        cursor = scan
        terminator = scan < length ? code : 10
        if (terminator === 10 && value.charCodeAt(value.length - 1) === 13) value = value.slice(0, -1)
      }
      if (fields.length < maxColumns) fields.push(value)
      if (terminator === 44) { cursor += 1; continue }
      if (terminator === 13) { cursor += 1; if (text.charCodeAt(cursor) === 10) cursor += 1 } else cursor += 1
      rowEnd = cursor
      break
    }
    if (rowEnd === -2) return rowStart
    // A completely empty line is not a row.
    if (!(fields.length === 1 && fields[0] === '')) onRow(fields)
    position = rowEnd
    rowStart = rowEnd
  }
  return rowStart
}

/** Stream a CSV file: the header row is returned as column names, onRow receives arrays. Resolves with the row count. */
export const streamCsv = async (path, { maxColumns = Infinity, onHeader, onRow }) => {
  const decoder = new StringDecoder('utf8')
  let carry = ''
  let header
  let rows = 0
  const handle = (fields) => {
    if (!header) { header = fields; onHeader?.(fields); return }
    rows += 1
    onRow(fields)
  }
  for await (const chunk of createReadStream(path, { highWaterMark: 4 * 1024 * 1024 })) {
    const text = carry + decoder.write(chunk)
    // The header needs all of its columns whatever maxColumns says; callers pass a maxColumns that covers it or read it with onHeader.
    const used = parseChunk(text, 0, false, header ? maxColumns : Infinity, handle)
    carry = text.slice(used)
  }
  carry += decoder.end()
  if (carry.length > 0) parseChunk(carry, 0, true, header ? maxColumns : Infinity, handle)
  return rows
}
