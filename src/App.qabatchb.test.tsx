// QA batch B: entry caps and rounding, name length, calorie-driven macro scaling, planned future days, inline weigh-in replace,
// welcome estimate hand-off, estimator labels, accessible names and rounded rows.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry, WeightEntry } from './types'
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
const field = (id: string) => document.getElementById(id) as HTMLInputElement
const banana = (over: Record<string, unknown> = {}): DiaryEntry =>
  ({ id: 'e-1', date: todayISO(), meal: 'snack', name: 'Banana', calories: 105, protein: 1.3, carbs: 27, fat: 0.4, fiber: 3, grams: 118, createdAt: stamp, updatedAt: stamp, futureField: 'keep', ...over }) as DiaryEntry

let entries: DiaryEntry[]
let weights: WeightEntry[]

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  localStorage.clear()
  entries = []
  weights = []
  m.getEntries.mockImplementation(async () => entries)
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockImplementation(async () => weights)
  m.getSettings.mockResolvedValue({ id: 'profile', goals: { weightUnit: 'lb' }, preferences: { welcomed: true }, updatedAt: stamp } as never)
  m.saveEntry.mockResolvedValue(undefined)
  m.saveWeight.mockResolvedValue(undefined)
  m.saveSettings.mockResolvedValue(undefined)
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

async function boot() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
  return user
}
async function openManual() {
  const user = await boot()
  await user.click(first('Log food'))
  await user.click(await screen.findByRole('button', { name: /Manual quick add/ }))
  await screen.findByLabelText('Food or meal name')
  return user
}
const saved = () => {
  expect(m.saveEntry).toHaveBeenCalledTimes(1)
  return m.saveEntry.mock.calls[0][0] as DiaryEntry & Record<string, unknown>
}
async function openEdit(name = 'Banana') {
  const user = await boot()
  await user.click(first(new RegExp(`^Edit ${name}\\b`)))
  await screen.findByLabelText('Food or meal name')
  return user
}

