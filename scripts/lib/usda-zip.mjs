// ZIP and CSV readers for the USDA FoodData Central archives, shared by the nutrient builder.
// Copied from build-usda-catalog.mjs (left untouched so the catalog build stays byte-identical).
import { promises as fs } from 'node:fs'
import { inflateRawSync } from 'node:zlib'

const readUInt16 = (buffer, offset) => buffer.readUInt16LE(offset)
const readUInt32 = (buffer, offset) => buffer.readUInt32LE(offset)

/**
 * Read the small subset of ZIP needed by this archive. Node provides zlib but
 * no stable built-in ZIP reader, so this avoids adding a runtime dependency.
 */
export const readZipEntries = async (zipPath) => {
  const archive = await fs.readFile(zipPath)
  const minimumEndOffset = Math.max(0, archive.length - 0xffff - 22)
  let endOffset = -1
  for (let offset = archive.length - 22; offset >= minimumEndOffset; offset -= 1) {
    if (readUInt32(archive, offset) === 0x06054b50) {
      endOffset = offset
      break
    }
  }
  if (endOffset < 0) throw new Error(`Not a supported ZIP archive: ${zipPath}`)

  const entryCount = readUInt16(archive, endOffset + 10)
  const directorySize = readUInt32(archive, endOffset + 12)
  const directoryOffset = readUInt32(archive, endOffset + 16)
  const decoder = new TextDecoder()
  const entries = new Map()
  let offset = directoryOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (readUInt32(archive, offset) !== 0x02014b50) throw new Error('Invalid ZIP central directory entry.')
    const compressionMethod = readUInt16(archive, offset + 10)
    const compressedSize = readUInt32(archive, offset + 20)
    const uncompressedSize = readUInt32(archive, offset + 24)
    const nameLength = readUInt16(archive, offset + 28)
    const extraLength = readUInt16(archive, offset + 30)
    const commentLength = readUInt16(archive, offset + 32)
    const localHeaderOffset = readUInt32(archive, offset + 42)
    const name = decoder.decode(archive.subarray(offset + 46, offset + 46 + nameLength))
    offset += 46 + nameLength + extraLength + commentLength

    if (name.endsWith('/')) continue
    if (readUInt32(archive, localHeaderOffset) !== 0x04034b50) throw new Error(`Invalid ZIP entry: ${name}`)
    const localNameLength = readUInt16(archive, localHeaderOffset + 26)
    const localExtraLength = readUInt16(archive, localHeaderOffset + 28)
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength
    const compressedData = archive.subarray(dataOffset, dataOffset + compressedSize)
    let data
    if (compressionMethod === 0) {
      data = compressedData
    } else if (compressionMethod === 8) {
      data = inflateRawSync(compressedData)
    } else {
      throw new Error(`Unsupported ZIP compression method ${compressionMethod} for ${name}`)
    }
    if (data.length !== uncompressedSize) throw new Error(`ZIP size mismatch for ${name}`)
    entries.set(name, data)
  }

  if (offset > directoryOffset + directorySize) throw new Error('Invalid ZIP central directory size.')
  return entries
}

export const parseCsv = (text) => {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        field += character
      }
    } else if (character === '"' && field.length === 0) {
      inQuotes = true
    } else if (character === ',') {
      row.push(field)
      field = ''
    } else if (character === '\n') {
      row.push(field.endsWith('\r') ? field.slice(0, -1) : field)
      if (row.some((value) => value.length > 0)) rows.push(row)
      row = []
      field = ''
    } else {
      field += character
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.endsWith('\r') ? field.slice(0, -1) : field)
    if (row.some((value) => value.length > 0)) rows.push(row)
  }
  return rows
}

export const rowsAsObjects = (text) => {
  const rows = parseCsv(text)
  if (rows.length === 0) return []
  const headers = rows[0]
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])))
}

export const textFromEntry = (entries, fileName) => {
  const entryName = [...entries.keys()].find((name) => name.endsWith(`/${fileName}`) || name === fileName)
  if (!entryName) throw new Error(`USDA archive is missing ${fileName}.`)
  return new TextDecoder().decode(entries.get(entryName))
}

