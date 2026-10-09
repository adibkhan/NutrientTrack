// Copy an entry or a whole day to another date, and log by target nutrient in the logger.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogFood } from './catalog/types'
import type { DiaryEntry, Food } from './types'

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
const toast = () => document.querySelector('.toast') as HTMLElement | null
const field = (id: string) => document.getElementById(id) as HTMLInputElement

const entry = (over: Record<string, unknown> = {}): DiaryEntry =>
  ({ id: 'e-1', date: '2026-06-10', meal: 'lunch', time: '12:30', name: 'Stew', calories: 600, protein: 30, carbs: 60, fat: 20, servings: 2, grams: 200, fiber: 5, futureField: { keep: 'me' }, createdAt: stamp, updatedAt: stamp, ...over }) as DiaryEntry
const yogurt = { id: 'f-1', name: 'Yogurt', serving: '1 cup', calories: 200, protein: 10, carbs: 20, fat: 6, createdAt: stamp, updatedAt: stamp } as Food

let store: DiaryEntry[]
let foods: Food[]

beforeEach(() => {
  // Wednesday 2026-06-10 at noon, so tomorrow is Thu, Jun 11.
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date(2026, 5, 10, 12, 0, 0))
  store = [entry()]
  foods = []
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  m.getEntries.mockImplementation(async () => store.map((item) => ({ ...item })))
  m.getFoods.mockImplementation(async () => foods.map((item) => ({ ...item })))
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(undefined)
  m.saveEntry.mockImplementation(async (item) => { store.push(item as DiaryEntry) })
  m.saveEntries.mockImplementation(async (items) => { store.push(...(items as DiaryEntry[])) })
  m.onDatabaseEvent.mockImplementation(() => () => undefined)
  m.onLocalChange.mockImplementation(() => () => undefined)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

async function renderApp() {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
  return user
}
type User = Awaited<ReturnType<typeof renderApp>>
const copyDate = () => screen.getByLabelText('Copy to date') as HTMLInputElement
const submitCopy = (user: User) => user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Copy' }))
const openRowCopy = async (user: User, name = 'Stew') => { await user.click(first(`Copy ${name} to another day`)); await screen.findByRole('dialog') }
const openDayCopy = async (user: User) => { await user.click(first(/Copy day to/)); await screen.findByRole('dialog') }

describe('copy one entry', () => {
  it('defaults_to_tomorrow_when_the_entry_is_today', async () => {
    const user = await renderApp()
    await openRowCopy(user)
    expect(copyDate().value).toBe('2026-06-11')
  })

  it('defaults_to_today_when_the_entry_is_on_another_day', async () => {
    store = [entry({ date: '2026-06-09' })]
    const user = await renderApp()
    await user.click(screen.getByRole('button', { name: 'Previous day' }))
    await openRowCopy(user)
    expect(copyDate().value).toBe('2026-06-10')
  })

  it('creates_a_new_entry_with_a_new_id_and_keeps_nutrients_servings_and_unknown_fields', async () => {
    const user = await renderApp()
    await openRowCopy(user)
    await submitCopy(user)
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    const copy = m.saveEntry.mock.calls[0][0] as DiaryEntry & Record<string, unknown>
    expect(copy.id).not.toBe('e-1')
    expect(copy.id).toBeTruthy()
    expect(copy).toMatchObject({ name: 'Stew', date: '2026-06-11', meal: 'lunch', time: '12:30', calories: 600, protein: 30, carbs: 60, fat: 20, servings: 2, grams: 200, fiber: 5, futureField: { keep: 'me' } })
    expect(copy.createdAt).not.toBe(stamp)
    expect(copy.updatedAt).toBe(copy.createdAt)
  })

  it('uses_the_chosen_meal_date_and_time', async () => {
    const user = await renderApp()
    await openRowCopy(user)
    fireEvent.change(copyDate(), { target: { value: '2026-06-20' } })
    await user.selectOptions(screen.getByLabelText('Meal'), 'breakfast')
    fireEvent.change(screen.getByLabelText(/^Time/), { target: { value: '07:05' } })
    await submitCopy(user)
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(m.saveEntry.mock.calls[0][0]).toMatchObject({ date: '2026-06-20', meal: 'breakfast', time: '07:05' })
  })

  it('drops_the_time_when_it_is_cleared', async () => {
    const user = await renderApp()
    await openRowCopy(user)
    fireEvent.change(screen.getByLabelText(/^Time/), { target: { value: '' } })
    await submitCopy(user)
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(m.saveEntry.mock.calls[0][0]).not.toHaveProperty('time')
  })

  it('leaves_the_original_untouched_and_shows_both_and_a_toast', async () => {
    const user = await renderApp()
    await openRowCopy(user)
    await submitCopy(user)
    await waitFor(() => expect(toast()?.textContent).toContain('Copied to Thu, Jun 11.'))
    expect(m.saveEntry).toHaveBeenCalledTimes(1)
    expect(m.deleteEntry).not.toHaveBeenCalled()
    expect(store[0]).toEqual(entry())
    expect(screen.queryByRole('dialog')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Next day' }))
    expect(await screen.findAllByText('Stew')).toBeTruthy()
  })

  it('copies_a_planned_entry_as_planned', async () => {
    store = [entry({ planned: true })]
    const user = await renderApp()
    await openRowCopy(user)
    await submitCopy(user)
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(m.saveEntry.mock.calls[0][0]).toMatchObject({ planned: true })
  })

  it('shows_an_error_toast_and_keeps_the_dialog_when_the_save_fails', async () => {
    m.saveEntry.mockRejectedValue(new Error('disk full'))
    const user = await renderApp()
    await openRowCopy(user)
    await submitCopy(user)
    await waitFor(() => expect(toast()?.textContent).toContain('That entry could not be copied. Try again.'))
    expect(toast()?.className).toContain('error')
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(store).toHaveLength(1)
  })
})

describe('copy a day', () => {
  const day = () => [
    entry({ id: 'a', name: 'Eggs', meal: 'breakfast' }),
    entry({ id: 'b', name: 'Salad', meal: 'lunch', futureField: 'x' }),
    entry({ id: 'p', name: 'Planned pie', meal: 'dinner', planned: true }),
    entry({ id: 'y', name: 'Other day food', date: '2026-06-09' }),
  ]

  it('copies_only_eaten_entries_of_the_viewed_day_in_one_atomic_save', async () => {
    store = day()
    const user = await renderApp()
    await openDayCopy(user)
    expect(copyDate().value).toBe('2026-06-11')
    expect(screen.getByText(/2 eaten foods will be copied/)).toBeTruthy()
    await submitCopy(user)
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalledTimes(1))
    expect(m.saveEntry).not.toHaveBeenCalled()
    const saved = m.saveEntries.mock.calls[0][0] as Array<DiaryEntry & Record<string, unknown>>
    expect(saved.map((item) => item.name).sort()).toEqual(['Eggs', 'Salad'])
    expect(saved.every((item) => item.date === '2026-06-11' && !item.planned)).toBe(true)
    expect(new Set(saved.map((item) => item.id)).size).toBe(2)
    expect(saved.some((item) => ['a', 'b'].includes(item.id))).toBe(false)
    expect(saved.find((item) => item.name === 'Salad')).toMatchObject({ meal: 'lunch', futureField: 'x', servings: 2, fiber: 5 })
    await waitFor(() => expect(toast()?.textContent).toContain('Copied 2 foods to Thu, Jun 11.'))
    expect(store.filter((item) => ['a', 'b', 'p', 'y'].includes(item.id))).toHaveLength(4)
  })

  it('uses_the_singular_in_the_toast_for_one_food', async () => {
    store = [entry({ id: 'a', name: 'Eggs' })]
    const user = await renderApp()
    await openDayCopy(user)
    await submitCopy(user)
    await waitFor(() => expect(toast()?.textContent).toContain('Copied 1 food to Thu, Jun 11.'))
  })

  it('defaults_to_today_when_viewing_another_day', async () => {
    store = [entry({ id: 'y', name: 'Old', date: '2026-06-09' })]
    const user = await renderApp()
    await user.click(screen.getByRole('button', { name: 'Previous day' }))
    await openDayCopy(user)
    expect(copyDate().value).toBe('2026-06-10')
  })

  it('rejects_the_same_date_without_saving', async () => {
    store = day()
    const user = await renderApp()
    await openDayCopy(user)
    fireEvent.change(copyDate(), { target: { value: '2026-06-10' } })
    await submitCopy(user)
    expect(screen.getByRole('alert').textContent).toContain('Choose a different day')
    expect(m.saveEntries).not.toHaveBeenCalled()
  })

  it('disables_Copy_day_to_when_the_day_has_only_planned_foods', async () => {
    store = [entry({ planned: true })]
    await renderApp()
    expect((first(/Copy day to/) as HTMLButtonElement).disabled).toBe(true)
  })

  it('asks_before_adding_to_a_day_that_already_has_eaten_food_and_stops_on_no', async () => {
    store = [...day(), entry({ id: 't', name: 'Tomorrow lunch', date: '2026-06-11' })]
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = await renderApp()
    await openDayCopy(user)
    await submitCopy(user)
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(confirm.mock.calls[0][0]).toContain('Add 2 foods')
    expect(m.saveEntries).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('copies_after_the_user_confirms', async () => {
    store = [...day(), entry({ id: 't', name: 'Tomorrow lunch', date: '2026-06-11' })]
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = await renderApp()
    await openDayCopy(user)
    await submitCopy(user)
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalledTimes(1))
  })

  it('does_not_ask_when_the_target_day_only_has_planned_food', async () => {
    store = [...day(), entry({ id: 't', name: 'Planned tomorrow', date: '2026-06-11', planned: true })]
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = await renderApp()
    await openDayCopy(user)
    await submitCopy(user)
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalledTimes(1))
    expect(confirm).not.toHaveBeenCalled()
  })

  it('does_not_ask_for_an_empty_target_day', async () => {
    store = day()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = await renderApp()
    await openDayCopy(user)
    await submitCopy(user)
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalledTimes(1))
    expect(confirm).not.toHaveBeenCalled()
  })

  it('shows_an_error_toast_and_adds_nothing_when_the_save_rejects', async () => {
    store = day()
    const before = store.length
    m.saveEntries.mockRejectedValue(new Error('quota'))
    const user = await renderApp()
    await openDayCopy(user)
    await submitCopy(user)
    await waitFor(() => expect(toast()?.textContent).toContain('That day could not be copied. Nothing was added.'))
    expect(toast()?.className).toContain('error')
    expect(store).toHaveLength(before)
    expect(m.saveEntry).not.toHaveBeenCalled()
  })

  it('submitting_twice_quickly_saves_once', async () => {
    store = day()
    let release: () => void = () => undefined
    m.saveEntries.mockImplementation(() => new Promise<void>((resolve) => { release = resolve }))
    const user = await renderApp()
    await openDayCopy(user)
    const form = copyDate().closest('form') as HTMLFormElement
    fireEvent.submit(form)
    fireEvent.submit(form)
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalledTimes(1))
    release()
    await user.click(screen.getByRole('button', { name: 'Previous day' }))
  })
})

