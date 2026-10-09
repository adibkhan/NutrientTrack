// Editing an entry that carries both servings and grams (and no catalog link): grams follow the servings and survive hand edits.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry } from './types'
import { todayISO } from './lib/utils'

vi.mock('./lib/db', () => ({
  getWaterLogs: vi.fn(() => Promise.resolve([])), getMeasurements: vi.fn(() => Promise.resolve([])), saveWaterLog: vi.fn(), deleteWaterLog: vi.fn(), saveMeasurement: vi.fn(), deleteMeasurement: vi.fn(),
  deleteEntry: vi.fn(), deleteFood: vi.fn(), deleteWeight: vi.fn(), exportBackup: vi.fn(), clearAllData: vi.fn(),
  getEntries: vi.fn(), getFoods: vi.fn(), getSettings: vi.fn(), getWeights: vi.fn(), importBackup: vi.fn(),
  requestPersistentStorage: vi.fn(), onDatabaseEvent: vi.fn(() => () => undefined), onLocalChange: vi.fn(() => () => undefined),
  saveEntries: vi.fn(), saveEntry: vi.fn(), saveFood: vi.fn(), saveSettings: vi.fn(), saveWeight: vi.fn(),
}))

import * as db from './lib/db'
import App from './App'

const m = vi.mocked(db)
const stamp = '2026-01-01T00:00:00.000Z'
const first = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]
const field = (id: string) => document.getElementById(id) as HTMLInputElement

// 2 servings weighing 200 g, 600 kcal, no catalog link.
const entry = (over: Record<string, unknown> = {}): DiaryEntry =>
  ({ id: 'e-1', date: todayISO(), meal: 'lunch', name: 'Stew', calories: 600, protein: 30, carbs: 60, fat: 20, servings: 2, grams: 200, futureField: { keep: 'me' }, createdAt: stamp, updatedAt: stamp, ...over }) as DiaryEntry

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  m.getEntries.mockResolvedValue([entry()])
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(undefined)
  m.saveEntry.mockResolvedValue(undefined)
  m.onDatabaseEvent.mockImplementation(() => () => undefined)
  m.onLocalChange.mockImplementation(() => () => undefined)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

async function openEdit() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
  await user.click(first('Edit Stew'))
  await screen.findByLabelText('Servings')
  return user
}
const saved = () => {
  expect(m.saveEntry).toHaveBeenCalledTimes(1)
  return m.saveEntry.mock.calls[0][0] as DiaryEntry & Record<string, unknown>
}

describe('editing an entry with servings and grams', () => {
  it('scales_grams_with_the_servings_and_keeps_unknown_fields', async () => {
    const user = await openEdit()
    fireEvent.change(field('entry-servings'), { target: { value: '3' } })
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(saved()).toMatchObject({ servings: 3, grams: 300, calories: 900, futureField: { keep: 'me' } })
  })

  it('keeps_grams_unchanged_when_saved_without_touching_anything', async () => {
    const user = await openEdit()
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(saved()).toMatchObject({ servings: 2, grams: 200, calories: 600 })
  })

  it('keeps_grams_when_calories_are_typed_by_hand_on_an_entry_with_servings', async () => {
    const user = await openEdit()
    fireEvent.change(field('entry-calories'), { target: { value: '650' } })
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(saved()).toMatchObject({ servings: 2, grams: 200, calories: 650 })
  })
})

describe('editing an entry with grams but no servings', () => {
  it('drops_grams_when_calories_are_typed_by_hand', async () => {
    const { servings: _unused, ...noServings } = entry()
    void _unused
    m.getEntries.mockResolvedValue([noServings as DiaryEntry])
    const user = userEvent.setup()
    render(<App />)
    await screen.findAllByRole('button', { name: 'Log food' })
    await user.click(first('Edit Stew'))
    await screen.findByLabelText('Food or meal name')
    fireEvent.change(field('entry-calories'), { target: { value: '650' } })
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    const result = saved()
    expect(result.calories).toBe(650)
    expect(result).not.toHaveProperty('grams')
  })
})
