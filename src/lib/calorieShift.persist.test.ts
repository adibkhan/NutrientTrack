// The calorie shift lives in goals.calorieShift, an optional field: older builds carry it through edits, backups and sync.
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '../types'
import { isValidSyncRecord, validateBackup } from './backup'
import { clearAllData, closeDatabase, exportBackup, getSettings, importBackup, saveSettings } from './db'

const stamp = '2026-10-01T00:00:00.000Z'
const SHIFT = [210, -90, -90, -80, -80, -80, 210]
const withShift = { id: 'profile', goals: { weightUnit: 'lb', calories: 2100, calorieShift: SHIFT }, updatedAt: stamp } as Settings

beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()) })
afterEach(async () => { await closeDatabase(); vi.unstubAllGlobals() })

describe('goals.calorieShift survives', () => {
  it('an_edit_by_an_older_build_that_never_heard_of_the_field', async () => {
    await saveSettings(withShift)
    // The older build loaded the record before the shift existed, then saved a goal edit and a preference.
    const olderSnapshot = { id: 'profile', goals: { weightUnit: 'lb', calories: 2100 }, updatedAt: stamp } as Settings
    await saveSettings({ ...olderSnapshot, goals: { ...olderSnapshot.goals, protein: 150 }, preferences: { theme: 'dark' }, updatedAt: '2026-10-02T00:00:00.000Z' }, olderSnapshot)
    expect((await getSettings())?.goals).toEqual({ weightUnit: 'lb', calories: 2100, protein: 150, calorieShift: SHIFT })
  })

  it('a_backup_round_trip_and_the_sync_validator', async () => {
    await saveSettings(withShift)
    const backup = await exportBackup()
    expect(validateBackup(backup)).toBe(true)
    await clearAllData()
    await importBackup(JSON.parse(JSON.stringify(backup)))
    expect((await getSettings())?.goals.calorieShift).toEqual(SHIFT)
    expect(isValidSyncRecord('settings', withShift, 'profile')).toBe(true)
  })
})
