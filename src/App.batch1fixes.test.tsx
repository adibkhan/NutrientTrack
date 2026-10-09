// App-level regressions for the first review batch: finished-day expenditure and check-in, repeat meal, same-day weigh-ins,
// measurement moves, and grams that scale with servings.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BodyMeasurement, DiaryEntry, Settings, WeightEntry } from './types'
import { formatShortDate, shiftDate, todayISO } from './lib/utils'

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
const today = todayISO()
const ago = (offset: number) => shiftDate(today, -offset)
const first = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]
const toast = () => document.querySelector('.toast') as HTMLElement | null
type User = ReturnType<typeof userEvent.setup>

let seq = 0
type Extra = Record<string, unknown>
const eaten = (date: string, calories: number, extra: Extra = {}): DiaryEntry =>
  ({ id: `e-${seq++}`, date, meal: 'lunch', name: 'Food', calories, protein: 0, carbs: 0, fat: 0, createdAt: stamp, updatedAt: stamp, ...extra }) as DiaryEntry
const weigh = (date: string, weight: number, extra: Extra = {}): WeightEntry => ({ id: `w-${date}-${weight}`, date, weight, unit: 'lb', createdAt: stamp, ...extra }) as WeightEntry
const settingsRecord = (program: unknown): Settings =>
  ({ id: 'profile', goals: { weightUnit: 'lb', calories: 2000, protein: 150 }, program, updatedAt: stamp }) as unknown as Settings

let stored: Settings | undefined

beforeEach(() => {
  seq = 0
  stored = undefined
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  localStorage.clear()
  m.getEntries.mockResolvedValue([])
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockImplementation(async () => stored)
  m.getWaterLogs.mockResolvedValue([])
  m.getMeasurements.mockResolvedValue([])
  m.saveSettings.mockResolvedValue(undefined)
  m.saveEntry.mockResolvedValue(undefined)
  m.saveEntries.mockResolvedValue(undefined)
  m.saveWeight.mockResolvedValue(undefined)
  m.saveMeasurement.mockResolvedValue(undefined)
  m.deleteMeasurement.mockResolvedValue(undefined)
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
async function openTrends() {
  const user = await renderApp()
  await user.click(first('Trends'))
  await screen.findByRole('heading', { name: 'Expenditure' })
  return user
}

describe('1. Trends expenditure and check-in count finished days only', () => {
  // 26 full days at 2000 kcal ending yesterday, flat weight, 7 weigh-ins over 24 days.
  const fullDays = () => Array.from({ length: 26 }, (_, i) => eaten(ago(i + 1), 2000))
  const flatWeights = () => [25, 21, 17, 13, 9, 5, 1].map((o) => weigh(ago(o), 180))
  const metric = () => document.querySelector('.metric-value')?.textContent ?? ''

  it('does not change the Expenditure card when a partial entry is added today', async () => {
    m.getEntries.mockResolvedValue(fullDays())
    m.getWeights.mockResolvedValue(flatWeights())
    await openTrends()
    expect(metric()).toMatch(/^2,?000/)
    cleanup()

    m.getEntries.mockResolvedValue([...fullDays(), eaten(today, 400, { meal: 'breakfast' })])
    await openTrends()
    expect(metric()).toMatch(/^2,?000/)
  })

  it('does not change the Settings program budget when a partial entry is added today', async () => {
    stored = settingsRecord({ direction: 'lose', weeklyRate: 1 })
    m.getEntries.mockResolvedValue([...fullDays(), eaten(today, 400, { meal: 'breakfast' })])
    m.getWeights.mockResolvedValue(flatWeights())
    const user = await renderApp()
    await user.click(first('Settings'))
    await screen.findByRole('heading', { name: 'Program' })
    // Expenditure 2000, minus 500 a day for 1 lb a week.
    expect(screen.getByText('Resulting budget').nextElementSibling?.textContent).toMatch(/^1,?500 kcal/)
  })

  // Check-in due today: the weekday is today's, with a long steady history and a partial entry today.
  const dueProgram = { direction: 'lose', weeklyRate: 1, checkInDay: new Date().getDay(), futureField: 'pf' }
  const steady = () => [...Array.from({ length: 40 }, (_, i) => eaten(ago(i + 1), 2300)), eaten(today, 400, { meal: 'breakfast' })]
  const steadyWeights = () => Array.from({ length: 16 }, (_, i) => weigh(ago(i * 3 + 1), 180))

  it('stores lastCheckIn as the check-in day itself on Accept, and the card then goes away', async () => {
    stored = settingsRecord(dueProgram)
    m.getEntries.mockResolvedValue(steady())
    m.getWeights.mockResolvedValue(steadyWeights())
    const user = await openTrends()
    expect(screen.getByRole('heading', { name: 'Weekly check-in' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /Accept new budget/ }))
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    const saved = m.saveSettings.mock.calls[0][0] as unknown as Record<string, any>
    expect(saved.program.lastCheckIn).toBe(today)
    expect(saved.program.futureField).toBe('pf')
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Weekly check-in' })).toBeNull())
  })

  it('also stops being due after Keep', async () => {
    stored = settingsRecord(dueProgram)
    m.getEntries.mockResolvedValue(steady())
    m.getWeights.mockResolvedValue(steadyWeights())
    const user = await openTrends()
    await user.click(screen.getByRole('button', { name: /Keep current budget/ }))
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    expect((m.saveSettings.mock.calls[0][0] as unknown as Record<string, any>).program.lastCheckIn).toBe(today)
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Weekly check-in' })).toBeNull())
  })
})

describe('3. Repeat previous meal skips planned entries', () => {
  const repeat = () => screen.getByRole('button', { name: 'Repeat previous dinner' }) as HTMLButtonElement
  const copies = () => m.saveEntries.mock.calls[0][0] as Array<DiaryEntry & Extra>
  const dinner = (date: string, name: string, extra: Extra = {}) => eaten(date, 500, { meal: 'dinner', name, ...extra })

  it('uses an earlier eaten dinner when the latest dinner is only planned', async () => {
    m.getEntries.mockResolvedValue([dinner(ago(3), 'Eaten stew'), dinner(ago(1), 'Planned pasta', { planned: true })])
    const user = await renderApp()
    await user.click(repeat())
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalledTimes(1))
    expect(copies().map((c) => c.name)).toEqual(['Eaten stew'])
    await waitFor(() => expect(toast()?.textContent).toContain(`Repeated dinner from ${formatShortDate(ago(3))}.`))
  })

  it('disables Repeat when every earlier dinner is planned, so nothing can be copied', async () => {
    m.getEntries.mockResolvedValue([dinner(ago(1), 'Planned pasta', { planned: true })])
    const user = await renderApp()
    expect(repeat()).toHaveProperty('disabled', true)
    await user.click(repeat())
    expect(m.saveEntries).not.toHaveBeenCalled()
  })

  it('copies eaten entries from the source day but not its planned ones, keeping unknown fields', async () => {
    m.getEntries.mockResolvedValue([
      dinner(ago(2), 'Eaten rice', { futureField: { keep: 'me' } }),
      dinner(ago(2), 'Planned fish', { planned: true }),
    ])
    const user = await renderApp()
    await user.click(repeat())
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalledTimes(1))
    const [copy, ...rest] = copies()
    expect(rest).toHaveLength(0)
    expect(copy).toMatchObject({ name: 'Eaten rice', date: today, meal: 'dinner', futureField: { keep: 'me' } })
    expect(copy.id).not.toBe('e-0')
  })
})

