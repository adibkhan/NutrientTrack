// First-run welcome, undo on delete, the weekly recap, food pictures and the meals ring.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
const today = todayISO()
const yesterday = shiftDate(today, -1)
const stamp = '2026-01-01T00:00:00.000Z'
let seq = 0
const entry = (date: string, meal: DiaryEntry['meal'], over: Partial<DiaryEntry> = {}): DiaryEntry =>
  ({ id: `e-${seq++}`, date, meal, name: `Food ${seq}`, calories: 100, protein: 1, carbs: 1, fat: 1, createdAt: stamp, updatedAt: stamp, ...over })
const settings = (preferences: Record<string, unknown>): Settings => ({ id: 'profile', goals: { weightUnit: 'lb' }, preferences, updatedAt: stamp } as Settings)

let entries: DiaryEntry[]
// Past the first-run welcome, so the diary shows Pip's everyday strip.
const welcomed = () => settings({ welcomed: true })
beforeEach(() => {
  entries = []
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  localStorage.clear()
  m.getEntries.mockImplementation(async () => entries)
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(welcomed())
  m.saveEntries.mockImplementation(async (copies) => { entries = [...entries, ...copies] })
  m.saveSettings.mockResolvedValue(undefined)
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
const welcome = () => screen.queryByRole('region', { name: 'Hi, I’m Pip!' })

describe('first-run welcome', () => {
  it('shows_only_on_a_brand_new_device', async () => {
    m.getSettings.mockResolvedValue(undefined)
    await renderApp()
    expect(await screen.findByRole('region', { name: 'Hi, I’m Pip!' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Pip, your logging buddy' })).toBeNull()
  })

  it('stays_away_once_there_is_data_or_settings', async () => {
    m.getSettings.mockResolvedValue(undefined)
    entries = [entry(yesterday, 'lunch')]
    await renderApp()
    expect(welcome()).toBeNull()
    cleanup()
    entries = []
    m.getSettings.mockResolvedValue(welcomed())
    await renderApp()
    expect(welcome()).toBeNull()
  })

  it('saves_the_answers_as_goals_and_marks_the_welcome_done', async () => {
    m.getSettings.mockResolvedValue(undefined)
    const user = await renderApp()
    await screen.findByRole('region', { name: 'Hi, I’m Pip!' })
    await user.click(screen.getByRole('button', { name: 'kg, ml' }))
    await user.type(screen.getByLabelText(/Daily energy goal/), '2100')
    await user.type(screen.getByLabelText(/Daily protein goal/), '130')
    await user.click(screen.getByRole('button', { name: 'Start logging' }))
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    const saved = m.saveSettings.mock.calls[0][0] as Settings
    expect(saved.goals).toEqual({ weightUnit: 'kg', calories: 2100, protein: 130 })
    expect(saved.preferences?.welcomed).toBe(true)
    await waitFor(() => expect(welcome()).toBeNull())
  })

  it('skips_without_setting_any_goal', async () => {
    m.getSettings.mockResolvedValue(undefined)
    const user = await renderApp()
    await user.click(await screen.findByRole('button', { name: 'Skip setup' }))
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    const saved = m.saveSettings.mock.calls[0][0] as Settings
    expect(saved.goals.calories).toBeUndefined()
    expect(saved.goals.protein).toBeUndefined()
    expect(saved.preferences?.welcomed).toBe(true)
  })
})

describe('delete with undo', () => {
  it('deletes_without_a_confirm_dialog_and_undo_saves_the_same_record_back', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    const soup = entry(today, 'lunch', { name: 'Tomato soup', futureField: 'kept' } as Partial<DiaryEntry>)
    entries = [soup]
    m.deleteEntry.mockImplementation(async () => { entries = [] })
    m.saveEntry.mockImplementation(async (record) => { entries = [record] })
    const user = await renderApp()
    await user.click(screen.getByRole('button', { name: /Delete Tomato soup/ }))
    await waitFor(() => expect(m.deleteEntry).toHaveBeenCalledWith(soup.id))
    expect(confirm).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalledTimes(1))
    const restored = m.saveEntry.mock.calls[0][0] as DiaryEntry & { futureField?: string }
    expect(restored).toMatchObject({ id: soup.id, name: 'Tomato soup', createdAt: soup.createdAt, futureField: 'kept' })
    expect(restored.updatedAt > soup.updatedAt).toBe(true)
    expect(await screen.findByText('Tomato soup')).toBeTruthy()
  })
})

describe('weekly recap', () => {
  it('summarises_the_last_seven_days_on_trends', async () => {
    entries = [entry(today, 'lunch', { calories: 600, protein: 40 }), entry(yesterday, 'dinner', { calories: 800, protein: 60 })]
    const user = await renderApp()
    await user.click(screen.getAllByRole('button', { name: 'Trends' })[0])
    const card = await screen.findByRole('region', { name: 'Your week' })
    expect(within(card).getByLabelText('2 of 7 days logged')).toBeTruthy()
    expect(within(card).getByText('700 kcal')).toBeTruthy()
    expect(within(card).getByText('50 g')).toBeTruthy()
    expect((within(card).getByRole('button', { name: 'Share recap' }) as HTMLButtonElement).disabled).toBe(false)
    expect(within(card).getByText('Pip is sprout')).toBeTruthy()
    expect(within(card).getByText('1 more to seedling')).toBeTruthy()
  })
})

describe('Pip grows', () => {
  it('shows_its_stage_under_the_figure_on_the_diary', async () => {
    m.getSettings.mockResolvedValue(welcomed())
    entries = Array.from({ length: 8 }, (_, index) => entry(shiftDate(today, -index - 1), 'lunch'))
    await renderApp()
    const strip = screen.getByRole('region', { name: 'Pip, your logging buddy' })
    expect(within(strip).getByText('Budding').getAttribute('title')).toBe('6 more logged days to blooming')
    expect(strip.querySelector('.pip-bud')).not.toBeNull()
  })
})

describe('food pictures and the meals ring', () => {
  it('draws_a_family_picture_next_to_saved_foods', async () => {
    m.getFoods.mockResolvedValue([{ id: 'f', name: 'Banana', serving: '1 medium', calories: 105, protein: 1, carbs: 27, fat: 0, createdAt: stamp, updatedAt: stamp }])
    await renderApp()
    const button = await screen.findByRole('button', { name: /Banana/ })
    expect(button.querySelector('.food-avatar')?.getAttribute('data-kind')).toBe('fruit')
  })

  it('counts_logged_meals_when_there_is_no_calorie_goal', async () => {
    entries = [entry(today, 'breakfast'), entry(today, 'dinner'), entry(today, 'lunch', { planned: true })]
    await renderApp()
    const ring = document.querySelector('.progress-ring') as HTMLElement
    expect(ring.getAttribute('aria-label')).toBe('2 of 4 meals logged')
    expect(ring.querySelectorAll('.ring-segment.filled')).toHaveLength(2)
  })
})

describe('phone gestures', () => {
  it('a_quick_swipe_left_opens_the_row_actions_and_a_swipe_right_closes_them', async () => {
    m.getSettings.mockResolvedValue(welcomed())
    entries = [entry(today, 'lunch', { name: 'Tomato soup' })]
    await renderApp()
    const row = screen.getByText('Tomato soup').closest('.entry-row') as HTMLElement
    const touch = (type: string, x: number) => fireEvent[type === 'start' ? 'touchStart' : 'touchEnd'](row, { touches: [{ clientX: x, clientY: 100 }], changedTouches: [{ clientX: x, clientY: 100 }] })
    touch('start', 200); touch('end', 120)
    expect(row.classList.contains('is-open')).toBe(true)
    touch('start', 120); touch('end', 200)
    expect(row.classList.contains('is-open')).toBe(false)
    // A mostly vertical move is a scroll, not a swipe.
    fireEvent.touchStart(row, { touches: [{ clientX: 200, clientY: 100 }] })
    fireEvent.touchEnd(row, { changedTouches: [{ clientX: 150, clientY: 190 }] })
    expect(row.classList.contains('is-open')).toBe(false)
  })

  it('dragging_the_sheet_handle_down_closes_the_dialog', async () => {
    m.getSettings.mockResolvedValue(welcomed())
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await renderApp()
    await user.click(screen.getAllByRole('button', { name: 'Log food' })[0])
    const dialog = await screen.findByRole('dialog')
    const grip = dialog.querySelector('.sheet-grip') as HTMLElement
    fireEvent.touchStart(grip, { touches: [{ clientX: 100, clientY: 100 }] })
    fireEvent.touchMove(grip, { touches: [{ clientX: 100, clientY: 260 }] })
    expect(dialog.style.transform).toBe('translateY(160px)')
    fireEvent.touchEnd(grip, { changedTouches: [{ clientX: 100, clientY: 260 }] })
    await vi.advanceTimersByTimeAsync(200)
    expect(screen.queryByRole('dialog')).toBeNull()
    vi.useRealTimers()
  })
})
