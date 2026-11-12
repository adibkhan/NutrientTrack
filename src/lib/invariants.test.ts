// Enforces the data invariants in CLAUDE.md that are about files rather than behaviour.
// @vitest-environment node
import { describe, expect, it } from 'vitest'
// @ts-expect-error The app tsconfig has no Node typings; these checks read the packs from disk.
import { createHash } from 'node:crypto'
// @ts-expect-error see above
import { readdirSync, readFileSync } from 'node:fs'
// @ts-expect-error see above
import { gunzipSync } from 'node:zlib'
import brandedSource from '../catalog/branded.ts?raw'
import brandedManifest from '../../public/data/branded-v1/manifest.json?raw'
import catalogSource from '../catalog/index.ts?raw'
import nutrientsSource from '../catalog/nutrients.ts?raw'
import swSource from '../../public/sw.js?raw'
import catalogV1 from '../../public/data/usda-common-v1.json?raw'
import catalogV2 from '../../public/data/usda-common-v2.json?raw'
import nutrientsV1 from '../../public/data/usda-nutrients-v1.json?raw'
import backupV1 from './__fixtures__/backup-v1.json?raw'
import backupV2 from './__fixtures__/backup-v2.json?raw'
import backupV3 from './__fixtures__/backup-v3.json?raw'

/** FNV-1a over the text with line endings normalised, so a Windows checkout hashes the same as CI. */
const fingerprint = (text: string): string => {
  let hash = 0x811c9dc5
  for (const char of text.replace(/\r\n/g, '\n')) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

describe('frozen backup fixtures (invariant 5)', () => {
  // A fixture records a format real users hold. Never edit one: add backup-vN.json and pin it here.
  it.each([['backup-v1.json', backupV1, '441ee9e1'], ['backup-v2.json', backupV2, '294a0a67'], ['backup-v3.json', backupV3, 'a1c11ee1']])('%s is unchanged', (_name, text, pinned) => {
    expect(fingerprint(text)).toBe(pinned)
  })
})

describe('catalog is versioned by file name (invariant 7)', () => {
  const catalogPath = /CATALOG_PATH\s*=\s*'([^']+)'/.exec(catalogSource)?.[1]

  it('the app and the service worker precache the same catalog file', () => {
    expect(catalogPath).toBeDefined()
    expect(swSource).toContain(`'${catalogPath}'`)
  })

  // Browsers and the service worker cache the catalog by URL, so new content needs a new file name.
  it.each([['usda-common-v1.json', catalogV1, '0202e227'], ['usda-common-v2.json', catalogV2, '50586e04']])('%s content matches its name', (name, text, pinned) => {
    expect(catalogPath?.endsWith(name) ? fingerprint(text) : pinned).toBe(pinned)
  })
})

describe('catalog nutrient table is versioned by file name (invariant 7)', () => {
  const nutrientsPath = /NUTRIENTS_PATH\s*=\s*'([^']+)'/.exec(nutrientsSource)?.[1]

  it('the app and the service worker warm the same nutrient file', () => {
    expect(nutrientsPath).toBeDefined()
    expect(swSource).toContain(`'${nutrientsPath}'`)
  })

  // Cached by URL like the catalog: a content change ships as usda-nutrients-v2.json, never an edit of v1.
  it.each([['usda-nutrients-v1.json', nutrientsV1, '80f8518d']])('%s content matches its name', (name, text, pinned) => {
    expect(nutrientsPath?.endsWith(name) ? fingerprint(text) : pinned).toBe(pinned)
  })

  it('covers the same foods as the catalog and no others', () => {
    const catalogIds = new Set((JSON.parse(catalogV2) as Array<{ fdcId: number }>).map((food) => food.fdcId))
    const rows = (JSON.parse(nutrientsV1) as { rows: number[][] }).rows
    expect(rows.length).toBeGreaterThan(7000)
    expect(rows.every((row) => catalogIds.has(row[0]))).toBe(true)
  })
})