describe('4. Same-day weigh-ins', () => {
  const dialog = () => screen.findByRole('dialog')
  const logWeight = async (user: User, value: string, date?: string, extra?: { unit?: string }) => {
    await user.click(first('Log weight'))
    const d = await dialog()
    if (date) fireEvent.change(within(d).getByLabelText('Date'), { target: { value: date } })
    await user.clear(within(d).getByLabelText('Weight'))
    await user.type(within(d).getByLabelText('Weight'), value)
    if (extra?.unit) fireEvent.change(within(d).getByLabelText('Unit'), { target: { value: extra.unit } })
    await user.click(within(d).getByRole('button', { name: 'Save check-in' }))
  }
  const existing = () => weigh(today, 180, { id: 'w-existing', note: 'old', futureField: { keep: 'me' } })

  it('replaces the weigh-in on that date after confirmation, keeping its id, createdAt and unknown fields', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    m.getWeights.mockResolvedValue([existing()])
    const user = await renderApp()
    await user.click(first('Trends'))
    await logWeight(user, '81.5', today, { unit: 'kg' })
    await waitFor(() => expect(m.saveWeight).toHaveBeenCalledTimes(1))
    const saved = m.saveWeight.mock.calls[0][0] as WeightEntry & Extra
    expect(saved).toMatchObject({ id: 'w-existing', createdAt: stamp, date: today, weight: 81.5, unit: 'kg', futureField: { keep: 'me' } })
    expect(saved).not.toHaveProperty('note')
    await waitFor(() => expect(toast()?.textContent).toContain(`Replaced the weigh-in for ${formatShortDate(today)}.`))
  })

  it('keeps the plain updated message and id when editing an existing entry', async () => {
    m.getWeights.mockResolvedValue([existing()])
    const user = await renderApp()
    await user.click(first('Trends'))
    await user.click(await screen.findByRole('button', { name: `Edit weight from ${formatShortDate(today)}` }))
    const d = await dialog()
    await user.clear(within(d).getByLabelText('Weight'))
    await user.type(within(d).getByLabelText('Weight'), '178')
    await user.click(within(d).getByRole('button', { name: 'Save check-in' }))
    await waitFor(() => expect(m.saveWeight).toHaveBeenCalledTimes(1))
    expect(m.saveWeight.mock.calls[0][0]).toMatchObject({ id: 'w-existing', weight: 178, createdAt: stamp })
    await waitFor(() => expect(toast()?.textContent).toContain('Weight entry updated.'))
  })

  it('adds a new row for a different date', async () => {
    m.getWeights.mockResolvedValue([existing()])
    const user = await renderApp()
    await user.click(first('Trends'))
    await logWeight(user, '179', ago(1))
    await waitFor(() => expect(m.saveWeight).toHaveBeenCalledTimes(1))
    const saved = m.saveWeight.mock.calls[0][0] as WeightEntry
    expect(saved.id).not.toBe('w-existing')
    expect(saved).toMatchObject({ date: ago(1), weight: 179 })
    await waitFor(() => expect(toast()?.textContent).toContain('Weight entry saved.'))
  })

  it('shows the later of two same-date records first in the log, with the trend moved onto it', async () => {
    const early = weigh(ago(2), 180, { id: 'early', createdAt: '2026-03-10T07:00:00.000Z' })
    const late = weigh(ago(2), 182, { id: 'late', createdAt: '2026-03-10T20:00:00.000Z' })
    m.getWeights.mockResolvedValue([late, early]) // storage order is not log order
    const user = await renderApp()
    await user.click(first('Trends'))
    await waitFor(() => expect(document.querySelectorAll('.weight-row').length).toBe(2))
    const rows = Array.from(document.querySelectorAll('.weight-row'))
    expect(rows[0].textContent).toContain('182 lb')
    expect(rows[1].textContent).toContain('180 lb')
    expect(rows[1].querySelector('.weight-trend')?.textContent).toMatch(/^180 lb/)
    expect(rows[0].querySelector('.weight-trend')?.textContent).toContain('180.2')
  })
})

