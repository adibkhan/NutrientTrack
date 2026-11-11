// Review fixes for micronutrients: no lazy chunks, logging never waits on the table, late data is backfilled safely, honest edits.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import catalogText from '../public/data/usda-common-v2.json?raw'
import tableText from '../public/data/usda-nutrients-v1.json?raw'
import appSource from './App.tsx?raw'
import sectionSource from './components/NutrientsSection.tsx?raw'
import dayNutrientsSource from './components/DayNutrients.tsx?raw'
import cardSource from './components/NutrientsCard.tsx?raw'
import { resetCatalogNutrients } from './catalog/nutrients'
import type { DiaryEntry, Settings } from './types'
import { shiftDate, todayISO } from './lib/utils'

vi.mock('./lib/db', () => ({
  getWaterLogs: vi.fn(() => Promise.resolve([])), getSymptoms: vi.fn(() => Promise.resolve([])), saveSymptom: vi.fn(), deleteSymptom: vi.fn(), getMeasurements: vi.fn(() => Promise.resolve([])), saveWaterLog: vi.fn(), deleteWaterLog: vi.fn(), saveMeasurement: vi.fn(), deleteMeasurement: vi.fn(),
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
const welcomed: Settings = { id: 'profile', goals: { weightUnit: 'lb' }, preferences: { welcomed: true }, updatedAt: stamp }
const entry = (over: Record<string, unknown> = {}): DiaryEntry =>
  ({ id: 'e1', name: 'Porridge', meal: 'breakfast', date: todayISO(), calories: 300, protein: 10, carbs: 40, fat: 5, createdAt: stamp, updatedAt: stamp, ...over }) as DiaryEntry
const respond = (body: string) => new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } })

/** The nutrient table never answers; `release` answers it later. */
let release: () => void = () => undefined
const stubTable = (mode: 'never' | 'manual') => {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (String(url).includes('usda-nutrients')) {
      if (mode === 'never') return new Promise<Response>(() => undefined)
      return new Promise<Response>((resolve) => { release = () => resolve(respond(tableText)) })
    }
    return Promise.resolve(respond(catalogText))
  }))
}