describe('branded food packs are versioned by file name and content hash (invariant 7)', () => {
  const dir = new URL('../../public/data/branded-v1/', import.meta.url)
  const manifest = JSON.parse(brandedManifest) as {
    version: number
    products: number
    packs: Array<[string, number]>
    detail: { starts: number[]; places: number[] }
    summaries: { rows: number; places: number[] }
    pop: { places: number[] }
    posts: { first: string[]; places: number[] }
    heads: { first: string[]; places: number[] }
    common: string
    brandTokens: string[]
  }
  const basePath = /BRANDED_BASE\s*=\s*'([^']+)'/.exec(brandedSource)?.[1]
  const read = (name: string): Uint8Array => readFileSync(new URL(name, dir))
  const MAX_PACK = 25_000_000

  it('the app reads the directory these files live in, and the manifest is pinned', () => {
    expect(basePath).toBe('./data/branded-v1/')
    expect(manifest.version).toBe(2)
    // Cached by URL: a content change ships as branded-v2/, never an edit of v1.
    expect(fingerprint(brandedManifest)).toBe('ba465d91')
  })

  it('every pack is named after the SHA-256 of its bytes, and the manifest lists exactly the packs on disk', () => {
    const onDisk = (readdirSync(dir) as string[]).filter((name) => name !== 'manifest.json').sort()
    expect(onDisk).toEqual(manifest.packs.map(([name]) => name).sort())
    manifest.packs.forEach(([name, size], index) => {
      const bytes = read(name)
      expect(name).toBe(`branded-p${String(index).padStart(2, '0')}-${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}.bin`)
      expect(bytes.length).toBe(size)
    })
  })

  it('stays inside the size budget: packs 25 MB each, 80 MB in all, manifest 300 kB', () => {
    const sizes = manifest.packs.map(([, size]) => size)
    for (const size of sizes) expect(size).toBeLessThanOrEqual(MAX_PACK)
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBeLessThanOrEqual(80_000_000)
    expect(brandedManifest.length).toBeLessThanOrEqual(300_000)
  })

  it('shards tile their packs, decode, and agree with the manifest', () => {
    const packs = manifest.packs.map(([name]) => read(name))
    const cursor = packs.map(() => 0)
    const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)
    const check = (places: number[], index: number): Uint8Array => {
      const [pack, offset, length] = [places[index * 3], places[index * 3 + 1], places[index * 3 + 2]]
      expect(offset).toBe(cursor[pack])
      cursor[pack] += length
      const shard = packs[pack].subarray(offset, offset + length)
      expect([shard[0], shard[1]]).toEqual([0x1f, 0x8b])
      return gunzipSync(shard) as Uint8Array
    }
    // detail: GTIN-ordered runs of full records
    let detailRows = 0
    manifest.detail.starts.forEach((start, index) => {
      const rows = JSON.parse(text(check(manifest.detail.places, index))) as number[][]
      expect(rows[0][0]).toBe(start)
      detailRows += rows.length
    })
    expect(detailRows).toBe(manifest.products)
    expect(manifest.detail.starts).toEqual([...manifest.detail.starts].sort((a, b) => a - b))
    // summaries: fixed blocks of rows, one line per product, stored once
    const blocks = Math.ceil(manifest.products / manifest.summaries.rows)
    expect(manifest.summaries.places.length).toBe(blocks * 3)
    let summaryRows = 0
    for (let block = 0; block < blocks; block += 1) summaryRows += text(check(manifest.summaries.places, block)).split('\n').length
    expect(summaryRows).toBe(manifest.products)
    // popularity: one level byte (0..7) per product, in ordinal order
    const pop = check(manifest.pop.places, 0)
    expect(pop.length).toBe(manifest.products)
    expect(pop.reduce((high, level) => Math.max(high, level), 0)).toBeLessThanOrEqual(7)
    // postings: consecutive ranges of the sorted token list, every token of every product
    manifest.posts.first.forEach((first, index) => {
      const bytes = check(manifest.posts.places, index)
      expect(bytes.length).toBeGreaterThan(0)
      expect(first.length).toBeGreaterThan(0)
    })
    expect(manifest.posts.first).toEqual([...manifest.posts.first].sort())
    // heads: the best products of common words and word pairs
    manifest.heads.first.forEach((first, index) => {
      const body = text(check(manifest.heads.places, index))
      expect(body.startsWith(`#${first}\n`)).toBe(true)
    })
    expect(manifest.heads.first).toEqual([...manifest.heads.first].sort())
    expect(cursor).toEqual(manifest.packs.map(([, size]) => size))
    expect(manifest.brandTokens.length).toBeLessThanOrEqual(5000)
  })

  it('the service worker does not precache the packs', () => {
    // The worker names the folder to leave Range requests and the manifest alone, but never lists a pack or the folder in what it installs.
    const appShell = swSource.slice(swSource.indexOf('const APP_SHELL'), swSource.indexOf(']', swSource.indexOf('const APP_SHELL')))
    expect(appShell).not.toContain('branded')
    expect(swSource).not.toMatch(/branded-p\d\d/)
    expect(swSource).not.toMatch(/\.bin['"`]\s*[,\]]/)
  })
})