describe('5. Moving a body measurement check-in', () => {
  const rec = (date: string, extra: Extra = {}): BodyMeasurement => ({ id: date, date, unit: 'in', waist: 34, createdAt: stamp, updatedAt: stamp, ...extra }) as BodyMeasurement
  const A = '2026-03-01'
  const B = '2026-03-05'
  const openTrendsWithMeasurements = async () => {
    const user = await renderApp()
    await user.click(first('Trends'))
    await screen.findByRole('heading', { name: 'Body measurements' })
    return user
  }
  const openEdit = async (date: string) => {
    const user = await openTrendsWithMeasurements()
    await user.click(await screen.findByRole('button', { name: new RegExp(`^Edit measurements from ${formatShortDate(date)}`) }))
    return { user, d: await screen.findByRole('dialog') }
  }
  const moveTo = async (user: User, d: HTMLElement, date: string) => {
    fireEvent.change(within(d).getByLabelText(/^Date/), { target: { value: date } })
    await user.click(within(d).getByRole('button', { name: 'Save check-in' }))
  }

  it('asks before replacing an existing day and saves nothing when declined', async () => {
    m.getMeasurements.mockResolvedValue([rec(A), rec(B, { waist: 36 })])
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user, d } = await openEdit(A)
    await moveTo(user, d, B)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(m.saveMeasurement).not.toHaveBeenCalled()
    expect(m.deleteMeasurement).not.toHaveBeenCalled()
  })

  it('saves the new record and deletes the old id when the replacement is accepted', async () => {
    m.getMeasurements.mockResolvedValue([rec(A), rec(B, { waist: 36 })])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { user, d } = await openEdit(A)
    await moveTo(user, d, B)
    await waitFor(() => expect(m.deleteMeasurement).toHaveBeenCalledWith(A))
    expect(m.saveMeasurement).toHaveBeenCalledTimes(1)
    expect(m.saveMeasurement.mock.calls[0][0]).toMatchObject({ id: B, date: B })
  })

  it('does not ask when the edit keeps its date', async () => {
    m.getMeasurements.mockResolvedValue([rec(A), rec(B, { waist: 36 })])
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user, d } = await openEdit(A)
    await user.click(within(d).getByRole('button', { name: 'Save check-in' }))
    await waitFor(() => expect(m.saveMeasurement).toHaveBeenCalledTimes(1))
    expect(confirm).not.toHaveBeenCalled()
    expect(m.deleteMeasurement).not.toHaveBeenCalled()
  })

  it('does not ask when the edit moves to a day with no record', async () => {
    m.getMeasurements.mockResolvedValue([rec(A)])
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user, d } = await openEdit(A)
    await moveTo(user, d, B)
    await waitFor(() => expect(m.deleteMeasurement).toHaveBeenCalledWith(A))
    expect(confirm).not.toHaveBeenCalled()
  })

  it('does not ask for a new check-in', async () => {
    m.getMeasurements.mockResolvedValue([rec(today)])
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = await openTrendsWithMeasurements()
    await user.click(screen.getByRole('button', { name: 'Log measurements' }))
    const d = await screen.findByRole('dialog')
    await user.type(within(d).getByLabelText(/^Waist/), '33')
    await user.click(within(d).getByRole('button', { name: 'Save check-in' }))
    await waitFor(() => expect(m.saveMeasurement).toHaveBeenCalledTimes(1))
    expect(confirm).not.toHaveBeenCalled()
  })

  it('refreshes, closes the dialog and reports the old check-in when deleting it fails', async () => {
    m.getMeasurements.mockResolvedValue([rec(A)])
    m.deleteMeasurement.mockRejectedValue(new Error('disk'))
    const { user, d } = await openEdit(A)
    const before = m.getMeasurements.mock.calls.length
    await moveTo(user, d, B)
    await waitFor(() => expect(m.getMeasurements.mock.calls.length).toBeGreaterThan(before))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(m.saveMeasurement).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(toast()?.textContent).toMatch(/old check-in could not be removed/))
    expect(toast()?.className).toMatch(/error/)
  })
})

