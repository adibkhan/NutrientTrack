// Servings stepper on the entry form: saved foods and recent entries scale by servings, catalog grams scale nutrients.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogFood } from './catalog/types'
import type { DiaryEntry, Food } from './types'
import { todayISO } from './lib/utils'

vi.mock('./lib/db', () => ({
  getWaterLogs: vi.fn(() => Promise.resolve([])), getMeasurements: vi.fn(() => Promise.resolve([])), saveWaterLog: vi.fn(), deleteWaterLog: vi.fn(), saveMeasurement: vi.fn(), deleteMeasurement: vi.fn(),
  deleteEntry: vi.fn(), deleteFood: vi.fn(), deleteWeight: vi.fn(), exportBackup: vi.fn(), clearAllData: vi.fn(),
  getEntries: vi.fn(), getFoods: vi.fn(), getSettings: vi.fn(), getWeights: vi.fn(), importBackup: vi.fn(),
  requestPersistentStorage: vi.fn(), onDatabaseEvent: vi.fn(() => () => undefined), onLocalChange: vi.fn(() => () => undefined),
  saveEntries: vi.fn(), saveEntry: vi.fn(), saveFood: vi.fn(), saveSettings: vi.fn(), saveWeight: vi.fn(),
}))

const oats: CatalogFood = {
  id: 'usda-oats', fdcId: 1, name: 'Rolled oats', category: 'Grains', source: 'USDA SR Legacy',
  per100g: { calories: 200, protein: 10, carbs: 20, fat: 5 },
}
vi.mock('./catalog', () => ({
  searchCatalog: vi.fn(async () => [oats]),
  findCatalogFood: vi.fn(async () => oats),
}))

import * as db from './lib/db'
import App from './App'

const m = vi.mocked(db)
const stamp = '2026-01-01T00:00:00.000Z'
const first = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]

const food = (over: Record<string, unknown> = {}): Food =>
  ({ id: 'f-yogurt', name: 'Yogurt', serving: '1 cup', calories: 200, protein: 10, carbs: 20, fat: 6, fiber: 3, createdAt: stamp, updatedAt: stamp, ...over }) as Food
const entry = (over: Record<string, unknown> = {}): DiaryEntry =>
  ({ id: 'e-1', date: todayISO(), meal: 'lunch', name: 'Stew', calories: 600, protein: 30, carbs: 60, fat: 20, createdAt: stamp, updatedAt: stamp, ...over }) as DiaryEntry

let foods: Food[]
let entries: DiaryEntry[]