beforeEach(() => {
  resetCatalogNutrients()
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  localStorage.clear()
  m.getEntries.mockResolvedValue([])
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(welcomed)
  m.saveEntry.mockResolvedValue(undefined)
  m.saveEntries.mockResolvedValue(undefined)
  m.saveFood.mockResolvedValue(undefined)
  m.onDatabaseEvent.mockImplementation(() => () => undefined)
  m.onLocalChange.mockImplementation(() => () => undefined)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

async function renderApp() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
  return user
}
async function chooseBanana(user: ReturnType<typeof userEvent.setup>) {
  await user.click(first('Log food'))
  const dialog = await screen.findByRole('dialog')
  await user.type(within(dialog).getByPlaceholderText(/Search foods/), 'bananas, raw')
  const results = await within(dialog).findByLabelText('Catalog results')
  await user.click(within(results).getAllByRole('button').find((button) => /^Bananas, raw/.test(button.textContent ?? '')) as HTMLElement)
  await within(dialog).findByLabelText('Amount')
  return dialog
}
const saved = (call = 0) => m.saveEntry.mock.calls[call][0] as DiaryEntry & Record<string, unknown>

describe('item 1: nothing is lazy, so nothing can white-screen offline', () => {
  it.each([['App.tsx', appSource], ['NutrientsSection.tsx', sectionSource], ['DayNutrients.tsx', dayNutrientsSource], ['NutrientsCard.tsx', cardSource]])('%s has no React.lazy, lazy() or dynamic import()', (_name, source) => {
    expect(source).not.toMatch(/\blazy\s*\(/)
    expect(source).not.toMatch(/\bimport\s*\(/)
    expect(source).not.toMatch(/\bSuspense\b/)
  })
})

describe('item 2: logging never waits for the nutrient table', () => {
  it('saves a catalog food straight away with a table that never answers: submit is enabled, nutrients are absent not zero', async () => {
    stubTable('never')
    const user = await renderApp()
    const dialog = await chooseBanana(user)
    const add = within(dialog).getByRole('button', { name: 'Add to diary' }) as HTMLButtonElement
    expect(add.disabled).toBe(false)
    await user.click(add)
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1), { timeout: 2500 })
    expect(saved()).toMatchObject({ catalogId: 'usda-sr-173944', grams: 118 })
    for (const key of ['potassium', 'fiber', 'vitaminC', 'water', 'omega3']) expect(saved()).not.toHaveProperty(key)
  })

  it('Manual quick add stays usable after going Back from a catalog food whose table is still loading', async () => {
    stubTable('never')
    const user = await renderApp()
    const dialog = await chooseBanana(user)
    await user.click(within(dialog).getByRole('button', { name: /Back to food search/ }))
    await user.click(await screen.findByRole('button', { name: /Manual quick add/ }))
    const manual = await screen.findByRole('dialog')
    await user.type(within(manual).getByLabelText('Food or meal name'), 'Soup')
    await user.type(within(manual).getByLabelText(/^Calories/), '120')
    const add = within(manual).getByRole('button', { name: 'Add to diary' }) as HTMLButtonElement
    expect(add.disabled).toBe(false)
    await user.click(add)
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(saved().calories).toBe(120)
    expect(saved()).not.toHaveProperty('potassium')
  })

  it('quick add of a recent catalog entry saves within the wait budget when the table never answers', async () => {
    stubTable('never')
    m.getEntries.mockResolvedValue([entry({ date: shiftDate(todayISO(), -2), name: 'Bananas, raw', catalogId: 'usda-sr-173944', catalogSource: 'USDA SR Legacy', grams: 118 })])
    const user = await renderApp()
    await user.click(first('Log food'))
    await user.click(await screen.findByRole('button', { name: 'Log Bananas, raw now' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1), { timeout: 2500 })
    expect(saved()).not.toHaveProperty('potassium')
  })

  it('describe-to-log saves within the wait budget when the table never answers', async () => {
    stubTable('never')
    const user = await renderApp()
    await user.click(first('Log food'))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByPlaceholderText(/Search foods/), '2 bananas and an egg')
    const card = await within(dialog).findByRole('region', { name: 'Log as a meal' })
    await user.click(within(card).getByRole('button', { name: /^Add \d+ foods?/ }))
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalledTimes(1), { timeout: 2500 })
    for (const item of m.saveEntries.mock.calls[0][0] as unknown as Array<Record<string, unknown>>) expect(item).not.toHaveProperty('potassium')
  })

  it('a slow table backfills the saved entry through a mustExist save, keeping unknown fields', async () => {
    stubTable('manual')
    const user = await renderApp()
    const dialog = await chooseBanana(user)
    await user.click(within(dialog).getByRole('button', { name: 'Add to diary' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(saved()).not.toHaveProperty('potassium')
    m.getEntries.mockResolvedValue([{ ...saved(), futureField: { a: 1 } } as DiaryEntry])
    release()
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(2))
    expect(m.saveEntry.mock.calls[1][1]).toEqual({ mustExist: true })
    expect(saved(1).potassium).toBeCloseTo(422.4, 0)
    expect(saved(1)).toMatchObject({ id: saved(0).id, catalogId: 'usda-sr-173944', grams: 118, futureField: { a: 1 } })
  })

  it('does not backfill an entry whose grams changed or that already holds a nutrient', async () => {
    stubTable('manual')
    const user = await renderApp()
    const dialog = await chooseBanana(user)
    await user.click(within(dialog).getByRole('button', { name: 'Add to diary' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    m.getEntries.mockResolvedValue([{ ...saved(), grams: 200 } as DiaryEntry])
    release()
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(m.saveEntry).toHaveBeenCalledTimes(1)
  })
})

describe('item 7: an error inside the collapsed group', () => {
  it('opens it, marks and describes the field, focuses it, and names the nutrient in its own case', async () => {
    stubTable('never')
    const user = await renderApp()
    await user.click(first('Log food'))
    await user.click(await screen.findByRole('button', { name: /Manual quick add/ }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Food or meal name'), 'Kale')
    await user.type(within(dialog).getByLabelText(/^Calories/), '50')
    const group = dialog.querySelector('details.nutrient-all') as HTMLDetailsElement
    expect(group.open).toBe(false)
    await user.type(within(dialog).getByLabelText(/^Vitamin K/), '999999999')
    await user.click(within(dialog).getByRole('button', { name: 'Add to diary' }))
    const field = within(dialog).getByLabelText(/^Vitamin K/) as HTMLInputElement
    await waitFor(() => expect(group.open).toBe(true))
    await waitFor(() => expect(document.activeElement).toBe(field))
    expect(field.getAttribute('aria-invalid')).toBe('true')
    const message = document.getElementById(field.getAttribute('aria-describedby')?.split(' ').pop() ?? '')
    expect(message?.textContent).toMatch(/of Vitamin K for one entry/)
    expect(m.saveEntry).not.toHaveBeenCalled()
  })
})

describe('item 5: scaling by calories never rounds a real value to a stored 0', () => {
  it('keeps a tiny nutrient above zero when calories shrink a lot', async () => {
    stubTable('never')
    m.getEntries.mockResolvedValue([entry({ calories: 1000, zinc: 0.4, lutein: 0.9 })])
    const user = await renderApp()
    await user.click(await screen.findByRole('button', { name: /^Edit Porridge\b/ }))
    const dialog = await screen.findByRole('dialog')
    const calories = within(dialog).getByLabelText(/^Calories/)
    await user.clear(calories)
    await user.type(calories, '1')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(saved().zinc).toBeGreaterThan(0)
    expect(saved().lutein).toBeGreaterThan(0)
  })
})

describe('item 8: honest edits and quick add', () => {
  it('hand-editing calories and a macro drops the catalog link and clears catalog-derived micronutrients, unless the person edited them', async () => {
    stubTable('never')
    m.getEntries.mockResolvedValue([entry({ catalogId: 'usda-sr-173944', catalogSource: 'USDA SR Legacy', grams: 118, potassium: 422, vitaminK: 0.6, vitaminC: 10 })])
    const user = await renderApp()
    await user.click(await screen.findByRole('button', { name: /^Edit Porridge\b/ }))
    const dialog = await screen.findByRole('dialog')
    const calories = within(dialog).getByLabelText(/^Calories/)
    await user.clear(calories)
    await user.type(calories, '90')
    const protein = within(dialog).getByLabelText(/^Protein/)
    await user.clear(protein)
    await user.type(protein, '3')
    const potassium = within(dialog).getByLabelText(/^Potassium/)
    await user.clear(potassium)
    await user.type(potassium, '500')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(saved()).not.toHaveProperty('catalogId')
    expect(saved().potassium).toBe(500)
    expect(saved()).not.toHaveProperty('vitaminK')
    expect(saved()).not.toHaveProperty('vitaminC')
  })

  it('quick add does not refill a nutrient cleared on a source entry that has other micronutrients', async () => {
    stubTable('manual')
    m.getEntries.mockResolvedValue([entry({ date: shiftDate(todayISO(), -2), name: 'Bananas, raw', catalogId: 'usda-sr-173944', catalogSource: 'USDA SR Legacy', grams: 118, potassium: 400 })])
    const user = await renderApp()
    await user.click(first('Log food'))
    release()
    await user.click(await screen.findByRole('button', { name: 'Log Bananas, raw now' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalled())
    expect(saved()).toMatchObject({ potassium: 400 })
    expect(saved()).not.toHaveProperty('vitaminC')
    expect(saved()).not.toHaveProperty('magnesium')
  })
})
