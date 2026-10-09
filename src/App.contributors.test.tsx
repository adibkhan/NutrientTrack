// Nutrient contributors panel on Trends.
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry, Settings } from './types'

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
let n = 0
const entry = (over: Record<string, unknown> = {}): DiaryEntry =>
  ({ id: `e-${++n}`, date: '2026-06-10', meal: 'lunch', name: 'Food', calories: 100, protein: 10, carbs: 10, fat: 1, createdAt: stamp, updatedAt: stamp, ...over }) as DiaryEntry

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date(2026, 5, 10, 12, 0, 0))
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(undefined)
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

async function openTrends(entries: DiaryEntry[], settings?: Settings) {
  m.getEntries.mockResolvedValue(entries)
  m.getSettings.mockResolvedValue(settings)
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
  await user.click(first('Trends'))
  const panel = (await screen.findByRole('heading', { name: 'Nutrient contributors' })).closest('section') as HTMLElement
  return { user, panel }
}
const goals = (over: Record<string, unknown>) => ({ id: 'profile', goals: { weightUnit: 'lb', ...over }, updatedAt: stamp }) as Settings

describe('Nutrient contributors panel', () => {
  it('renders_after_the_nutrition_insights_panel', async () => {
    const { panel } = await openTrends([entry()])
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    const at = headings.indexOf('Nutrient contributors')
    expect(at).toBeGreaterThan(0)
    expect(panel.previousElementSibling?.className).toContain('nutrition-insights')
  })

  it('says_nothing_is_logged_for_an_empty_diary_in_each_range', async () => {
    const { user, panel } = await openTrends([])
    expect(within(panel).getByText('No food logged in the last 30 days.')).toBeTruthy()
    await user.click(within(panel).getByRole('button', { name: 'Contributors, last 7 days' }))
    expect(within(panel).getByText('No food logged in the last 7 days.')).toBeTruthy()
    await user.click(within(panel).getByRole('button', { name: 'Contributors, last 90 days' }))
    expect(within(panel).getByText('No food logged in the last 90 days.')).toBeTruthy()
  })

  it('defaults_to_30_days_with_aria_pressed_and_switches', async () => {
    const { user, panel } = await openTrends([entry()])
    const b = (d: number) => within(panel).getByRole('button', { name: `Contributors, last ${d} days` })
    expect(b(30).getAttribute('aria-pressed')).toBe('true')
    expect(b(7).getAttribute('aria-pressed')).toBe('false')
    await user.click(b(90))
    expect(b(90).getAttribute('aria-pressed')).toBe('true')
    expect(b(30).getAttribute('aria-pressed')).toBe('false')
  })

  it('applies_the_window_boundaries_ending_today', async () => {
    // 7-day window with today = Jun 10 starts Jun 4 (inclusive); Jun 3 is outside.
    const entries = [entry({ date: '2026-06-04', name: 'Edge', calories: 700 }), entry({ date: '2026-06-03', name: 'Outside', calories: 7000 })]
    const { user, panel } = await openTrends(entries)
    await user.click(within(panel).getByRole('button', { name: 'Contributors, last 7 days' }))
    expect(within(panel).getByText('Edge')).toBeTruthy()
    expect(within(panel).queryByText('Outside')).toBeNull()
    expect(panel.querySelector('.contributor-average')?.textContent).toMatch(/^700 kcal per logged day/)
    await user.click(within(panel).getByRole('button', { name: 'Contributors, last 30 days' }))
    expect(within(panel).getByText('Outside')).toBeTruthy()
  })

  it('excludes_planned_foods', async () => {
    const { panel } = await openTrends([entry({ name: 'Eaten' }), entry({ name: 'Planned', planned: true, calories: 5000 })])
    expect(within(panel).getByText('Eaten')).toBeTruthy()
    expect(within(panel).queryByText('Planned')).toBeNull()
  })

  it('reports_not_recorded_foods_instead_of_counting_them_as_zero', async () => {
    const { user, panel } = await openTrends([entry({ fiber: 8, name: 'Beans' }), entry({ name: 'Rice' })])
    await user.selectOptions(within(panel).getByLabelText('Nutrient'), 'fiber')
    expect(panel.querySelector('.contributor-average')?.textContent).toMatch(/^8 g per logged day/)
    expect(panel.textContent).toContain('Counts the 1 of 2 foods that recorded fiber.')
    expect(within(panel).queryByText('Rice')).toBeNull()
  })

  it('shows_a_message_when_no_logged_food_recorded_the_nutrient', async () => {
    const { user, panel } = await openTrends([entry()])
    await user.selectOptions(within(panel).getByLabelText('Nutrient'), 'sodium')
    expect(within(panel).getByText('None of the foods logged in the last 30 days recorded sodium.')).toBeTruthy()
    expect(panel.querySelector('.contributor-average')).toBeNull()
  })

  it('merges_same_names_and_folds_beyond_five_into_Everything_else', async () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F']
    const entries = [...names.map((name, i) => entry({ name, calories: 100 - i * 10 })), entry({ name: 'a', calories: 1 })]
    const { panel } = await openTrends(entries)
    const rows = Array.from(panel.querySelectorAll('.contributor-row')).map((row) => row.querySelector('span')?.textContent)
    expect(rows).toEqual(['A', 'B', 'C', 'D', 'E', 'Everything else'])
    const pct = Array.from(panel.querySelectorAll('.contributor-row strong')).map((s) => Number(s.textContent?.replace('%', '')))
    expect(Math.abs(pct.reduce((a, b) => a + b, 0) - 100)).toBeLessThanOrEqual(3)
  })

  it('splits_by_meal', async () => {
    const { panel } = await openTrends([entry({ meal: 'breakfast', calories: 300 }), entry({ meal: 'dinner', calories: 100 })])
    const rows = Array.from(panel.querySelectorAll('.stat-row')).map((r) => r.textContent)
    expect(rows).toEqual(['Breakfast75%', 'Dinner25%'])
  })

  it.each([['calories', 'Goal 2,000 kcal.'], ['protein', 'Goal 120 g.'], ['carbs', 'Goal 250 g.'], ['fat', 'Goal 70 g.']])('shows_the_%s_goal', async (key, text) => {
    const { user, panel } = await openTrends([entry({ fiber: 3, sugar: 3 })], goals({ calories: 2000, protein: 120, carbs: 250, fat: 70 }))
    await user.selectOptions(within(panel).getByLabelText('Nutrient'), key)
    expect(panel.querySelector('.metric-subtext')?.textContent).toContain(text)
  })

  it.each(['fiber', 'sugar', 'satFat', 'sodium', 'cholesterol'])('shows_no_goal_for_%s', async (key) => {
    const { user, panel } = await openTrends([entry({ fiber: 3, sugar: 3, satFat: 1, sodium: 100, cholesterol: 10 })], goals({ calories: 2000 }))
    await user.selectOptions(within(panel).getByLabelText('Nutrient'), key)
    expect(panel.querySelector('.metric-subtext')?.textContent).not.toContain('Goal')
  })

  it('lists_every_nutrient_with_dashes_for_unknown_averages_and_goals', async () => {
    const { panel } = await openTrends([entry({ fiber: 4 })], goals({ calories: 2000 }))
    const rows = Array.from(panel.querySelectorAll('tbody tr'))
    expect(rows).toHaveLength(9)
    const cells = (label: string) => Array.from(rows.find((r) => r.querySelector('th')?.textContent === label)!.querySelectorAll('td')).map((td) => td.textContent)
    expect(cells('Calories')).toEqual(['100 kcal', '2,000 kcal'])
    expect(cells('Fiber')).toEqual(['4 g', '—'])
    expect(cells('Sodium')).toEqual(['—', '—'])
    expect(cells('Protein')).toEqual(['10 g', '—'])
  })

  it('never_prints_NaN_undefined_or_Infinity', async () => {
    const { user, panel } = await openTrends([entry({ calories: 0, protein: 0 }), entry({ meal: 'snack', fat: 0 })])
    for (const key of ['calories', 'protein', 'fat', 'sodium']) {
      await user.selectOptions(within(panel).getByLabelText('Nutrient'), key)
      expect(panel.textContent).not.toMatch(/NaN|undefined|Infinity/)
    }
  })

  it('never_prints_NaN_undefined_or_Infinity_for_an_empty_diary', async () => {
    const { panel } = await openTrends([])
    expect(panel.textContent).not.toMatch(/NaN|undefined|Infinity/)
  })
})
