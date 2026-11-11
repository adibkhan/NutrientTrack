// Uneven calorie days: the Settings disclosure under the calorie goal, the diary summary, and records from other builds.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry, Settings } from './types'
import { dateFromISO, todayISO } from './lib/utils'

vi.mock('./lib/db', () => ({
  getWaterLogs: vi.fn(() => Promise.resolve([])), getSymptoms: vi.fn(() => Promise.resolve([])), saveSymptom: vi.fn(), deleteSymptom: vi.fn(), getMeasurements: vi.fn(() => Promise.resolve([])), saveWaterLog: vi.fn(), deleteWaterLog: vi.fn(), saveMeasurement: vi.fn(), deleteMeasurement: vi.fn(),
  deleteEntry: vi.fn(), deleteFood: vi.fn(), deleteWeight: vi.fn(), exportBackup: vi.fn(), clearAllData: vi.fn(),
  getEntries: vi.fn(), getFoods: vi.fn(), getSettings: vi.fn(), getWeights: vi.fn(), importBackup: vi.fn(),
  requestPersistentStorage: vi.fn(), onDatabaseEvent: vi.fn(() => () => undefined), onLocalChange: vi.fn(() => () => undefined),
  saveEntries: vi.fn(), saveEntry: vi.fn(), saveFood: vi.fn(), saveSettings: vi.fn(), saveWeight: vi.fn(), saveEntriesAndWeights: vi.fn(),
}))

import * as db from './lib/db'
import App from './App'

const m = vi.mocked(db)
const stamp = '2026-01-01T00:00:00.000Z'
const first = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]
const record = (goals: Record<string, unknown>, extra: Record<string, unknown> = {}): Settings =>
  ({ id: 'profile', goals: { weightUnit: 'lb', ...goals }, preferences: { welcomed: true }, updatedAt: stamp, ...extra }) as unknown as Settings
const todayWeekday = () => dateFromISO(todayISO()).getDay()
const shiftOnToday = (delta: number) => { const shift = Array(7).fill(0); shift[todayWeekday()] = delta; shift[(todayWeekday() + 1) % 7] = -delta; return shift }

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  localStorage.clear()
  m.getEntries.mockResolvedValue([])
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(record({ calories: 2100 }))
  m.saveSettings.mockImplementation(async (next) => next)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

async function openGoals() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
  await user.click(first('Settings'))
  const summary = await screen.findByText('Shift calories across the week')
  await user.click(summary)
  return user
}
const row = (day: string) => screen.getByLabelText(`${day} kcal`) as HTMLInputElement
const lastSaved = () => m.saveSettings.mock.calls.at(-1)?.[0] as Settings & { goals: Record<string, unknown> }