describe('6. Grams scale with servings for an entry without a catalog link', () => {
  const field = (id: string) => document.getElementById(id) as HTMLInputElement
  const bar = (extra: Extra = {}) => eaten(ago(1), 150, { name: 'Protein bar', protein: 20, carbs: 10, fat: 5, grams: 40, ...extra })
  const pick = async () => {
    const user = await renderApp()
    await user.click(first('Log food'))
    const d = await screen.findByRole('dialog')
    await user.click(await within(d).findByRole('button', { name: /^Protein bar/ }))
    await screen.findByLabelText('Servings')
    return user
  }
  const saved = () => {
    expect(m.saveEntry).toHaveBeenCalledTimes(1)
    return m.saveEntry.mock.calls[0][0] as DiaryEntry & Extra
  }
  const add = (user: User) => user.click(screen.getByRole('button', { name: 'Add to diary' }))

  it('keeps 40 g at one serving', async () => {
    m.getEntries.mockResolvedValue([bar()])
    const user = await pick()
    await add(user)
    expect(saved()).toMatchObject({ grams: 40, calories: 150 })
  })

  it('doubles grams, calories and macros at 2 servings', async () => {
    m.getEntries.mockResolvedValue([bar()])
    const user = await pick()
    fireEvent.change(field('entry-servings'), { target: { value: '2' } })
    expect(field('entry-calories').value).toBe('300')
    await add(user)
    expect(saved()).toMatchObject({ grams: 80, calories: 300, protein: 40, carbs: 20, fat: 10, servings: 2 })
  })

  it('reopens an entry stored as 2 servings of 80 g at stepper 2 and 80 g, then 3 gives 120 g', async () => {
    m.getEntries.mockResolvedValue([bar({ servings: 2, grams: 80, calories: 300, protein: 40, carbs: 20, fat: 10 })])
    const user = await pick()
    expect(field('entry-servings').value).toBe('2')
    expect(field('entry-calories').value).toBe('300')
    fireEvent.change(field('entry-servings'), { target: { value: '3' } })
    expect(field('entry-calories').value).toBe('450')
    await add(user)
    expect(saved()).toMatchObject({ grams: 120, calories: 450, servings: 3 })
  })

  it('saves 80 g unchanged when reopened at 2 servings and not touched', async () => {
    m.getEntries.mockResolvedValue([bar({ servings: 2, grams: 80, calories: 300 })])
    const user = await pick()
    await add(user)
    expect(saved()).toMatchObject({ grams: 80, servings: 2, calories: 300 })
  })

  it('never gains a grams key for an entry without grams', async () => {
    m.getEntries.mockResolvedValue([bar({ grams: undefined })])
    const user = await pick()
    fireEvent.change(field('entry-servings'), { target: { value: '2' } })
    await add(user)
    expect(saved()).toMatchObject({ calories: 300, servings: 2 })
    expect(saved()).not.toHaveProperty('grams')
  })
})