describe('numeric caps', () => {
  it('blocks_calories_over_10000_with_an_inline_message', async () => {
    const user = await openManual()
    fireEvent.change(field('entry-name'), { target: { value: 'Huge' } })
    fireEvent.change(field('entry-calories'), { target: { value: '1000000000' } })
    await user.click(screen.getByRole('button', { name: 'Add to diary' }))
    expect(await screen.findByText("That's more than 10000 kcal for one entry. Check the number.")).toBeTruthy()
    expect(field('entry-calories').getAttribute('aria-invalid')).toBe('true')
    expect(m.saveEntry).not.toHaveBeenCalled()
  })

  it('blocks_a_macro_over_1000_g_and_a_nutrient_over_its_cap', async () => {
    const user = await openManual()
    fireEvent.change(field('entry-name'), { target: { value: 'Huge' } })
    fireEvent.change(field('entry-calories'), { target: { value: '500' } })
    fireEvent.change(field('entry-protein'), { target: { value: '1001' } })
    await user.click(screen.getByRole('button', { name: 'Add to diary' }))
    expect(await screen.findByText("That's more than 1000 g of protein for one entry. Check the number.")).toBeTruthy()
    fireEvent.change(field('entry-protein'), { target: { value: '30' } })
    fireEvent.change(field('entry-sodium'), { target: { value: '100001' } })
    await user.click(screen.getByRole('button', { name: 'Add to diary' }))
    expect(await screen.findByText(/more than 100000 mg of sodium/)).toBeTruthy()
    expect(m.saveEntry).not.toHaveBeenCalled()
  })

  it('blocks_an_edit_that_goes_over_the_cap_and_keeps_the_modal_open', async () => {
    entries = [banana()]
    const user = await openEdit()
    fireEvent.change(field('entry-calories'), { target: { value: '10001' } })
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText(/more than 10000 kcal/)).toBeTruthy()
    expect(m.saveEntry).not.toHaveBeenCalled()
  })

  it('stores_calories_and_macros_to_one_decimal', async () => {
    const user = await openManual()
    fireEvent.change(field('entry-name'), { target: { value: 'Odd' } })
    fireEvent.change(field('entry-calories'), { target: { value: '101.84' } })
    fireEvent.change(field('entry-protein'), { target: { value: '12.26' } })
    await user.click(screen.getByRole('button', { name: 'Add to diary' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalled())
    expect(saved()).toMatchObject({ calories: 101.8, protein: 12.3 })
  })
})

describe('names', () => {
  it('caps_the_name_input_at_120_characters_and_trims_on_save', async () => {
    const user = await openManual()
    expect(field('entry-name').maxLength).toBe(120)
    fireEvent.change(field('entry-name'), { target: { value: `  ${'a'.repeat(130)}  ` } })
    fireEvent.change(field('entry-calories'), { target: { value: '100' } })
    await user.click(screen.getByRole('button', { name: 'Add to diary' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalled())
    expect(saved().name).toBe('a'.repeat(120))
  })
})

describe('editing calories', () => {
  it('scales_macros_nutrients_and_grams_when_only_calories_change', async () => {
    entries = [banana()]
    const user = await openEdit()
    fireEvent.change(field('entry-calories'), { target: { value: '210' } })
    expect(screen.getByText('Macros scale with calories.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalled())
    expect(saved()).toMatchObject({ calories: 210, protein: 2.6, carbs: 54, fat: 0.8, fiber: 6, grams: 236, futureField: 'keep' })
  })

  it('keeps_hand_edited_macros_and_hides_the_hint', async () => {
    entries = [banana()]
    const user = await openEdit()
    fireEvent.change(field('entry-calories'), { target: { value: '210' } })
    fireEvent.change(field('entry-carbs'), { target: { value: '30' } })
    expect(screen.queryByText('Macros scale with calories.')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalled())
    expect(saved()).toMatchObject({ calories: 210, protein: 1.3, carbs: 30, fat: 0.4 })
  })

  it('shows_rounded_values_in_the_edit_fields', async () => {
    entries = [banana({ calories: 101.83, protein: 4.449 })]
    await openEdit()
    expect(field('entry-calories').value).toBe('101.8')
    expect(field('entry-protein').value).toBe('4.4')
  })

  it('does_not_rewrite_numbers_when_only_the_name_changes', async () => {
    entries = [banana({ calories: 101.83 })]
    const user = await openEdit()
    fireEvent.change(field('entry-name'), { target: { value: 'Big banana' } })
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalled())
    expect(saved()).toMatchObject({ name: 'Big banana', calories: 101.83 })
  })
})

describe('future days', () => {
  it('defaults_planned_on_and_the_meal_from_the_clock_for_a_future_date', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 5, 10, 19, 30))
    const user = await openManual()
    fireEvent.change(field('entry-date'), { target: { value: shiftDate(todayISO(), 2) } })
    const planned = screen.getByRole('checkbox', { name: /Planned, not eaten yet/ }) as HTMLInputElement
    expect(planned.checked).toBe(true)
    expect((screen.getByRole('radio', { name: 'Dinner' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.change(field('entry-date'), { target: { value: todayISO() } })
    expect(planned.checked).toBe(false)
    expect(user).toBeTruthy()
  })

  it('uses_the_clock_meal_on_a_past_day_too', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 5, 10, 8, 15))
    const user = await boot()
    await user.click(first('Previous day'))
    await user.click(first('Log food'))
    await user.click(await screen.findByRole('button', { name: /Manual quick add/ }))
    expect((await screen.findByRole('radio', { name: 'Breakfast' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: /Planned, not eaten yet/ }) as HTMLInputElement).checked).toBe(false)
  })
})

describe('same-day weigh-in', () => {
  const open = async () => {
    weights = [{ id: 'w-1', date: todayISO(), weight: 82.4, unit: 'kg', createdAt: stamp, updatedAt: stamp } as WeightEntry]
    const user = await boot()
    await user.click(first('Trends'))
    await screen.findByRole('heading', { name: 'Expenditure' })
    await user.click(first('Log weight'))
    const dialog = await screen.findByRole('dialog')
    await user.clear(within(dialog).getByLabelText('Weight'))
    await user.type(within(dialog).getByLabelText('Weight'), '81.9')
    await user.click(within(dialog).getByRole('button', { name: 'Save check-in' }))
    return { user, dialog }
  }

  it('asks_inline_and_keeps_the_modal_and_values_on_cancel_without_a_success_toast', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    const { user, dialog } = await open()
    expect(await within(dialog).findByText('You already logged 82.4 kg today. Replace it?')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect((within(dialog).getByLabelText('Weight') as HTMLInputElement).value).toBe('81.9')
    expect(m.saveWeight).not.toHaveBeenCalled()
    expect(screen.queryByText('Weight entry saved.')).toBeNull()
    expect(confirm).not.toHaveBeenCalled()
  })

  it('replaces_the_weigh_in_after_Replace', async () => {
    const { user, dialog } = await open()
    await user.click(await within(dialog).findByRole('button', { name: 'Replace' }))
    await waitFor(() => expect(m.saveWeight).toHaveBeenCalledTimes(1))
    expect(m.saveWeight.mock.calls[0][0]).toMatchObject({ id: 'w-1', weight: 81.9 })
  })
})

describe('welcome estimate link', () => {
  it('saves_the_typed_unit_and_calories_and_opens_the_estimator_expanded', async () => {
    m.getSettings.mockResolvedValue(undefined)
    const user = await boot()
    await user.click(screen.getByRole('button', { name: 'kg, ml' }))
    await user.type(screen.getByLabelText(/Daily energy goal/), '2100')
    await user.click(screen.getByRole('button', { name: /Estimate a starting target/ }))
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalled())
    expect(m.saveSettings.mock.calls[0][0]).toMatchObject({ goals: { weightUnit: 'kg', calories: 2100 } })
    expect(await screen.findByLabelText("Age")).toBeTruthy()
    expect((field('goal-calories')).value).toBe('2100')
    expect((document.querySelector('.starting-estimate') as HTMLDetailsElement).open).toBe(true)
  })
})

describe('estimator inputs', () => {
  it('shows_unit_suffixes_and_example_placeholders', async () => {
    m.getSettings.mockResolvedValue({ id: 'profile', goals: { weightUnit: 'kg' }, preferences: { welcomed: true }, updatedAt: stamp } as never)
    const user = await boot()
    await user.click(first('Settings'))
    await user.click(await screen.findByText(/Estimate a starting target/))
    expect(field('est-age').placeholder).toBe('e.g. 35')
    expect(field('est-height').placeholder).toMatch(/^e\.g\./)
    const box = document.querySelector('.starting-estimate') as HTMLElement
    expect(box.querySelectorAll('.input-with-suffix span[aria-hidden]')[1]?.textContent).toBe('cm')
    expect(box.querySelectorAll('.input-with-suffix span[aria-hidden]')[2]?.textContent).toBe('kg')
  })
})

describe('accessible names and rows', () => {
  it('names_each_meal_add_button_and_the_search_box', async () => {
    const user = await boot()
    for (const meal of ['Breakfast', 'Lunch', 'Dinner', 'Snacks']) expect(screen.getAllByRole('button', { name: `Add to ${meal}` }).length).toBeGreaterThan(0)
    await user.click(first('Log food'))
    expect(await screen.findByRole('textbox', { name: 'Search foods' })).toBeTruthy()
  })

  it('rounds_row_calories_to_whole_numbers_and_macros_to_whole_grams', async () => {
    entries = [banana({ calories: 101.8, protein: 24.6, carbs: 3.26, fat: 12.4 })]
    await boot()
    const row = screen.getAllByText('Banana')[0].closest('.entry-row') as HTMLElement
    expect(row.querySelector('.entry-calories strong')?.textContent).toBe('102')
    expect(row.querySelector('.entry-macros-full')?.textContent).toBe('25g protein · 3.3g carbs · 12g fat')
  })
})

describe('manual quick add after picking a saved food', () => {
  it('starts_with_empty_numbers_so_typing_does_not_append', async () => {
    m.getFoods.mockResolvedValue([{ id: 'f-oats', name: 'Oats bowl', serving: '1 bowl', calories: 300, protein: 10, carbs: 50, fat: 6, createdAt: stamp, updatedAt: stamp } as never])
    const user = await boot()
    await user.click(first('Log food'))
    await user.type(await screen.findByRole('textbox', { name: 'Search foods' }), 'Oats')
    await user.click(await within(screen.getByRole('dialog')).findByRole('button', { name: /Oats bowl.*kcal/ }))
    await waitFor(() => expect(field('entry-calories')?.value).toBe('300'))
    await user.click(screen.getByRole('button', { name: /Back to food search/ }))
    await user.click(await screen.findByRole('button', { name: /Manual quick add/ }))
    expect(field('entry-calories').value).toBe('')
    expect(field('entry-protein').value).toBe('')
    await user.type(field('entry-calories'), '120')
    expect(field('entry-calories').value).toBe('120')
  })
})
