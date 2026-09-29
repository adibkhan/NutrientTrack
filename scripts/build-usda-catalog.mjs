#!/usr/bin/env node

/**
 * Build the bundled food catalog from the USDA FoodData Central SR Legacy
 * CSV archive. The archive is public-domain (CC0) data.
 *
 * Source: https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip
 * Source archive release: 2018-04 (retrieved by the generator when run).
 *
 * Usage:
 *   node scripts/build-usda-catalog.mjs
 *   node scripts/build-usda-catalog.mjs --zip C:\\Temp\\sr-legacy.zip
 *   node scripts/build-usda-catalog.mjs --zip source.zip --output public/data/usda-common-v1.json
 *
 * The default download is written to the operating system temporary directory.
 * No source archive is written into the repository.
 */

import { createWriteStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { inflateRawSync } from 'node:zlib'

const SOURCE_URL = 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip'
const DEFAULT_OUTPUT = resolve('public/data/usda-common-v1.json')
const SOURCE_LABEL = 'USDA SR Legacy'
const REQUIRED_NUTRIENTS = {
  calories: ['1008', '2047', '2048'],
  protein: ['1003'],
  carbs: ['1005'],
  fat: ['1004'],
}

const parseArgs = (args) => {
  let zipPath
  let outputPath = DEFAULT_OUTPUT
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--zip') {
      zipPath = args[++index]
    } else if (arg === '--output') {
      outputPath = resolve(args[++index])
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/build-usda-catalog.mjs [--zip path] [--output path]')
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return { zipPath, outputPath }
}

const downloadToTemporaryFile = async () => {
  const temporaryDirectory = await fs.mkdtemp(join(tmpdir(), 'nutrienttrack-usda-'))
  const temporaryPath = join(temporaryDirectory, 'source.zip')
  try {
    await downloadFile(SOURCE_URL, temporaryPath)
    return { temporaryDirectory, temporaryPath }
  } catch (error) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true })
    throw error
  }
}

const downloadFile = async (url, destination, redirectCount = 0) => {
  if (redirectCount > 5) throw new Error('Too many redirects while downloading the USDA archive.')
  const response = await fetch(url, { redirect: 'manual' })
  if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
    const nextUrl = new URL(response.headers.get('location'), url).href
    return downloadFile(nextUrl, destination, redirectCount + 1)
  }
  if (!response.ok || !response.body) {
    throw new Error(`Could not download USDA archive (${response.status} ${response.statusText}).`)
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination))
}

const readUInt16 = (buffer, offset) => buffer.readUInt16LE(offset)
const readUInt32 = (buffer, offset) => buffer.readUInt32LE(offset)

/**
 * Read the small subset of ZIP needed by this archive. Node provides zlib but
 * no stable built-in ZIP reader, so this avoids adding a runtime dependency.
 */
const readZipEntries = async (zipPath) => {
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

const parseCsv = (text) => {
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

const rowsAsObjects = (text) => {
  const rows = parseCsv(text)
  if (rows.length === 0) return []
  const headers = rows[0]
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])))
}

const textFromEntry = (entries, fileName) => {
  const entryName = [...entries.keys()].find((name) => name.endsWith(`/${fileName}`) || name === fileName)
  if (!entryName) throw new Error(`USDA archive is missing ${fileName}.`)
  return new TextDecoder().decode(entries.get(entryName))
}

const finiteNonnegative = (value) => Number.isFinite(value) && value >= 0

const chooseCalories = (values) => {
  for (const nutrientId of REQUIRED_NUTRIENTS.calories) {
    const value = Number(values.get(nutrientId))
    if (finiteNonnegative(value)) return value
  }
  return undefined
}

const buildCatalog = async (zipPath) => {
  const entries = await readZipEntries(zipPath)
  const foodRows = rowsAsObjects(textFromEntry(entries, 'food.csv'))
  const categoryRows = rowsAsObjects(textFromEntry(entries, 'food_category.csv'))
  const nutrientRows = rowsAsObjects(textFromEntry(entries, 'food_nutrient.csv'))
  const categories = new Map(categoryRows.map((row) => [row.id, row.description.trim()]))
  const nutrientValues = new Map()

  for (const row of nutrientRows) {
    const nutrientId = row.nutrient_id
    if (!Object.values(REQUIRED_NUTRIENTS).some((ids) => ids.includes(nutrientId))) continue
    const value = Number(row.amount)
    if (!finiteNonnegative(value)) continue
    if (!nutrientValues.has(row.fdc_id)) nutrientValues.set(row.fdc_id, new Map())
    const values = nutrientValues.get(row.fdc_id)
    // Keep the first valid row for a nutrient to preserve source row order.
    // SR Legacy normally has one row per food/nutrient pair.
    if (!values.has(nutrientId)) values.set(nutrientId, value)
  }

  const catalog = []
  for (const row of foodRows) {
    const values = nutrientValues.get(row.fdc_id)
    if (!values) continue
    const calories = chooseCalories(values)
    const protein = Number(values.get(REQUIRED_NUTRIENTS.protein[0]))
    const carbs = Number(values.get(REQUIRED_NUTRIENTS.carbs[0]))
    const fat = Number(values.get(REQUIRED_NUTRIENTS.fat[0]))
    if (![calories, protein, carbs, fat].every(finiteNonnegative)) continue

    const fdcId = Number(row.fdc_id)
    const name = row.description.trim()
    const category = categories.get(row.food_category_id)
    if (!Number.isInteger(fdcId) || fdcId <= 0 || !name || !category) continue
    catalog.push({
      id: `usda-sr-${fdcId}`,
      fdcId,
      name,
      category,
      source: SOURCE_LABEL,
      per100g: { calories, protein, carbs, fat },
    })
  }

  catalog.sort((left, right) => {
    const byName = left.name.localeCompare(right.name, 'en', { sensitivity: 'base' })
    return byName || left.fdcId - right.fdcId
  })
  return catalog
}

const main = async () => {
  const { zipPath: providedZipPath, outputPath } = parseArgs(process.argv.slice(2))
  let downloaded
  try {
    const zipPath = providedZipPath ? resolve(providedZipPath) : (downloaded = await downloadToTemporaryFile()).temporaryPath
    const catalog = await buildCatalog(zipPath)
    if (catalog.length === 0) throw new Error('The USDA archive produced an empty catalog.')
    await fs.mkdir(dirname(outputPath), { recursive: true })
    await fs.writeFile(outputPath, `${JSON.stringify(catalog)}\n`, 'utf8')
    const bytes = (await fs.stat(outputPath)).size
    console.log(`Wrote ${catalog.length} foods (${bytes} bytes) to ${outputPath}`)
  } finally {
    if (downloaded) await fs.rm(downloaded.temporaryDirectory, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