describe('Shift calories across the week', () => {
  it('shows_seven_days_at_the_goal_and_a_balanced_total', async () => {
    await openGoals()
    for (const day of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) expect(row(day).value).toBe('2100')
    expect(screen.getByText(/Weekly total unchanged: 14,700 kcal/)).toBeTruthy()
  })

  it('plus_and_minus_move_a_day_by_50_and_flag_an_unbalanced_week_until_balanced', async () => {
    const user = await openGoals()
    await user.click(screen.getByRole('button', { name: '50 more kcal on Saturday' }))
    expect(row('Saturday').value).toBe('2150')
    expect(screen.getByText(/Weekly total is 14,750 kcal, not 14,700/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Save goals' }))
    expect(await screen.findByText(/add up to 50 kcal more/)).toBeTruthy()
    expect(m.saveSettings).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /Balance/ }))
    expect(screen.getByText(/Weekly total unchanged: 14,700 kcal/)).toBeTruthy()
    expect(row('Saturday').value).toBe('2150')
    await user.click(screen.getByRole('button', { name: 'Save goals' }))
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    const shift = lastSaved().goals.calorieShift as number[]
    expect(shift).toHaveLength(7)
    expect(shift.reduce((a, b) => a + b, 0)).toBe(0)
    expect(shift[6]).toBe(50)
    expect(lastSaved().goals.calories).toBe(2100)
  })

  it('accepts_a_typed_kcal_for_a_day_using_comma_decimals_and_refuses_a_day_under_1200', async () => {
    const user = await openGoals()
    await user.clear(row('Sunday'))
    await user.type(row('Sunday'), '1100')
    await user.clear(row('Monday'))
    await user.type(row('Monday'), '3100')
    await user.click(screen.getByRole('button', { name: 'Save goals' }))
    expect(await screen.findByText(/Sunday would be under 1,200 kcal/)).toBeTruthy()
    expect(m.saveSettings).not.toHaveBeenCalled()
    await user.clear(row('Sunday'))
    await user.type(row('Sunday'), '1200,5')
    expect(row('Sunday').value).toBe('1200,5')
  })

  it('the_higher_weekends_preset_then_save_stores_the_deltas_and_reset_clears_them', async () => {
    const user = await openGoals()
    await user.click(screen.getByRole('button', { name: 'Higher weekends' }))
    expect(row('Saturday').value).toBe('2310')
    expect(row('Sunday').value).toBe('2310')
    expect(row('Wednesday').value).toBe('2020')
    expect(screen.getByText(/Weekly total unchanged: 14,700 kcal/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Save goals' }))
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    expect(lastSaved().goals.calorieShift).toEqual([210, -90, -90, -80, -80, -80, 210])
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(row('Saturday').value).toBe('2100')
    await user.click(screen.getByRole('button', { name: 'Save goals' }))
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(2))
    expect(lastSaved().goals).not.toHaveProperty('calorieShift')
  })

  it('needs_a_calorie_goal_first', async () => {
    m.getSettings.mockResolvedValue(record({}))
    await openGoals()
    expect(screen.getByText(/Enter a calorie goal above to shift it/)).toBeTruthy()
    expect(screen.queryByLabelText('Sunday kcal')).toBeNull()
  })

  it('opens_with_the_stored_shift_and_keeps_it_through_a_goals_save_that_changes_only_protein', async () => {
    const stored = [210, -90, -90, -80, -80, -80, 210]
    m.getSettings.mockResolvedValue(record({ calories: 2100, calorieShift: stored, protein: 150, futureGoal: { keep: 1 } }, { futureField: 'x' }))
    const user = await openGoals()
    expect(row('Saturday').value).toBe('2310')
    await user.clear((document.getElementById('goal-protein') as HTMLInputElement))
    await user.type((document.getElementById('goal-protein') as HTMLInputElement), '160')
    await user.click(screen.getByRole('button', { name: 'Save goals' }))
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    expect(lastSaved().goals).toMatchObject({ calories: 2100, protein: 160, calorieShift: stored, futureGoal: { keep: 1 } })
    expect((lastSaved() as unknown as Record<string, unknown>).futureField).toBe('x')
  })
})

describe('records written by another build', () => {
  it('a_preferences_edit_by_this_build_keeps_the_shift_and_unknown_goal_fields', async () => {
    const stored = [210, -90, -90, -80, -80, -80, 210]
    m.getSettings.mockResolvedValue(record({ calories: 2100, calorieShift: stored, futureGoal: 1 }))
    const user = userEvent.setup()
    render(<App />)
    await screen.findAllByRole('button', { name: 'Log food' })
    await user.click(first('Settings'))
    await screen.findByRole('heading', { name: 'Preferences' })
    await user.selectOptions(screen.getByLabelText('Theme'), 'dark')
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalled())
    expect(lastSaved().goals).toEqual({ weightUnit: 'lb', calories: 2100, calorieShift: stored, futureGoal: 1 })
  })

  it('ignores_a_stored_shift_that_does_not_sum_to_zero_and_shows_the_plain_goal', async () => {
    m.getSettings.mockResolvedValue(record({ calories: 2100, calorieShift: [500, 0, 0, 0, 0, 0, 0] }))
    m.getEntries.mockResolvedValue([{ id: 'e', name: 'x', date: todayISO(), meal: 'lunch', calories: 100, protein: 0, carbs: 0, fat: 0, createdAt: stamp, updatedAt: stamp }])
    render(<App />)
    await screen.findAllByRole('button', { name: 'Log food' })
    await waitFor(() => expect(screen.getByLabelText('Daily nutrition summary').textContent).toContain('100 of 2,100 kcal'))
  })
})

