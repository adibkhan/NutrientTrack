// Comma-decimal input: "1,5" is 1.5, text that could mean two numbers ("2,000") is refused with a message, and stored values stay numbers.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry, Food, Settings, WeightEntry } from './types'
import { todayISO } from './lib/utils'

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
let entries: DiaryEntry[] = []
let foods: Food[] = []
let stored: Settings | undefined

const msg = (text: string, small: string, big: string) => `“${text}” could mean ${big} or ${small}.`

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  localStorage.clear()
  entries = []
  foods = []
  stored = { id: 'profile', goals: { weightUnit: 'kg' }, preferences: { welcomed: true }, updatedAt: stamp } as unknown as Settings
  m.getEntries.mockImplementation(async () => entries.map((item) => ({ ...item })))
  m.getFoods.mockImplementation(async () => foods.map((item) => ({ ...item })))
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockImplementation(async () => stored)
  m.saveSettings.mockImplementation(async (next) => { stored = next as Settings })
  m.saveEntry.mockResolvedValue(undefined)
  m.saveFood.mockResolvedValue(undefined)
  m.saveWeight.mockResolvedValue(undefined)
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
const field = (id: string) => document.getElementById(id) as HTMLInputElement
const type = (id: string, value: string) => fireEvent.change(field(id), { target: { value } })
const savedEntry = () => {
  expect(m.saveEntry).toHaveBeenCalledTimes(1)
  return m.saveEntry.mock.calls[0][0] as DiaryEntry & Record<string, unknown>
}

async function manual(user: User, calories: string) {
  await user.click(first('Log food'))
  await user.click(await screen.findByRole('button', { name: /Manual quick add/ }))
  const dialog = await screen.findByRole('dialog')
  await user.type(within(dialog).getByLabelText('Food or meal name'), 'Soup')
  type('entry-calories', calories)
  return dialog
}
async function addManual(user: User, calories: string) {
  const dialog = await manual(user, calories)
  await user.click(within(dialog).getByRole('button', { name: 'Add to diary' }))
  return dialog
}