beforeEach(() => {
  foods = []
  entries = []
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  m.getEntries.mockImplementation(async () => entries.map((item) => ({ ...item })))
  m.getFoods.mockImplementation(async () => foods.map((item) => ({ ...item })))
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(undefined)
  m.saveEntry.mockResolvedValue(undefined)
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

type User = ReturnType<typeof userEvent.setup>

async function renderApp() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
  return user
}
const saved = (): DiaryEntry & Record<string, unknown> => {
  expect(m.saveEntry).toHaveBeenCalledTimes(1)
  return m.saveEntry.mock.calls[0][0] as DiaryEntry & Record<string, unknown>
}
const field = (id: string) => document.getElementById(id) as HTMLInputElement
const setServings = (value: string) => fireEvent.change(field('entry-servings'), { target: { value } })

/** Foods view > Log on the only saved food. */
async function logFromFoods(user: User) {
  await user.click(first('Foods'))
  await user.click(await screen.findByRole('button', { name: 'Log' }))
  await screen.findByLabelText('Servings')
}
/** Log food > pick a result by name from the logger's lists. */
async function pickInLogger(user: User, name: RegExp) {
  await user.click(first('Log food'))
  const dialog = await screen.findByRole('dialog')
  // Recent entries are on the default tab; saved foods sit under "My foods".
  if (!within(dialog).queryByRole('button', { name })) await user.click(within(dialog).getByRole('tab', { name: /My foods/ }))
  await user.click(await within(dialog).findByRole('button', { name }))
}

describe('servings on a saved food', () => {
  beforeEach(() => { foods = [food()] })

  it('shows a Servings stepper at 1 with the stored values', async () => {
    const user = await renderApp()
    await logFromFoods(user)
    expect(field('entry-servings').value).toBe('1')
    expect(field('entry-calories').value).toBe('200')
    expect(field('entry-fiber').value).toBe('3')
  })

  it('doubles macros and recorded nutrients at 2 servings and saves servings: 2', async () => {
    const user = await renderApp()
    await logFromFoods(user)
    setServings('2')
    expect(field('entry-calories').value).toBe('400')
    expect(field('entry-protein').value).toBe('20')
    expect(field('entry-carbs').value).toBe('40')
    expect(field('entry-fat').value).toBe('12')
    expect(field('entry-fiber').value).toBe('6')
    await user.click(screen.getByRole('button', { name: 'Add to diary' }))
    expect(saved()).toMatchObject({ servings: 2, calories: 400, protein: 20, carbs: 40, fat: 12, fiber: 6, foodId: 'f-yogurt' })
  })

  it('does not invent a nutrient the food never recorded', async () => {
    foods = [food({ fiber: undefined })]
    const user = await renderApp()
    await logFromFoods(user)
    setServings('2')
    expect(field('entry-fiber').value).toBe('')
    await user.click(screen.getByRole('button', { name: 'Add to diary' }))
    expect(saved()).not.toHaveProperty('fiber')
  })

  it('writes no servings key for exactly one serving', async () => {
    const user = await renderApp()
    await logFromFoods(user)
    await user.click(screen.getByRole('button', { name: 'Add to diary' }))
    expect(saved()).not.toHaveProperty('servings')
    expect(saved().calories).toBe(200)
  })

  it('writes servings 0.5 with halved values', async () => {
    const user = await renderApp()
    await logFromFoods(user)
    setServings('0.5')
    await user.click(screen.getByRole('button', { name: 'Add to diary' }))
    expect(saved()).toMatchObject({ servings: 0.5, calories: 100, protein: 5, carbs: 10, fat: 3, fiber: 1.5 })
  })

  it('steps with the half-serving buttons and rescales', async () => {
    const user = await renderApp()
    await logFromFoods(user)
    await user.click(screen.getByRole('button', { name: 'Half a serving more' }))
    expect(field('entry-servings').value).toBe('1.5')
    expect(field('entry-calories').value).toBe('300')
  })

  it('refuses zero servings with a message and does not save', async () => {
    const user = await renderApp()
    await logFromFoods(user)
    setServings('0')
    await user.click(screen.getByRole('button', { name: 'Add to diary' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Servings must be more than zero\./)
    expect(m.saveEntry).not.toHaveBeenCalled()
  })

  it('refuses an emptied servings box with a message and does not save', async () => {
    const user = await renderApp()
    await logFromFoods(user)
    await user.clear(field('entry-servings'))
    await user.click(screen.getByRole('button', { name: 'Add to diary' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Servings must be more than zero\./)
    expect(m.saveEntry).not.toHaveBeenCalled()
  })

  it('shows the stepper at 1 when a saved food is picked in the logger', async () => {
    const user = await renderApp()
    await pickInLogger(user, /^Yogurt/)
    expect(field('entry-servings').value).toBe('1')
    setServings('2')
    await user.click(screen.getByRole('button', { name: 'Add to diary' }))
    expect(saved()).toMatchObject({ servings: 2, calories: 400, fiber: 6 })
  })

  it('quick-add logs one serving with no servings key', async () => {
    const user = await renderApp()
    await user.click(first('Log food'))
    await user.click(await screen.findByRole('tab', { name: /My foods/ }))
    await user.click(await screen.findByRole('button', { name: 'Quick add Yogurt' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(saved()).not.toHaveProperty('servings')
    expect(saved()).toMatchObject({ calories: 200, fiber: 3 })
  })
})

describe('servings on a recent entry', () => {
  it('reopens at the stored servings with the stored macros', async () => {
    entries = [entry({ servings: 2 })]
    const user = await renderApp()
    await pickInLogger(user, /^Stew/)
    expect(field('entry-servings').value).toBe('2')
    expect(field('entry-calories').value).toBe('600')
  })

  it('steps to 3 servings as 1.5 times the stored values', async () => {
    entries = [entry({ servings: 2, fiber: 4 })]
    const user = await renderApp()
    await pickInLogger(user, /^Stew/)
    setServings('3')
    expect(field('entry-calories').value).toBe('900')
    expect(field('entry-protein').value).toBe('45')
    expect(field('entry-fiber').value).toBe('6')
    await user.click(screen.getByRole('button', { name: 'Add to diary' }))
    expect(saved()).toMatchObject({ servings: 3, calories: 900, fiber: 6 })
  })

  it('treats a recent entry without servings as one serving', async () => {
    entries = [entry()]
    const user = await renderApp()
    await pickInLogger(user, /^Stew/)
    expect(field('entry-servings').value).toBe('1')
    await user.click(screen.getByRole('button', { name: 'Add to diary' }))
    expect(saved()).not.toHaveProperty('servings')
    expect(saved().calories).toBe(600)
  })
})

describe('editing an existing entry', () => {
  it('shows the stepper at the stored servings', async () => {
    entries = [entry({ servings: 2 })]
    const user = await renderApp()
    await user.click(first('Edit Stew'))
    expect(((await screen.findByLabelText('Servings')) as HTMLInputElement).value).toBe('2')
    expect(field('entry-calories').value).toBe('600')
  })

  it('removes the servings key when changed to 1 while unknown fields survive', async () => {
    entries = [entry({ servings: 2, futureField: { keep: 'me' } })]
    const user = await renderApp()
    await user.click(first('Edit Stew'))
    await screen.findByLabelText('Servings')
    setServings('1')
    expect(field('entry-calories').value).toBe('300')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    const result = saved()
    expect(result).not.toHaveProperty('servings')
    expect(result.futureField).toEqual({ keep: 'me' })
    expect(result).toMatchObject({ id: 'e-1', calories: 300, createdAt: stamp })
  })

  it('keeps servings and unknown fields when saved unchanged', async () => {
    entries = [entry({ servings: 2, futureField: 'x' })]
    const user = await renderApp()
    await user.click(first('Edit Stew'))
    await screen.findByLabelText('Servings')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(saved()).toMatchObject({ servings: 2, calories: 600, futureField: 'x' })
  })

  it('shows no stepper for an entry without servings and keeps macros as typed', async () => {
    entries = [entry({ futureField: 'x' })]
    const user = await renderApp()
    await user.click(first('Edit Stew'))
    await screen.findByLabelText('Food or meal name')
    expect(screen.queryByLabelText('Servings')).toBeNull()
    fireEvent.change(field('entry-calories'), { target: { value: '650' } })
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    const result = saved()
    expect(result).not.toHaveProperty('servings')
    expect(result).toMatchObject({ calories: 650, protein: 30, futureField: 'x' })
  })
})

describe('modes without a stepper', () => {
  it('manual quick-add has no stepper and never writes servings', async () => {
    const user = await renderApp()
    await user.click(first('Log food'))
    await user.click(await screen.findByRole('button', { name: /Manual quick add/ }))
    expect(screen.queryByLabelText('Servings')).toBeNull()
    await user.type(screen.getByLabelText('Food or meal name'), 'Toast')
    await user.type(field('entry-calories'), '120')
    await user.click(screen.getByRole('button', { name: 'Add to diary' }))
    expect(saved()).not.toHaveProperty('servings')
  })

  it('manual mode after a saved food drops the stepper and servings', async () => {
    foods = [food()]
    const user = await renderApp()
    await pickInLogger(user, /^Yogurt/)
    setServings('2')
    await user.click(screen.getByRole('button', { name: /Back to food search/ }))
    await user.click(await screen.findByRole('button', { name: /Manual quick add/ }))
    expect(screen.queryByLabelText('Servings')).toBeNull()
    await user.type(screen.getByLabelText('Food or meal name'), 'Toast')
    await user.type(field('entry-calories'), '120')
    await user.click(screen.getByRole('button', { name: 'Add to diary' }))
    expect(saved()).not.toHaveProperty('servings')
  })

  it('catalog mode shows grams, not servings, and writes no servings key', async () => {
    const user = await renderApp()
    await user.click(first('Log food'))
    await user.type(await screen.findByPlaceholderText(/Search foods/), 'oats')
    await user.click(await screen.findByRole('button', { name: /Rolled oats/ }))
    expect(await screen.findByLabelText(/Amount/)).toBeTruthy()
    expect(screen.queryByLabelText('Servings')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Add to diary' }))
    expect(saved()).not.toHaveProperty('servings')
  })
})

describe('catalog grams scale recorded nutrients', () => {
  const recentOats = (over: Record<string, unknown> = {}) => entry({ name: 'Rolled oats', catalogId: 'usda-oats', catalogSource: 'USDA SR Legacy', grams: 100, calories: 200, protein: 10, carbs: 20, fat: 5, ...over })
  const openRecent = async (user: User) => {
    await pickInLogger(user, /^Rolled oats/)
    return screen.findByRole('group', { name: 'Quick amounts' })
  }

  it('gives fiber 25 and scaled macros at 250 g typed', async () => {
    entries = [recentOats({ fiber: 10 })]
    const user = await renderApp()
    await openRecent(user)
    fireEvent.change(field('entry-grams'), { target: { value: '250' } })
    await user.click(screen.getByRole('button', { name: 'Add to diary' }))
    expect(saved()).toMatchObject({ grams: 250, fiber: 25, calories: 500, protein: 25, carbs: 50, fat: 12.5, catalogId: 'usda-oats' })
    expect(saved()).not.toHaveProperty('servings')
  })

  it('scales fiber with a quick amount chip', async () => {
    entries = [recentOats({ fiber: 10 })]
    const user = await renderApp()
    const chips = await openRecent(user)
    await user.click(within(chips).getByRole('button', { name: '150 g' }))
    await user.click(screen.getByRole('button', { name: 'Add to diary' }))
    expect(saved()).toMatchObject({ grams: 150, fiber: 15, calories: 300 })
  })

  it('keeps an entry without nutrients free of them at any grams', async () => {
    entries = [recentOats()]
    const user = await renderApp()
    await openRecent(user)
    fireEvent.change(field('entry-grams'), { target: { value: '250' } })
    await user.click(screen.getByRole('button', { name: 'Add to diary' }))
    const result = saved()
    expect(result.calories).toBe(500)
    for (const key of ['fiber', 'sodium', 'sugar', 'satFat', 'cholesterol']) expect(result).not.toHaveProperty(key)
  })
})
