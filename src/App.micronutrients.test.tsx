// Micronutrients: catalog foods log every nutrient the USDA table has, edits keep unknown fields, Trends and the diary show them honestly.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import catalogText from '../public/data/usda-common-v2.json?raw'
import tableText from '../public/data/usda-nutrients-v1.json?raw'
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
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('usda-nutrients')) return respond(tableText)
    return respond(catalogText)
  }))
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
const savedEntry = () => {
  expect(m.saveEntry).toHaveBeenCalledTimes(1)
  return m.saveEntry.mock.calls[0][0] as DiaryEntry & Record<string, unknown>
}
async function openBanana(user: ReturnType<typeof userEvent.setup>) {
  await user.click(first('Log food'))
  const dialog = await screen.findByRole('dialog')
  await user.type(within(dialog).getByPlaceholderText(/Search foods/), 'bananas, raw')
  const results = await within(dialog).findByLabelText('Catalog results')
  await user.click(within(results).getAllByRole('button').find((button) => /^Bananas, raw/.test(button.textContent ?? '')) as HTMLElement)
  await within(dialog).findByLabelText('Amount')
  return dialog
}
const submitEnabled = (dialog: HTMLElement) => waitFor(() => expect((within(dialog).getByRole('button', { name: 'Add to diary' }) as HTMLButtonElement).disabled).toBe(false))