describe('entry form: calories', () => {
  it('uses text boxes with a decimal keyboard and no native number attributes', async () => {
    const user = await renderApp()
    await manual(user, '')
    for (const id of ['entry-calories', 'entry-protein', 'entry-carbs', 'entry-fat', 'entry-fiber', 'entry-sodium']) {
      const input = field(id)
      expect(input.type).toBe('text')
      expect(input.getAttribute('inputmode')).toBe('decimal')
      for (const attribute of ['min', 'max', 'step']) expect(input.hasAttribute(attribute)).toBe(false)
    }
  })

  it.each([['1,5', 1.5], ['1.5', 1.5], ['1200', 1200], ['1,2', 1.2], ['1.234,5', 1234.5], ['١٫٥', 1.5]])('saves %j kcal as %d', async (text, expected) => {
    const user = await renderApp()
    await addManual(user, text)
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(savedEntry().calories).toBe(expected)
    expect(typeof savedEntry().calories).toBe('number')
  })

  it.each([['1,200', '1.2', '1200'], ['10,000', '10', '10000'], ['2,000', '2', '2000'], ['2.000', '2', '2000']])('refuses %j kcal with a message and saves nothing', async (text, small, big) => {
    const user = await renderApp()
    const dialog = await addManual(user, text)
    const alert = await within(dialog).findByText(new RegExp(`^${msg(text, small, big).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    expect(alert.getAttribute('role')).toBe('alert')
    expect(field('entry-calories').getAttribute('aria-invalid')).toBe('true')
    expect(field('entry-calories').getAttribute('aria-describedby')).toBe(alert.id)
    expect(m.saveEntry).not.toHaveBeenCalled()
  })

  it.each(['-5', 'abc', '150 g', '1e3', '1/2'])('refuses %j kcal', async (text) => {
    const user = await renderApp()
    const dialog = await addManual(user, text)
    expect(await within(dialog).findByText('Add a valid calorie amount.')).toBeTruthy()
    expect(m.saveEntry).not.toHaveBeenCalled()
  })

  it('reads a comma in macros and nutrients, and keeps 0,125 exact in a nutrient', async () => {
    const user = await renderApp()
    const dialog = await manual(user, '200')
    type('entry-protein', '12,5')
    type('entry-fiber', '0,125')
    await user.click(within(dialog).getByRole('button', { name: 'Add to diary' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(savedEntry()).toMatchObject({ calories: 200, protein: 12.5, fiber: 0.125 })
  })

  it('refuses an ambiguous macro or nutrient at its own field', async () => {
    const user = await renderApp()
    const dialog = await manual(user, '200')
    type('entry-protein', '1,200')
    await user.click(within(dialog).getByRole('button', { name: 'Add to diary' }))
    expect(await within(dialog).findByText(/^“1,200” could mean 1200 or 1\.2\./)).toBeTruthy()
    expect(field('entry-protein').getAttribute('aria-invalid')).toBe('true')
    expect(m.saveEntry).not.toHaveBeenCalled()
  })

  it('refuses an ambiguous cap-sized amount instead of reading it as a small number', async () => {
    const user = await renderApp()
    const dialog = await addManual(user, '10,000')
    expect(await within(dialog).findByText(/could mean 10000 or 10\./)).toBeTruthy()
    expect(m.saveEntry).not.toHaveBeenCalled()
  })

  it('names the cap without a thousands separator', async () => {
    const user = await renderApp()
    const dialog = await addManual(user, '10001')
    expect(await within(dialog).findByText("That's more than 10000 kcal for one entry. Check the number.")).toBeTruthy()
  })
})

describe('entry form: prefilled values', () => {
  const stew = (over: Record<string, unknown> = {}) => ({ id: 'e-1', date: todayISO(), meal: 'lunch', name: 'Stew', calories: 600, protein: 30, carbs: 60, fat: 20, createdAt: stamp, updatedAt: stamp, ...over }) as DiaryEntry
  const yogurt = { id: 'f-yogurt', name: 'Yogurt', serving: '1 cup', calories: 200, protein: 10, carbs: 20, fat: 6, createdAt: stamp, updatedAt: stamp } as Food

  it('saves an untouched 1.125 servings unchanged', async () => {
    entries = [stew({ servings: 1.125, foodId: 'f-yogurt' })]
    foods = [yogurt]
    const user = await renderApp()
    await user.click(first(/^Edit Stew\b/))
    await screen.findByLabelText('Servings')
    expect(field('entry-servings').value).toBe('1.1250')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(savedEntry()).toMatchObject({ servings: 1.125, calories: 600, protein: 30 })
  })

  it('prefills a stored 1e-7 nutrient as plain digits and saves it back as 1e-7', async () => {
    entries = [stew({ sodium: 1e-7, futureField: 'kept' })]
    const user = await renderApp()
    await user.click(first(/^Edit Stew\b/))
    await screen.findByRole('dialog')
    expect(field('entry-sodium').value).toBe('0.0000001')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(savedEntry().sodium).toBe(1e-7)
    expect(savedEntry().futureField).toBe('kept')
  })

  it('writes the stepper value with a period and never an ambiguous string', async () => {
    entries = [stew({ servings: 1, foodId: 'f-yogurt' })]
    foods = [yogurt]
    const user = await renderApp()
    await user.click(first(/^Edit Stew\b/))
    await screen.findByLabelText('Servings')
    await user.click(screen.getByRole('button', { name: 'Half a serving more' }))
    expect(field('entry-servings').value).toBe('1.5')
  })
})

describe('weight and body fat', () => {
  async function logWeight(user: User, weight: string, bodyFat = '') {
    await user.click(first('Trends'))
    await user.click(first('Log weight'))
    const dialog = await screen.findByRole('dialog')
    type('weight-value', weight)
    if (bodyFat) type('weight-bodyfat', bodyFat)
    await user.click(within(dialog).getByRole('button', { name: 'Save check-in' }))
    return dialog
  }
  const savedWeight = () => {
    expect(m.saveWeight).toHaveBeenCalledTimes(1)
    return m.saveWeight.mock.calls[0][0] as WeightEntry
  }

  it('saves 82,4 as 82.4', async () => {
    const user = await renderApp()
    await logWeight(user, '82,4')
    await waitFor(() => expect(m.saveWeight).toHaveBeenCalledTimes(1))
    expect(savedWeight().weight).toBe(82.4)
  })

  it('saves 18,5 body fat as 18.5', async () => {
    const user = await renderApp()
    await logWeight(user, '82', '18,5')
    await waitFor(() => expect(m.saveWeight).toHaveBeenCalledTimes(1))
    expect(savedWeight()).toMatchObject({ weight: 82, bodyFat: 18.5 })
  })

  it('refuses 1,200 weight with the message and saves nothing', async () => {
    const user = await renderApp()
    const dialog = await logWeight(user, '1,200')
    expect(await within(dialog).findByText(msg('1,200', '1.2', '1200') + ' Type 1200, or 1.2.')).toBeTruthy()
    expect(m.saveWeight).not.toHaveBeenCalled()
  })

  it('refuses an ambiguous body fat', async () => {
    const user = await renderApp()
    const dialog = await logWeight(user, '82', '1,200')
    expect(await within(dialog).findByText(/^“1,200” could mean/)).toBeTruthy()
    expect(m.saveWeight).not.toHaveBeenCalled()
  })

  it.each(['-5', 'abc'])('refuses %j weight', async (text) => {
    const user = await renderApp()
    const dialog = await logWeight(user, text)
    expect(await within(dialog).findByText('Add a valid date and weight.')).toBeTruthy()
    expect(m.saveWeight).not.toHaveBeenCalled()
  })
})

describe('Settings goals', () => {
  async function saveGoals(values: Record<string, string>) {
    const user = await renderApp()
    await user.click(first('Settings'))
    await screen.findByLabelText(/^Calories/)
    for (const [id, value] of Object.entries(values)) type(id, value)
    await user.click(screen.getByRole('button', { name: 'Save goals' }))
    return user
  }
  const goals = () => (m.saveSettings.mock.calls.at(-1)?.[0] as unknown as { goals: Record<string, unknown> }).goals

  it('uses 2000, not 2,000, as the example', async () => {
    const user = await renderApp()
    await user.click(first('Settings'))
    expect((await screen.findByLabelText(/^Calories/)).getAttribute('placeholder')).toBe('e.g. 2000')
    void user
  })

  it('saves 12,5 protein as 12.5', async () => {
    await saveGoals({ 'goal-protein': '12,5' })
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    expect(goals().protein).toBe(12.5)
  })

  it('saves 2000 calories', async () => {
    await saveGoals({ 'goal-calories': '2000' })
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    expect(goals().calories).toBe(2000)
  })

  it.each([['2,000', '2', '2000'], ['2.000', '2', '2000']])('refuses a %j calorie goal and stores nothing', async (text) => {
    await saveGoals({ 'goal-calories': text })
    const alert = await screen.findByText(new RegExp(`^“${text.replace('.', '\\.')}” could mean 2000 or 2\\.`))
    expect(alert.getAttribute('role')).toBe('alert')
    expect(field('goal-calories').getAttribute('aria-invalid')).toBe('true')
    expect(field('goal-calories').getAttribute('aria-describedby')).toBe(alert.id)
    expect(m.saveSettings).not.toHaveBeenCalled()
  })

  it.each([['goal-calories', '-50', 'Calories goal must be a number, zero or greater.'], ['goal-protein', 'abc', 'Protein goal must be a number, zero or greater.'], ['goal-carbs', '-1', 'Carbs goal must be a number, zero or greater.'], ['goal-fat', '12 g', 'Fat goal must be a number, zero or greater.']])('refuses %s = %j', async (id, text, message) => {
    await saveGoals({ [id]: text })
    expect(await screen.findByText(message)).toBeTruthy()
    expect(m.saveSettings).not.toHaveBeenCalled()
  })

  it('clears the message once the box is edited', async () => {
    await saveGoals({ 'goal-calories': '2,000' })
    await screen.findByText(/could mean 2000/)
    type('goal-calories', '2000')
    expect(screen.queryByText(/could mean 2000/)).toBeNull()
  })
})

describe('Welcome card', () => {
  beforeEach(() => { stored = undefined })
  async function welcome() {
    const user = await renderApp()
    await screen.findByRole('region', { name: 'Hi, I’m Pip!' })
    return user
  }

  it('uses 2000, not 2,000, as the example', async () => {
    await welcome()
    expect(screen.getByLabelText(/Daily energy goal/).getAttribute('placeholder')).toBe('e.g. 2000')
  })

  it.each([['2,000', /^“2,000” could mean 2000 or 2\./], ['abc', /^Daily energy goal must be a number, zero or greater\.$/], ['2000 kcal', /^Daily energy goal must be a number/], ['-5', /^Daily energy goal must be a number/]])('refuses %j and does not finish', async (text, message) => {
    const user = await welcome()
    type('welcome-calories', text)
    await user.click(screen.getByRole('button', { name: 'Start logging' }))
    const alert = await screen.findByText(message)
    expect(alert.getAttribute('role')).toBe('alert')
    expect(field('welcome-calories').getAttribute('aria-invalid')).toBe('true')
    expect(m.saveSettings).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: 'Hi, I’m Pip!' })).toBeTruthy()
  })

  it('refuses a bad protein goal too', async () => {
    const user = await welcome()
    type('welcome-protein', '1,200')
    await user.click(screen.getByRole('button', { name: 'Start logging' }))
    expect(await screen.findByText(/^“1,200” could mean 1200 or 1\.2\./)).toBeTruthy()
    expect(m.saveSettings).not.toHaveBeenCalled()
  })

  it('runs the same check on the estimate path', async () => {
    const user = await welcome()
    type('welcome-calories', '2,000')
    await user.click(screen.getByRole('button', { name: /Estimate a starting target/ }))
    expect(await screen.findByText(/^“2,000” could mean/)).toBeTruthy()
    expect(m.saveSettings).not.toHaveBeenCalled()
  })

  it('treats blank and 0 as no goal, and reads a comma', async () => {
    const user = await welcome()
    type('welcome-calories', '0')
    type('welcome-protein', '12,5')
    await user.click(screen.getByRole('button', { name: 'Start logging' }))
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    const saved = m.saveSettings.mock.calls[0][0] as Settings
    expect(saved.goals).toEqual({ weightUnit: expect.any(String), protein: 12.5 })
  })

  it('saves 2000 as the goal', async () => {
    const user = await welcome()
    type('welcome-calories', '2000')
    await user.click(screen.getByRole('button', { name: 'Start logging' }))
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    expect((m.saveSettings.mock.calls[0][0] as Settings).goals?.calories).toBe(2000)
  })
})
