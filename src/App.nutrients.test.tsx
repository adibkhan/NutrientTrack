// Extra nutrients (fiber, sodium, sugar, saturated fat, cholesterol) on entries and saved foods, and the diary summary line.
// Missing means "not recorded", never zero; edits clear only the optional fields the form owns (invariant 2).
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry, Food } from './types'
import { shiftDate, todayISO } from './lib/utils'

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
const NUTRIENT_KEYS = ['fiber', 'sodium', 'sugar', 'satFat', 'cholesterol'] as const

const entry = (over: Partial<DiaryEntry> & Record<string, unknown> = {}): DiaryEntry => ({
  id: 'e1', name: 'Porridge', meal: 'breakfast', date: todayISO(), calories: 300, protein: 10, carbs: 40, fat: 5, createdAt: stamp, updatedAt: stamp, ...over,
}) as DiaryEntry
const savedFood = (over: Partial<Food> & Record<string, unknown> = {}): Food => ({
  id: 'f1', name: 'Oats', serving: '1 cup', calories: 150, protein: 5, carbs: 27, fat: 3, createdAt: stamp, updatedAt: stamp, ...over,
}) as Food

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  m.getEntries.mockResolvedValue([])
  m.getFoods.mockResolvedValue([])
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
const savedFoodArg = () => {
  expect(m.saveFood).toHaveBeenCalledTimes(1)
  return m.saveFood.mock.calls[0][0] as Food & Record<string, unknown>
}

async function openManualEntry(user: ReturnType<typeof userEvent.setup>) {
  await user.click(first('Log food'))
  await user.click(await screen.findByRole('button', { name: /Manual quick add/ }))
  const dialog = await screen.findByRole('dialog')
  await user.type(within(dialog).getByLabelText('Food or meal name'), 'Lentil soup')
  await user.type(within(dialog).getByLabelText(/^Calories/), '200')
  return dialog
}

async function editEntry(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name: `Edit ${name}` }))
  return screen.findByRole('dialog')
}

async function openFoodsView(user: ReturnType<typeof userEvent.setup>) {
  await user.click(first('Foods'))
}

describe('entry form: More nutrients', () => {
  it('offers a collapsed disclosure with Fiber, Sodium, Sugar, Saturated fat and Cholesterol boxes', async () => {
    const user = await renderApp()
    const dialog = await openManualEntry(user)
    const details = dialog.querySelector('details.nutrient-fields') as HTMLDetailsElement
    expect(within(details).getByText('More nutrients')).toBeTruthy()
    expect(details.open).toBe(false)
    for (const label of [/^Fiber/, /^Sodium/, /^Sugar/, /^Saturated fat/, /^Cholesterol/]) expect(within(dialog).getByLabelText(label)).toBeTruthy()
    await user.click(within(details).getByText('More nutrients'))
    expect(details.open).toBe(true)
  })

  it('saves filled values as numbers', async () => {
    const user = await renderApp()
    const dialog = await openManualEntry(user)
    await user.type(within(dialog).getByLabelText(/^Fiber/), '4.5')
    await user.type(within(dialog).getByLabelText(/^Sodium/), '600')
    await user.type(within(dialog).getByLabelText(/^Sugar/), '2')
    await user.type(within(dialog).getByLabelText(/^Saturated fat/), '1.2')
    await user.type(within(dialog).getByLabelText(/^Cholesterol/), '10')
    await user.click(within(dialog).getByRole('button', { name: 'Add to diary' }))

    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    const saved = savedEntry()
    expect(saved).toMatchObject({ fiber: 4.5, sodium: 600, sugar: 2, satFat: 1.2, cholesterol: 10 })
    for (const key of NUTRIENT_KEYS) expect(typeof saved[key]).toBe('number')
  })

  it('does not save empty boxes: the keys are absent, not zero', async () => {
    const user = await renderApp()
    const dialog = await openManualEntry(user)
    await user.type(within(dialog).getByLabelText(/^Fiber/), '3')
    await user.click(within(dialog).getByRole('button', { name: 'Add to diary' }))

    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    const saved = savedEntry()
    expect(saved.fiber).toBe(3)
    for (const key of NUTRIENT_KEYS.filter((k) => k !== 'fiber')) expect(saved).not.toHaveProperty(key)
  })

  it('saves no nutrient keys at all when none are filled', async () => {
    const user = await renderApp()
    const dialog = await openManualEntry(user)
    await user.click(within(dialog).getByRole('button', { name: 'Add to diary' }))

    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    for (const key of NUTRIENT_KEYS) expect(savedEntry()).not.toHaveProperty(key)
  })

  it('keeps a typed 0 as a recorded zero', async () => {
    const user = await renderApp()
    const dialog = await openManualEntry(user)
    await user.type(within(dialog).getByLabelText(/^Sugar/), '0')
    await user.click(within(dialog).getByRole('button', { name: 'Add to diary' }))

    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(savedEntry().sugar).toBe(0)
  })

  it('shows an error and does not save when a nutrient is negative', async () => {
    const user = await renderApp()
    const dialog = await openManualEntry(user)
    await user.type(within(dialog).getByLabelText(/^Sodium/), '-5')
    fireEvent.submit(dialog.querySelector('form') as HTMLFormElement)

    expect((await within(dialog).findByRole('alert')).textContent).toBe('Sodium must be zero or greater.')
    expect(m.saveEntry).not.toHaveBeenCalled()
  })

  it('does not save when the Add button is pressed with a negative nutrient (the box is natively invalid)', async () => {
    const user = await renderApp()
    const dialog = await openManualEntry(user)
    await user.type(within(dialog).getByLabelText(/^Sodium/), '-5')
    await user.click(within(dialog).getByRole('button', { name: 'Add to diary' }))

    expect((within(dialog).getByLabelText(/^Sodium/) as HTMLInputElement).validity.rangeUnderflow).toBe(true)
    expect(m.saveEntry).not.toHaveBeenCalled()
  })
})