describe('logging a catalog food', () => {
  it('snapshots every USDA nutrient scaled to the grams: a 118 g banana has about 422 mg of potassium', async () => {
    const user = await renderApp()
    const dialog = await openBanana(user)
    await submitEnabled(dialog)
    expect((within(dialog).getByLabelText('Amount') as HTMLInputElement).value).toBe('118')
    await user.click(within(dialog).getByRole('button', { name: 'Add to diary' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    const saved = savedEntry()
    expect(saved).toMatchObject({ catalogId: 'usda-sr-173944', grams: 118 })
    expect(saved.potassium).toBeCloseTo(422.4, 0)
    expect(saved.vitaminC).toBeCloseTo(10.3, 1)
    expect(saved.fiber).toBeCloseTo(3.07, 1)
    expect(saved.magnesium).toBeCloseTo(31.9, 0)
    for (const key of ['fiber', 'sodium', 'sugar', 'satFat', 'cholesterol', 'potassium', 'calcium', 'iron', 'vitaminA', 'vitaminK', 'folate', 'water']) expect(typeof saved[key]).toBe('number')
  })

  it('rescales every nutrient when the grams change', async () => {
    const user = await renderApp()
    const dialog = await openBanana(user)
    await submitEnabled(dialog)
    const grams = within(dialog).getByLabelText('Amount')
    await user.clear(grams)
    await user.type(grams, '236')
    expect((within(dialog).getByLabelText(/^Potassium/) as HTMLInputElement).value).toBe('844.88')
    await user.click(within(dialog).getByRole('button', { name: 'Add to diary' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(savedEntry().potassium).toBeCloseTo(844.9, 0)
    expect(savedEntry().grams).toBe(236)
  })

  it('describe-to-log snapshots the nutrients of each matched food', async () => {
    const user = await renderApp()
    await user.click(first('Log food'))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByPlaceholderText(/Search foods/), '2 bananas and an egg')
    const card = await within(dialog).findByRole('region', { name: 'Log as a meal' })
    await user.click(within(card).getByRole('button', { name: /^Add \d+ foods?/ }))
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalledTimes(1))
    const saved = m.saveEntries.mock.calls[0][0] as Array<DiaryEntry & Record<string, unknown>>
    expect(saved.length).toBeGreaterThanOrEqual(2)
    for (const item of saved) {
      expect(typeof item.potassium).toBe('number')
      expect(typeof item.vitaminB12).toBe('number')
    }
    const banana = saved.find((item) => item.catalogId === 'usda-sr-173944')
    expect(banana?.potassium).toBeCloseTo(((banana?.grams ?? 0) * 358) / 100, 0)
  })

  it('opens straight on a food from a /?log= link with its nutrients filled in', async () => {
    window.history.replaceState(null, '', '/?log=usda-sr-173944')
    const user = userEvent.setup()
    render(<App />)
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByLabelText('Amount')
    await submitEnabled(dialog)
    await waitFor(() => expect((within(dialog).getByLabelText(/^Potassium/) as HTMLInputElement).value).not.toBe(''))
    await user.click(within(dialog).getByRole('button', { name: 'Add to diary' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(savedEntry().potassium).toBeCloseTo(422.4, 0)
    window.history.replaceState(null, '', '/')
  })

  it('quick-add on a recent catalog entry from before micronutrients fills them from the table, keeping what it recorded', async () => {
    m.getEntries.mockResolvedValue([entry({ date: shiftDate(todayISO(), -2), name: 'Bananas, raw', catalogId: 'usda-sr-173944', catalogSource: 'USDA SR Legacy', grams: 118, fiber: 9 })])
    const user = await renderApp()
    await user.click(first('Log food'))
    await user.click(await screen.findByRole('button', { name: 'Log Bananas, raw now' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(savedEntry().fiber).toBe(9)
    expect(savedEntry().potassium).toBeCloseTo(422.4, 0)
  })
})

describe('entry form: all nutrients', () => {
  async function openManual(user: ReturnType<typeof userEvent.setup>) {
    await user.click(first('Log food'))
    await user.click(await screen.findByRole('button', { name: /Manual quick add/ }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Food or meal name'), 'Lentil soup')
    await user.type(within(dialog).getByLabelText(/^Calories/), '200')
    return dialog
  }

  it('shows the original five by default and the rest, grouped, behind Show all nutrients', async () => {
    const user = await renderApp()
    const dialog = await openManual(user)
    const all = dialog.querySelector('details.nutrient-all') as HTMLDetailsElement
    expect(all.open).toBe(false)
    expect(within(all).getByText('Show all nutrients')).toBeTruthy()
    expect(Array.from(all.querySelectorAll('.nutrient-group h4')).map((h) => h.textContent)).toEqual(['Fats', 'Minerals', 'Vitamins', 'Other'])
    const basic = dialog.querySelector('details.nutrient-fields > .nutrient-grid') as HTMLElement
    expect(Array.from(basic.querySelectorAll('label')).map((label) => label.textContent?.replace(/\s+(g|mg)$/, ''))).toEqual(['Fiber', 'Sodium', 'Sugar', 'Saturated fat', 'Cholesterol'])
    await user.click(within(all).getByText('Show all nutrients'))
    expect(all.open).toBe(true)
    for (const label of [/^Potassium/, /^Vitamin D/, /^Vitamin B12/, /^Folate/, /^Caffeine/, /^Omega-3/]) expect(within(all).getByLabelText(label)).toBeTruthy()
    expect(within(all).getByLabelText(/^Vitamin D/).closest('.form-field')?.textContent).toContain('mcg')
  })

  it('saves a manual entry with only the nutrients typed, using comma decimals', async () => {
    const user = await renderApp()
    const dialog = await openManual(user)
    await user.type(within(dialog).getByLabelText(/^Potassium/), '412,5')
    await user.type(within(dialog).getByLabelText(/^Vitamin B12/), '0')
    await user.click(within(dialog).getByRole('button', { name: 'Add to diary' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    const saved = savedEntry()
    expect(saved).toMatchObject({ potassium: 412.5, vitaminB12: 0 })
    for (const key of ['fiber', 'calcium', 'iron', 'vitaminC', 'water']) expect(saved).not.toHaveProperty(key)
  })

  it('saves a blank manual entry with no nutrient keys: blank means not recorded', async () => {
    const user = await renderApp()
    const dialog = await openManual(user)
    await user.click(within(dialog).getByRole('button', { name: 'Add to diary' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    for (const key of ['fiber', 'potassium', 'vitaminD', 'omega3', 'water']) expect(savedEntry()).not.toHaveProperty(key)
  })

  it('puts the cap message under the newer nutrient box and opens the full list', async () => {
    const user = await renderApp()
    const dialog = await openManual(user)
    await user.type(within(dialog).getByLabelText(/^Potassium/), '200000')
    await user.click(within(dialog).getByRole('button', { name: 'Add to diary' }))
    const alert = await within(dialog).findByText(/more than 100000 mg of potassium/)
    expect(alert.id).toBe('entry-potassium-error')
    expect(within(dialog).getByLabelText(/^Potassium/).getAttribute('aria-invalid')).toBe('true')
    expect((dialog.querySelector('details.nutrient-all') as HTMLDetailsElement).open).toBe(true)
    expect(m.saveEntry).not.toHaveBeenCalled()
  })
})

describe('editing keeps what the form does not own', () => {
  async function edit(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: /^Edit Porridge\b/ }))
    return screen.findByRole('dialog')
  }

  it('keeps an unknown nutrient field and every recorded newer nutrient when only the name changes', async () => {
    m.getEntries.mockResolvedValue([entry({ potassium: 400, vitaminK: 12, lutein: 55, futureField: { a: 1 } })])
    const user = await renderApp()
    const dialog = await edit(user)
    const name = within(dialog).getByLabelText('Food or meal name')
    await user.clear(name)
    await user.type(name, 'Oat porridge')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(savedEntry()).toMatchObject({ name: 'Oat porridge', potassium: 400, vitaminK: 12, lutein: 55, futureField: { a: 1 } })
  })

  it('removes a newer nutrient only when its box is cleared', async () => {
    m.getEntries.mockResolvedValue([entry({ potassium: 400, calcium: 90, lutein: 5 })])
    const user = await renderApp()
    const dialog = await edit(user)
    await user.clear(within(dialog).getByLabelText(/^Potassium/))
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    const saved = savedEntry()
    expect(saved).not.toHaveProperty('potassium')
    expect(saved).toMatchObject({ calcium: 90, lutein: 5 })
  })

  it('scales the newer nutrients with calories, as it does the original five', async () => {
    m.getEntries.mockResolvedValue([entry({ potassium: 400, zinc: 1.5, fiber: 4 })])
    const user = await renderApp()
    const dialog = await edit(user)
    const calories = within(dialog).getByLabelText(/^Calories/)
    await user.clear(calories)
    await user.type(calories, '600')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(savedEntry()).toMatchObject({ calories: 600, potassium: 800, zinc: 3, fiber: 8 })
  })
})

describe('Trends nutrients card', () => {
  const openTrends = async (entries: DiaryEntry[]) => {
    m.getEntries.mockResolvedValue(entries)
    const user = await renderApp()
    await user.click(first('Trends'))
    const card = (await screen.findByRole('heading', { name: 'Nutrients' })).closest('section') as HTMLElement
    return { user, card }
  }
  const day = (offset: number, over: Record<string, unknown> = {}) => entry({ id: `e${offset}`, date: shiftDate(todayISO(), -offset), name: `Meal ${offset}`, calories: 700, ...over })

  it('says "Not enough data yet" when no logged food recorded a nutrient', async () => {
    const { card } = await openTrends([day(1), day(2)])
    expect(within(card).getByText(/Not enough data yet/)).toBeTruthy()
    expect(card.querySelector('.nutrient-row')).toBeNull()
  })

  it('averages over the days that recorded the nutrient and says how many, never counting the rest as zero', async () => {
    const { card } = await openTrends([day(1, { potassium: 2000 }), day(2, { potassium: 3000 }), day(3, { potassium: 2500 }), day(4)])
    const row = within(card).getByRole('button', { name: /^Potassium, 2,500 mg per logged day, 53% of daily value/ })
    expect(row.textContent).toContain('3 of 4 days fully recorded')
    expect(row.textContent).toContain('2,500 mg of 4,700 mg')
    expect(row.textContent).toContain('53%')
  })

  it('adds a "Not enough data yet" note while every average rests on fewer than three days, and drops it after', async () => {
    const thin = await openTrends([day(1, { potassium: 2000 }), day(2, { potassium: 3000 })])
    expect(within(thin.card).getByText(/Not enough data yet\. Averages firm up/)).toBeTruthy()
    expect(within(thin.card).getByRole('button', { name: /^Potassium, 2,500 mg/ }).className).toContain('thin')
    expect(within(thin.card).getByRole('button', { name: /^Potassium, 2,500 mg/ }).textContent).toContain('Not enough data yet')
    cleanup()
    const firm = await openTrends([day(1, { potassium: 2000 }), day(2, { potassium: 3000 }), day(3, { potassium: 1000 })])
    expect(within(firm.card).queryByText(/Not enough data yet/)).toBeNull()
  })

  it('lists shortfalls first among "aim for" and overages first among "keep under"', async () => {
    const { card } = await openTrends([1, 2, 3].map((offset) => day(offset, { calcium: 1300, iron: 4.5, fiber: 14, sodium: 2760, satFat: 10 })))
    const names = (label: string) => Array.from(within(within(card).getByRole('list', { name: label })).getAllByRole('button')).map((button) => button.querySelector('.nutrient-row-name')?.textContent)
    expect(names('Nutrients to aim for')).toEqual(['Iron', 'Fiber', 'Calcium'])
    expect(names('Nutrients to keep under')).toEqual(['Sodium', 'Saturated fat'])
  })

  it('opens the top sources for a nutrient when its row is tapped', async () => {
    const { user, card } = await openTrends([day(1, { potassium: 3000, name: 'Baked potato' }), day(2, { potassium: 1000, name: 'Banana' }), day(3, { name: 'Toast' })])
    await user.click(within(card).getByRole('button', { name: /^Potassium,/ }))
    const contributors = screen.getByRole('heading', { name: 'Nutrient contributors' }).closest('section') as HTMLElement
    expect((within(contributors).getByLabelText('Nutrient') as HTMLSelectElement).value).toBe('potassium')
    expect(within(contributors).getByLabelText('Top sources of potassium').textContent).toContain('Baked potato')
    expect(contributors.querySelector('.metric-subtext')?.textContent).toContain('2 of 3 logged days')
  })

  it('switches range with the card toggle', async () => {
    const { user, card } = await openTrends([day(40, { potassium: 3000 }), day(1, { potassium: 1000 })])
    expect(within(card).getByRole('button', { name: /^Potassium, 1,000 mg/ })).toBeTruthy()
    await user.click(within(card).getByRole('button', { name: 'Nutrients, last 90 days' }))
    expect(within(card).getByRole('button', { name: /^Potassium, 2,000 mg/ })).toBeTruthy()
  })

  it('never prints NaN or undefined', async () => {
    const { card } = await openTrends([day(1, { potassium: 0, sodium: 0 }), day(2)])
    expect(card.textContent).not.toMatch(/NaN|undefined|Infinity/)
  })
})

describe('diary: Nutrients today', () => {
  it('is hidden when no entry that day has any of the six', async () => {
    m.getEntries.mockResolvedValue([entry({ monoFat: 3, sugar: 4 })])
    await renderApp()
    await screen.findByText(/Porridge/)
    expect(document.querySelector('.day-nutrients')).toBeNull()
  })

  it('shows fiber, sodium, potassium, calcium, iron and vitamin D with percent of daily value', async () => {
    m.getEntries.mockResolvedValue([entry({ fiber: 7, sodium: 1150, potassium: 940, calcium: 130, iron: 9, vitaminD: 5, zinc: 3 })])
    await renderApp()
    const disclosure = await waitFor(() => {
      const found = document.querySelector('.day-nutrients') as HTMLDetailsElement | null
      expect(found).not.toBeNull()
      return found as HTMLDetailsElement
    })
    expect(within(disclosure).getByText('Nutrients today')).toBeTruthy()
    fireEvent.click(within(disclosure).getByText('Nutrients today'))
    const items = Array.from(disclosure.querySelectorAll('.day-nutrient-list li')).map((li) => li.textContent)
    expect(items).toHaveLength(6)
    expect(items[0]).toMatch(/Fiber7 g.*25%/)
    expect(items[1]).toMatch(/Sodium1,150 mg.*50%/)
    expect(items.join(' ')).not.toContain('Zinc')
  })

  it('does not count a planned food', async () => {
    m.getEntries.mockResolvedValue([entry({ potassium: 900, planned: true })])
    await renderApp()
    await screen.findByText(/Porridge/)
    expect(document.querySelector('.day-nutrients')).toBeNull()
  })
})
