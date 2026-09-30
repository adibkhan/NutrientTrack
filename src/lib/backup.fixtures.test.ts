// Fixtures in ./__fixtures__ are frozen (see README.md there). Never edit them; add a new version instead.
import { describe, expect, it } from 'vitest'
import { BACKUP_VERSION, readBackup } from './backup'
import fixtureV1 from './__fixtures__/backup-v1.json'

const fixture = () => structuredClone(fixtureV1) as unknown as Record<string, unknown>

describe('readBackup with the frozen v1 fixture', () => {
  it('accepts the v1 fixture and returns it at the current version', () => {
    const result = readBackup(fixture())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.backup.version).toBe(BACKUP_VERSION)
      expect(result.backup.entries).toHaveLength(3)
      expect(result.backup.weights.map((w) => w.unit)).toEqual(['lb', 'lb', 'kg', 'kg'])
    }
  })

  it('preserves unknown fields on entries and settings', () => {
    const result = readBackup(fixture())
    if (!result.ok) throw new Error('fixture rejected')
    expect((result.backup.entries[2] as unknown as Record<string, unknown>).sodium).toBe(120)
    expect((result.backup.settings[0] as unknown as Record<string, unknown>).theme).toBe('dark')
  })

  it('reports a version 2 backup as newer, not invalid', () => {
    expect(readBackup({ ...fixture(), version: 2 })).toEqual({ ok: false, reason: 'newer' })
  })

  it.each([
    ['zero', 0],
    ['a numeric string', '1'],
    ['a fraction', 1.5],
    ['negative', -1],
    ['NaN', NaN],
    ['missing', undefined],
  ])('reports version %s as invalid', (_name, version) => {
    expect(readBackup({ ...fixture(), version })).toEqual({ ok: false, reason: 'invalid' })
  })

  it.each([null, 'text', 5, []])('reports non-object input %j as invalid', (value) => {
    expect(readBackup(value)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('reports a current-version file with a corrupt record as invalid', () => {
    const broken = fixture()
    ;(broken.entries as Array<Record<string, unknown>>)[0].calories = -1
    expect(readBackup(broken)).toEqual({ ok: false, reason: 'invalid' })
  })
})
