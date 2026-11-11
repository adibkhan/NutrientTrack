// Plate logging and micronutrients together: plate entries carry nutrient snapshots, never wait on the table, and scale stored nutrients by count.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import catalogText from '../public/data/usda-common-v2.json?raw'
import tableText from '../public/data/usda-nutrients-v1.json?raw'
import type { DiaryEntry, Food, Settings } from './types'
import { NUTRIENT_KEYS } from './lib/nutrients'
import { resetCatalogNutrients } from './catalog/nutrients'

vi.mock('./lib/db', () => ({
  getWaterLogs: vi.fn(() => Promise.resolve([])), getSymptoms: vi.fn(() => Promise.resolve([])), saveSymptom: vi.fn(), deleteSymptom: vi.fn(), getMeasurements: vi.fn(() => Promise.resolve([])), saveWaterLog: vi.fn(), deleteWaterLog: vi.fn(), saveMeasurement: vi.fn(), deleteMeasurement: vi.fn(),
  deleteEntry: vi.fn(), deleteEntries: vi.fn(), deleteFood: vi.fn(), deleteWeight: vi.fn(), exportBackup: vi.fn(), clearAllData: vi.fn(),
  getEntries: vi.fn(), getFoods: vi.fn(), getSettings: vi.fn(), getWeights: vi.fn(), importBackup: vi.fn(),
  requestPersistentStorage: vi.fn(), onDatabaseEvent: vi.fn(() => () => undefined), onLocalChange: vi.fn(() => () => undefined),
  saveEntries: vi.fn(), saveEntry: vi.fn(), saveFood: vi.fn(), saveSettings: vi.fn(), saveWeight: vi.fn(),
}))

import * as db from './lib/db'
import App from './App'

const m = vi.mocked(db)
vi.setConfig({ testTimeout: 30000 })
const stamp = '2026-01-01T00:00:00.000Z'
const welcomed: Settings = { id: 'profile', goals: { weightUnit: 'lb' }, preferences: { welcomed: true }, updatedAt: stamp }
const respond = (body: string) => new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } })
let foods: Food[]
let entries: DiaryEntry[]

const stubTable = (mode: 'answer' | 'never') => {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (String(url).includes('usda-nutrients')) return mode === 'never' ? new Promise<Response>(() => undefined) : Promise.resolve(respond(tableText))
    return Promise.resolve(respond(catalogText))
  }))
}

beforeEach(() => {
  resetCatalogNutrients()
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  localStorage.clear()
  foods = []
  entries = []
  m.getEntries.mockImplementation(async () => entries)
  m.getFoods.mockImplementation(async () => foods)
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(welcomed)
  m.saveEntry.mockResolvedValue(undefined)
  m.saveEntries.mockImplementation(async (copies) => { entries = [...entries, ...copies] })
  m.onDatabaseEvent.mockImplementation(() => () => undefined)
  m.onLocalChange.mockImplementation(() => () => undefined)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

async function openLogger() {
  const user = userEvent.setup()
  render(<App />)
  await user.click((await screen.findAllByRole('button', { name: 'Log food' }))[0])
  await screen.findByRole('dialog')
  return user
}
const dialog = () => screen.getByRole('dialog')
async function typeQuery(user: ReturnType<typeof userEvent.setup>, text: string) {
  const box = within(dialog()).getByRole('textbox', { name: 'Search foods' })
  await user.clear(box)
  await user.type(box, text)
}
const bananaPlus = async (user: ReturnType<typeof userEvent.setup>) => {
  await typeQuery(user, 'bananas, raw')
  return within(dialog()).findByRole('button', { name: /^Add Bananas, raw to plate/ })
}
const logButton = (count: number) => screen.findByRole('button', { name: `Log ${count} ${count === 1 ? 'food' : 'foods'}` })
const saved = () => (m.saveEntries.mock.calls[0][0] as (DiaryEntry & Record<string, number | undefined>)[])

describe('plate entries carry micronutrient snapshots', () => {
  it('a catalog banana (118 g) x2 saves 236 g with potassium scaled by the plate count', async () => {
    stubTable('answer')
    const user = await openLogger()
    await user.click(await bananaPlus(user))
    await user.click(await bananaPlus(user))
    await user.click(await logButton(1))
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalled())
    const [banana] = saved()
    expect(banana.grams).toBe(236)
    expect(banana.potassium).toBeCloseTo(844.9, 1)
    expect(banana.catalogId).toBeTruthy()
  })

  it('a table that never answers still saves within the wait budget, nutrient fields absent, macros intact', async () => {
    stubTable('never')
    const user = await openLogger()
    await user.click(await bananaPlus(user))
    const started = Date.now()
    await user.click(await logButton(1))
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalled(), { timeout: 3000 })
    expect(Date.now() - started).toBeLessThan(2500)
    const [banana] = saved()
    expect(banana.calories).toBeGreaterThan(0)
    for (const key of NUTRIENT_KEYS) expect(key in banana).toBe(false)
  })

  it('a saved food with micronutrients x3 scales every stored key, keeps absent keys absent and never rounds a real value to 0', async () => {
    stubTable('answer')
    foods = [{ id: 'f1', name: 'Fortified bar', serving: '1 bar', calories: 200, protein: 10, carbs: 20, fat: 5, potassium: 100.5, iron: 0.0004, fiber: 0, vitaminB12: 1.2, createdAt: stamp, updatedAt: stamp } as Food]
    const user = await openLogger()
    await user.click(await screen.findByRole('tab', { name: /My foods/ }))
    const add = await within(dialog()).findByRole('button', { name: /^Add Fortified bar to plate/ })
    await user.click(add)
    await user.click(await within(dialog()).findByRole('button', { name: /^Add Fortified bar to plate/ }))
    await user.click(await within(dialog()).findByRole('button', { name: /^Add Fortified bar to plate/ }))
    await user.click(await logButton(1))
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalled())
    const [bar] = saved()
    expect(bar.servings).toBe(3)
    expect(bar.calories).toBe(600)
    expect(bar.potassium).toBeCloseTo(301.5, 2)
    expect(bar.vitaminB12).toBeCloseTo(3.6, 2)
    expect(bar.iron).toBeGreaterThan(0)
    expect(bar.fiber).toBe(0)
    expect('calcium' in bar).toBe(false)
  })
})