describe('diary summary uses the day target', () => {
  it('shows_left_and_over_against_the_target_for_the_day_being_viewed', async () => {
    const entry: DiaryEntry = { id: 'e', name: 'Lunch', date: todayISO(), meal: 'lunch', calories: 2200, protein: 0, carbs: 0, fat: 0, createdAt: stamp, updatedAt: stamp }
    m.getEntries.mockResolvedValue([entry])
    // Today's target is 2100 + 300 = 2400, so 200 kcal are left; on a -300 day the same lunch is 400 over.
    m.getSettings.mockResolvedValue(record({ calories: 2100, calorieShift: shiftOnToday(300) }))
    const { unmount } = render(<App />)
    await screen.findAllByRole('button', { name: 'Log food' })
    await waitFor(() => expect(screen.getByLabelText('Daily nutrition summary').textContent).toContain('2,200 of 2,400 kcal'))
    expect(within(screen.getByLabelText('Daily nutrition summary')).getByText('kcal left')).toBeTruthy()
    unmount()
    m.getSettings.mockResolvedValue(record({ calories: 2100, calorieShift: shiftOnToday(-300) }))
    render(<App />)
    await screen.findAllByRole('button', { name: 'Log food' })
    await waitFor(() => expect(screen.getByLabelText('Daily nutrition summary').textContent).toContain('2,200 of 1,800 kcal'))
    expect(within(screen.getByLabelText('Daily nutrition summary')).getByText('kcal over')).toBeTruthy()
  })
})

describe('review fixes', () => {
  const setCalories = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
    const input = document.getElementById('goal-calories') as HTMLInputElement
    await user.clear(input)
    if (text) await user.type(input, text)
  }
  const stored = [900, -150, -150, -150, -150, -150, -150]

  it('lowering_the_goal_reduces_the_shift_to_keep_every_day_at_1200_and_says_so', async () => {
    m.getSettings.mockResolvedValue(record({ calories: 2100, calorieShift: stored }))
    const user = await openGoals()
    await setCalories(user, '1300')
    await user.click(screen.getByRole('button', { name: 'Save goals' }))
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    const shift = lastSaved().goals.calorieShift as number[]
    expect(shift.reduce((a, b) => a + b, 0)).toBe(0)
    expect(Math.min(...shift) + 1300).toBeGreaterThanOrEqual(1200)
    expect(await screen.findByText(/Your weekday shift was reduced to keep every day at 1,200 kcal or more/)).toBeTruthy()
  })

  it('clearing_the_goal_with_a_saved_shift_saves_and_drops_the_shift_with_a_note', async () => {
    m.getSettings.mockResolvedValue(record({ calories: 2100, calorieShift: stored }))
    const user = await openGoals()
    await setCalories(user, '')
    await user.click(screen.getByRole('button', { name: 'Save goals' }))
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    expect(lastSaved().goals).not.toHaveProperty('calorieShift')
    expect(lastSaved().goals.calories ?? undefined).toBeUndefined()
    expect(await screen.findByText(/shift was removed because there is no calorie goal/)).toBeTruthy()
  })

  it('a_shift_this_build_cannot_read_survives_saving_other_goals_with_no_calorie_goal', async () => {
    m.getSettings.mockResolvedValue(record({ protein: 100, calorieShift: [1, 2, 3] }))
    const user = await openGoals().catch(async () => userEvent.setup())
    const protein = document.getElementById('goal-protein') as HTMLInputElement
    await user.clear(protein)
    await user.type(protein, '120')
    await user.click(screen.getByRole('button', { name: 'Save goals' }))
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    expect(lastSaved().goals).toMatchObject({ protein: 120, calorieShift: [1, 2, 3] })
  })

  it('the_disclosure_stays_open_while_editing_a_day', async () => {
    const user = await openGoals()
    const details = screen.getByText('Shift calories across the week').closest('details') as HTMLDetailsElement
    expect(details.open).toBe(true)
    await user.click(screen.getByRole('button', { name: '50 more kcal on Saturday' }))
    await user.click(screen.getByRole('button', { name: '50 fewer kcal on Monday' }))
    expect(details.open).toBe(true)
    await user.type(row('Sunday'), '0')
    expect(details.open).toBe(true)
  })

  it('an_ambiguous_row_gets_a_field_message_and_no_alert_per_keystroke', async () => {
    const user = await openGoals()
    await user.clear(row('Sunday'))
    await user.type(row('Sunday'), '2,000')
    expect(screen.queryAllByRole('alert').filter((node) => node.closest('details'))).toHaveLength(0)
    const message = document.getElementById('shift-0-error')
    expect(message?.textContent ?? '').not.toBe('')
    expect(row('Sunday').getAttribute('aria-invalid')).toBe('true')
    expect(row('Sunday').getAttribute('aria-describedby')).toBe('shift-0-error')
  })

  it('the_imbalance_message_is_announced_through_a_status_region_after_a_step', async () => {
    const user = await openGoals()
    await user.click(screen.getByRole('button', { name: '50 more kcal on Saturday' }))
    const status = screen.getAllByRole('status').map((node) => node.textContent ?? '').join(' ')
    expect(status).toMatch(/14,750|50/)
  })
})