describe('editing an entry with nutrients', () => {
  it('opens the disclosure on its own and shows the stored values', async () => {
    m.getEntries.mockResolvedValue([entry({ fiber: 7, sodium: 0 })])
    const user = await renderApp()
    const dialog = await editEntry(user, 'Porridge')
    expect((dialog.querySelector('details.nutrient-fields') as HTMLDetailsElement).open).toBe(true)
    expect((within(dialog).getByLabelText(/^Fiber/) as HTMLInputElement).value).toBe('7')
    expect((within(dialog).getByLabelText(/^Sodium/) as HTMLInputElement).value).toBe('0')
    expect((within(dialog).getByLabelText(/^Sugar/) as HTMLInputElement).value).toBe('')
  })

  it('removes the fiber key when its box is cleared, and keeps an unknown field and the other nutrients', async () => {
    m.getEntries.mockResolvedValue([entry({ fiber: 7, sodium: 120, glycemicIndex: 55 })])
    const user = await renderApp()
    const dialog = await editEntry(user, 'Porridge')
    await user.clear(within(dialog).getByLabelText(/^Fiber/))
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    const saved = savedEntry()
    expect(saved).not.toHaveProperty('fiber')
    expect(saved).toMatchObject({ id: 'e1', sodium: 120, glycemicIndex: 55, createdAt: stamp })
  })

  it('changes a nutrient value without touching the rest of the record', async () => {
    m.getEntries.mockResolvedValue([entry({ fiber: 7, glycemicIndex: 55 })])
    const user = await renderApp()
    const dialog = await editEntry(user, 'Porridge')
    await user.clear(within(dialog).getByLabelText(/^Fiber/))
    await user.type(within(dialog).getByLabelText(/^Fiber/), '9')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(savedEntry()).toMatchObject({ fiber: 9, glycemicIndex: 55 })
  })

  it('does not add nutrient keys to an entry that never had any', async () => {
    m.getEntries.mockResolvedValue([entry()])
    const user = await renderApp()
    const dialog = await editEntry(user, 'Porridge')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    for (const key of NUTRIENT_KEYS) expect(savedEntry()).not.toHaveProperty(key)
  })

  it('refuses a negative edit and saves nothing', async () => {
    m.getEntries.mockResolvedValue([entry({ fiber: 7 })])
    const user = await renderApp()
    const dialog = await editEntry(user, 'Porridge')
    await user.clear(within(dialog).getByLabelText(/^Fiber/))
    await user.type(within(dialog).getByLabelText(/^Fiber/), '-1')
    fireEvent.submit(dialog.querySelector('form') as HTMLFormElement)

    expect((await within(dialog).findByRole('alert')).textContent).toBe('Fiber must be zero or greater.')
    expect(m.saveEntry).not.toHaveBeenCalled()
  })

  it('keeps nutrients on a catalog entry that is edited as manual', async () => {
    m.getEntries.mockResolvedValue([entry({ name: 'Oats', catalogId: 'usda-1', catalogSource: 'USDA SR Legacy', grams: 50, fiber: 5.3 })])
    const user = await renderApp()
    const dialog = await editEntry(user, 'Oats')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(savedEntry().fiber).toBe(5.3)
  })
})

