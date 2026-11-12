// Branded foods and backups. A branded entry is stored so that an OLDER build still restores the whole backup: it keeps catalogId
// 'usda-branded-<gtin>' and has no catalogSource, because builds before branded foods refuse any source outside two values.
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BackupPayload, DiaryEntry } from '../types'
import { BACKUP_VERSION, isValidSyncRecord, readBackup, validateBackup } from './backup'
import { closeDatabase, exportBackup, getEntries, importBackup, saveEntries } from './db'
import { storedCatalogSource } from './brandedUi'
import { plateEntries, type PlateItem } from './plate'

const stamp = '2026-02-03T10:00:00.000Z'
const payload = (entries: unknown[]): Record<string, unknown> => ({
  format: 'nutrienttrack-backup', version: BACKUP_VERSION, exportedAt: stamp, entries, foods: [], weights: [], settings: [], water: [], measurements: [], symptoms: [],
})
const branded = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'b1', date: '2026-02-03', meal: 'snack', name: 'Chobani Vanilla Greek Yogurt', calories: 120, protein: 14, carbs: 15, fat: 0, grams: 150,
  catalogId: 'usda-branded-00012345678905', sodium: 60, sugar: 12, createdAt: stamp, updatedAt: stamp, ...extra,
})

/** The catalogSource rule of src/lib/backup.ts in every build before branded foods (copied from commit fa6e85e). */
const olderBuildAcceptsSource = (value: unknown) => value === undefined || value === 'USDA SR Legacy' || value === 'USDA Foundation'

describe('review L1: millilitre entries', () => {
  it('a unit of ml is accepted, any other unit is not, and an older build (which ignores unknown fields) still restores it', () => {
    expect(validateBackup(payload([branded({ grams: 355, unit: 'ml' })]))).toBe(true)
    expect(validateBackup(payload([branded({ unit: 'oz' })]))).toBe(false)
    expect(validateBackup(payload([branded()]))).toBe(true) // absent means grams
  })

  it('a plate line in ml saves an entry with unit ml', () => {
    const plate: PlateItem[] = [{ key: 'k', name: 'Coca-Cola', qty: 1, unit: { calories: 140, protein: 0, carbs: 39, fat: 0, grams: 355, unit: 'ml', catalogId: 'usda-branded-00049000050103' } }]
    const [entry] = plateEntries(plate, { date: '2026-02-03', meal: 'snack', time: '', planned: false }, stamp, () => 'id1')
    expect(entry).toMatchObject({ grams: 355, unit: 'ml' })
  })
})

describe('backup validation with branded foods', () => {
  it('accepts a branded entry without a source, as this build writes it', () => {
    expect(validateBackup(payload([branded()]))).toBe(true)
    expect(readBackup(payload([branded()])).ok).toBe(true)
  })

  it('a branded entry as written is acceptable to an older build too', () => {
    const entry = branded()
    expect(olderBuildAcceptsSource(entry.catalogSource)).toBe(true)
    expect(typeof entry.catalogId === 'string' && entry.catalogId.trim().length > 0).toBe(true)
  })

  it('accepts "USDA Branded" on read, for records from other devices or later builds, and an older build would refuse it', () => {
    const entry = branded({ catalogSource: 'USDA Branded' })
    expect(validateBackup(payload([entry]))).toBe(true)
    expect(isValidSyncRecord('entries', entry, 'b1')).toBe(true)
    expect(olderBuildAcceptsSource(entry.catalogSource)).toBe(false)
  })

  it('still rejects an unknown source and a blank catalog id', () => {
    expect(validateBackup(payload([branded({ catalogSource: 'Somebody Else' })]))).toBe(false)
    expect(validateBackup(payload([branded({ catalogId: '  ' })]))).toBe(false)
  })

  it('accepts a branded sync record, and keeps unknown fields', () => {
    expect(isValidSyncRecord('entries', branded({ futureField: { a: 1 } }), 'b1')).toBe(true)
  })
})

describe('storedCatalogSource', () => {
  it('drops the branded source and keeps the others', () => {
    expect(storedCatalogSource('USDA Branded')).toBeUndefined()
    expect(storedCatalogSource('USDA SR Legacy')).toBe('USDA SR Legacy')
    expect(storedCatalogSource('USDA Foundation')).toBe('USDA Foundation')
    expect(storedCatalogSource(undefined)).toBeUndefined()
  })

  it('a plate line of a branded food becomes an entry an older build accepts', () => {
    const line: PlateItem = { key: 'k', name: 'Oreo Chocolate Sandwich Cookies', qty: 2, unit: { calories: 160, protein: 1.5, carbs: 24, fat: 7, sodium: 130, grams: 34, catalogId: 'usda-branded-00044000032029' } }
    const [entry] = plateEntries([line], { date: '2026-02-03', meal: 'snack', time: '', planned: false }, stamp, () => 'p1')
    expect(entry).toMatchObject({ catalogId: 'usda-branded-00044000032029', grams: 68, calories: 320, sodium: 260 })
    expect('catalogSource' in entry).toBe(false)
    expect(olderBuildAcceptsSource((entry as DiaryEntry).catalogSource)).toBe(true)
    expect(validateBackup(payload([entry]))).toBe(true)
  })
})

describe('backup round trip with a branded entry', () => {
  beforeEach(() => { globalThis.indexedDB = new IDBFactory() })
  afterEach(() => { closeDatabase() })

  it('saves, exports, restores and exports again unchanged, with an ordinary entry next to it', async () => {
    const plain = { id: 'p1', date: '2026-02-03', meal: 'lunch', name: 'Bananas, raw', calories: 105, protein: 1.3, carbs: 27, fat: 0.4, grams: 118, catalogId: 'usda-sr-1', catalogSource: 'USDA SR Legacy', createdAt: stamp, updatedAt: stamp }
    await saveEntries([branded(), plain] as unknown as DiaryEntry[])
    const exported = await exportBackup()
    expect(validateBackup(exported)).toBe(true)
    const read = readBackup(JSON.parse(JSON.stringify(exported)))
    expect(read.ok).toBe(true)
    if (!read.ok) return
    await importBackup(read.backup as BackupPayload)
    const restored = await getEntries()
    expect(restored.find((entry) => entry.id === 'b1')).toMatchObject({ name: 'Chobani Vanilla Greek Yogurt', catalogId: 'usda-branded-00012345678905', grams: 150, sodium: 60, sugar: 12 })
    expect('catalogSource' in (restored.find((entry) => entry.id === 'b1') as object)).toBe(false)
    const again = await exportBackup()
    const ids = (backup: BackupPayload) => [...backup.entries].sort((a, b) => a.id.localeCompare(b.id))
    expect(ids(again)).toEqual(ids(exported))
  })

  it('restores an entry that carries the new source value too', async () => {
    const read = readBackup(payload([branded({ id: 'b2', catalogSource: 'USDA Branded' })]))
    expect(read.ok).toBe(true)
    if (!read.ok) return
    await importBackup(read.backup as BackupPayload)
    expect((await getEntries()).find((entry) => entry.id === 'b2')?.catalogSource).toBe('USDA Branded')
  })
})