describe('log by target in the logger', () => {
  it('saved_food_mode_sets_the_servings_through_the_stepper', async () => {
    foods = [yogurt]
    store = []
    const user = await renderApp()
    await user.click(first('Foods'))
    await user.click(await screen.findByRole('button', { name: 'Log' }))
    await screen.findByLabelText('Servings')
    const dialog = screen.getByRole('dialog')
    await user.selectOptions(within(dialog).getByLabelText('Log by target nutrient'), 'protein')
    fireEvent.change(within(dialog).getByLabelText('Target amount'), { target: { value: '25' } })
    expect(within(dialog).getByText('That is 2.5 servings.')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Set amount' }))
    expect(field('entry-servings').value).toBe('2.5')
    expect(field('entry-calories').value).toBe('500')
    expect(field('entry-protein').value).toBe('25')
    await user.click(screen.getByRole('button', { name: 'Add to diary' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(m.saveEntry.mock.calls[0][0]).toMatchObject({ servings: 2.5, calories: 500, protein: 25 })
  })

  it('saved_food_mode_leaves_out_a_nutrient_the_food_has_none_of', async () => {
    foods = [{ ...yogurt, fat: 0 }]
    store = []
    const user = await renderApp()
    await user.click(first('Foods'))
    await user.click(await screen.findByRole('button', { name: 'Log' }))
    const select = (await screen.findByLabelText('Log by target nutrient')) as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['calories', 'protein', 'carbs'])
  })

  it('catalog_mode_sets_grams_to_one_decimal', async () => {
    store = []
    const user = await renderApp()
    await user.click(first('Log food'))
    await user.type(await screen.findByPlaceholderText(/Search foods/), 'oats')
    await user.click(await screen.findByRole('button', { name: /Rolled oats/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Target amount'), { target: { value: '100.07' } })
    // 100.07 kcal at 2 kcal per gram is 50.035 g, kept to one decimal.
    expect(within(dialog).getByText('That is 50 g.')).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText('Target amount'), { target: { value: '301' } })
    await user.click(within(dialog).getByRole('button', { name: 'Set amount' }))
    expect(field('entry-grams').value).toBe('150.5')
    expect(screen.queryByLabelText('Servings')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Add to diary' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    expect(m.saveEntry.mock.calls[0][0]).toMatchObject({ grams: 150.5, calories: 301, catalogId: 'usda-oats' })
    expect(m.saveEntry.mock.calls[0][0]).not.toHaveProperty('servings')
  })
})