describe('logging from something that carries nutrients', () => {
  it('quick-add on a recent entry with fiber saves the fiber and nothing else it lacked', async () => {
    m.getEntries.mockResolvedValue([entry({ date: shiftDate(todayISO(), -3), name: 'Bran muffin', fiber: 6 })])
    const user = await renderApp()
    await user.click(first('Log food'))
    await user.click(await screen.findByRole('button', { name: 'Quick add Bran muffin' }))

    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    const saved = savedEntry()
    expect(saved).toMatchObject({ name: 'Bran muffin', fiber: 6, date: todayISO() })
    for (const key of NUTRIENT_KEYS.filter((k) => k !== 'fiber')) expect(saved).not.toHaveProperty(key)
  })

  it('quick-add on a recent entry without nutrients saves no nutrient keys', async () => {
    m.getEntries.mockResolvedValue([entry({ date: shiftDate(todayISO(), -3), name: 'Toast' })])
    const user = await renderApp()
    await user.click(first('Log food'))
    await user.click(await screen.findByRole('button', { name: 'Quick add Toast' }))

    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    for (const key of NUTRIENT_KEYS) expect(savedEntry()).not.toHaveProperty(key)
  })

  it('quick-add on a recent catalog entry keeps its nutrients and catalog provenance', async () => {
    m.getEntries.mockResolvedValue([entry({ date: shiftDate(todayISO(), -2), name: 'Rolled oats', catalogId: 'usda-oats', catalogSource: 'USDA SR Legacy', grams: 80, fiber: 8.4 })])
    const user = await renderApp()
    await user.click(first('Log food'))
    await user.click(await screen.findByRole('button', { name: 'Quick add Rolled oats' }))

    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(savedEntry()).toMatchObject({ fiber: 8.4, catalogId: 'usda-oats', grams: 80 })
  })

  it('logging a saved food from the Foods view carries its nutrients onto the entry', async () => {
    m.getFoods.mockResolvedValue([savedFood({ fiber: 4, sodium: 2 })])
    const user = await renderApp()
    await openFoodsView(user)
    await user.click(await screen.findByRole('button', { name: /^Log$/ }))
    const dialog = await screen.findByRole('dialog')
    expect((within(dialog).getByLabelText(/^Fiber/) as HTMLInputElement).value).toBe('4')
    await user.click(within(dialog).getByRole('button', { name: 'Add to diary' }))

    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(savedEntry()).toMatchObject({ foodId: 'f1', fiber: 4, sodium: 2 })
    expect(savedEntry()).not.toHaveProperty('sugar')
  })

  it('"Save as reusable food" writes the entered nutrients to the new food', async () => {
    const user = await renderApp()
    const dialog = await openManualEntry(user)
    await user.type(within(dialog).getByLabelText(/^Fiber/), '3')
    await user.click(within(dialog).getByRole('checkbox', { name: /Save as reusable food/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Add to diary' }))

    await waitFor(() => expect(m.saveFood).toHaveBeenCalledTimes(1))
    const food = savedFoodArg()
    expect(food.fiber).toBe(3)
    expect(food).not.toHaveProperty('sodium')
  })
})

describe('diary nutrient line', () => {
  const line = () => document.querySelector('.nutrient-line')

  it('shows only the recorded nutrients, summed over eaten entries', async () => {
    m.getEntries.mockResolvedValue([
      entry({ id: 'a', name: 'Beans', fiber: 10, sodium: 1000 }),
      entry({ id: 'b', name: 'Lentils', fiber: 8, sodium: 640 }),
      entry({ id: 'c', name: 'Water' }),
    ])
    await renderApp()
    await waitFor(() => expect(line()?.textContent).toBe('Fiber 18 g · Sodium 1,640 mg'))
    expect(line()?.textContent).not.toMatch(/Sugar|Saturated|Cholesterol/)
  })

  it('shows nothing when no entry recorded a nutrient', async () => {
    m.getEntries.mockResolvedValue([entry({ name: 'Plain rice' })])
    await renderApp()
    await screen.findByText('Plain rice')
    expect(line()).toBeNull()
  })

  it('ignores planned entries', async () => {
    m.getEntries.mockResolvedValue([
      entry({ id: 'a', name: 'Beans', fiber: 10 }),
      entry({ id: 'b', name: 'Planned feast', fiber: 50, sodium: 900, planned: true }),
    ])
    await renderApp()
    await waitFor(() => expect(line()?.textContent).toBe('Fiber 10 g'))
  })

  it('shows nothing when the only entry with nutrients is planned', async () => {
    m.getEntries.mockResolvedValue([entry({ name: 'Planned feast', fiber: 50, planned: true })])
    await renderApp()
    await screen.findByText('Planned feast')
    expect(line()).toBeNull()
  })

  it('shows a recorded zero, unlike a missing value', async () => {
    m.getEntries.mockResolvedValue([entry({ name: 'Diet soda', sugar: 0 })])
    await renderApp()
    await waitFor(() => expect(line()?.textContent).toBe('Sugar 0 g'))
  })

  it('only counts the day being viewed', async () => {
    m.getEntries.mockResolvedValue([entry({ name: 'Old beans', date: shiftDate(todayISO(), -1), fiber: 99 })])
    await renderApp()
    await waitFor(() => expect(m.getEntries).toHaveBeenCalled())
    expect(line()).toBeNull()
  })
})

describe('saved food form: More nutrients', () => {
  async function openNewFood(user: ReturnType<typeof userEvent.setup>) {
    await openFoodsView(user)
    await user.click(first('Add custom food'))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Food name'), 'Hummus')
    await user.type(within(dialog).getByLabelText(/^Calories/), '170')
    return dialog
  }

  it('has the same disclosure with all five boxes', async () => {
    const user = await renderApp()
    const dialog = await openNewFood(user)
    expect(within(dialog).getByText('More nutrients')).toBeTruthy()
    for (const label of [/^Fiber/, /^Sodium/, /^Sugar/, /^Saturated fat/, /^Cholesterol/]) expect(within(dialog).getByLabelText(label)).toBeTruthy()
  })

  it('saves the entered nutrients as numbers and leaves empty ones out', async () => {
    const user = await renderApp()
    const dialog = await openNewFood(user)
    await user.type(within(dialog).getByLabelText(/^Fiber/), '2.5')
    await user.type(within(dialog).getByLabelText(/^Cholesterol/), '0')
    await user.click(within(dialog).getByRole('button', { name: 'Create food' }))

    await waitFor(() => expect(m.saveFood).toHaveBeenCalledTimes(1))
    const food = savedFoodArg()
    expect(food).toMatchObject({ name: 'Hummus', fiber: 2.5, cholesterol: 0 })
    for (const key of ['sodium', 'sugar', 'satFat']) expect(food).not.toHaveProperty(key)
  })

  it('refuses a negative value and saves nothing', async () => {
    const user = await renderApp()
    const dialog = await openNewFood(user)
    await user.type(within(dialog).getByLabelText(/^Saturated fat/), '-1')
    fireEvent.submit(dialog.querySelector('form') as HTMLFormElement)

    expect((await within(dialog).findByRole('alert')).textContent).toBe('Saturated fat must be zero or greater.')
    expect(m.saveFood).not.toHaveBeenCalled()
  })

  it('removes a cleared nutrient on edit while unknown fields on the stored food survive', async () => {
    m.getFoods.mockResolvedValue([savedFood({ fiber: 4, sodium: 90, brand: 'Acme' })])
    const user = await renderApp()
    await openFoodsView(user)
    await user.click(await screen.findByRole('button', { name: 'Edit Oats' }))
    const dialog = await screen.findByRole('dialog')
    expect((dialog.querySelector('details.nutrient-fields') as HTMLDetailsElement).open).toBe(true)
    await user.clear(within(dialog).getByLabelText(/^Fiber/))
    await user.click(within(dialog).getByRole('button', { name: 'Save food' }))

    await waitFor(() => expect(m.saveFood).toHaveBeenCalledTimes(1))
    const food = savedFoodArg()
    expect(food).not.toHaveProperty('fiber')
    expect(food).toMatchObject({ id: 'f1', sodium: 90, brand: 'Acme', createdAt: stamp })
  })

  it('does not add nutrient keys to a food that never had any', async () => {
    m.getFoods.mockResolvedValue([savedFood()])
    const user = await renderApp()
    await openFoodsView(user)
    await user.click(await screen.findByRole('button', { name: 'Edit Oats' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save food' }))

    await waitFor(() => expect(m.saveFood).toHaveBeenCalledTimes(1))
    for (const key of NUTRIENT_KEYS) expect(savedFoodArg()).not.toHaveProperty(key)
  })
})
