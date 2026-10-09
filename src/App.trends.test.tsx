// Trends page: heading removed, Log weight moved into the Weight panel, smoothed trend weight,
// weight change figure, low/high bounds, collapsible check-in values and the 5-row weight log preview.
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings, WeightEntry } from './types'
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
const first = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]
const dayLabel = (daysAgo: number) => formatShortDate(shiftDate(todayISO(), -daysAgo))

const weightAt = (daysAgo: number, weight: number, unit: 'lb' | 'kg' = 'lb'): WeightEntry => ({
  id: `w${daysAgo}`, date: shiftDate(todayISO(), -daysAgo), weight, unit, createdAt: stamp,
})
const unitSettings = (weightUnit: 'lb' | 'kg'): Settings => ({ id: 'profile', goals: { weightUnit }, updatedAt: stamp }) as unknown as Settings

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  m.getEntries.mockResolvedValue([])
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

async function openTrends(weights: WeightEntry[] = [], settings?: Settings) {
  m.getWeights.mockResolvedValue(weights)
  if (settings) m.getSettings.mockResolvedValue(settings)
  const user = userEvent.setup()
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
  await user.click(first('Trends'))
  await screen.findByRole('group', { name: 'Trend range' })
  return user
}

const weightPanel = () => (screen.getByRole('heading', { name: /^(Last \d+ days|All time)$/ }).closest('section') as HTMLElement)
const logPanel = () => (screen.getByRole('heading', { name: 'Weight log' }).closest('section') as HTMLElement)
const change = () => document.querySelector('.chart-change') as HTMLElement
const changeText = () => change().textContent
const logRows = () => Array.from(document.querySelectorAll<HTMLElement>('.weight-row'))
const showAll = () => document.querySelector<HTMLButtonElement>('button.show-all')

describe('page heading and Log weight button', () => {
  it('no longer shows the "A longer view / Your trends" page heading', async () => {
    await openTrends([weightAt(5, 150), weightAt(1, 149)])
    expect(screen.queryByText('Your trends')).toBeNull()
    expect(screen.queryByText('A longer view')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Your trends' })).toBeNull()
  })

  it('puts Log weight in the Weight panel header and opens the weight dialog', async () => {
    const user = await openTrends([weightAt(5, 150), weightAt(1, 149)])
    const header = weightPanel().querySelector('.panel-header') as HTMLElement
    await user.click(within(header).getByRole('button', { name: 'Log weight' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Log weight' })).toBeTruthy()
  })

  it('does not put Log weight inside the Trend range group, which still holds exactly 7d, 30d, 90d, All', async () => {
    await openTrends([weightAt(5, 150), weightAt(1, 149)])
    const group = screen.getByRole('group', { name: 'Trend range' })
    expect(within(group).queryByRole('button', { name: /Log weight/ })).toBeNull()
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['7d', '30d', '90d', 'All'])
  })

  it('keeps a Log weight button when there are no weights, and it opens the dialog', async () => {
    const user = await openTrends([])
    const header = weightPanel().querySelector('.panel-header') as HTMLElement
    await user.click(within(header).getByRole('button', { name: 'Log weight' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })
})

describe('weight change figure', () => {
  it('shows a minus sign and the first plotted date for a loss', async () => {
    await openTrends([weightAt(20, 180), weightAt(2, 176.5)])
    expect(changeText()).toBe(`−3.5 lbsince ${dayLabel(20)}`)
    expect(changeText()).toContain('−')
    expect(changeText()).not.toContain('-')
  })

  it('shows a plus sign for a gain and rounds to 1 decimal', async () => {
    await openTrends([weightAt(20, 170), weightAt(2, 172.34)])
    expect(changeText()).toBe(`+2.3 lbsince ${dayLabel(20)}`)
  })

  it('shows no sign for exactly zero change', async () => {
    await openTrends([weightAt(20, 170), weightAt(2, 170)])
    expect(changeText()).toBe(`0 lbsince ${dayLabel(20)}`)
  })

  it('shows "0", not a signed zero, when a small loss rounds to zero', async () => {
    await openTrends([weightAt(20, 170.04), weightAt(2, 170)])
    expect(changeText()).toBe(`0 lbsince ${dayLabel(20)}`)
    expect(changeText()).not.toMatch(/[−+-]0/)
  })

  it('shows "0", not a signed zero, when a small gain rounds to zero', async () => {
    await openTrends([weightAt(20, 170), weightAt(2, 170.04)])
    expect(changeText()).toBe(`0 lbsince ${dayLabel(20)}`)
  })

  it('rounds a loss of exactly 0.25 away from zero to −0.3', async () => {
    await openTrends([weightAt(20, 180), weightAt(2, 179.75)])
    expect(changeText()).toBe(`−0.3 lbsince ${dayLabel(20)}`)
  })

  it('rounds a gain of exactly 0.25 away from zero to +0.3, matching the loss magnitude', async () => {
    await openTrends([weightAt(20, 179.75), weightAt(2, 180)])
    expect(changeText()).toBe(`+0.3 lbsince ${dayLabel(20)}`)
  })

  it('rounds a loss just under the midpoint (0.24) down to −0.2', async () => {
    await openTrends([weightAt(20, 180), weightAt(2, 179.76)])
    expect(changeText()).toBe(`−0.2 lbsince ${dayLabel(20)}`)
  })

  it('rounds a gain just under the midpoint (0.24) down to +0.2', async () => {
    await openTrends([weightAt(20, 179.76), weightAt(2, 180)])
    expect(changeText()).toBe(`+0.2 lbsince ${dayLabel(20)}`)
  })

  it('uses the latest minus the first entry inside the window, not the first ever', async () => {
    const user = await openTrends([weightAt(120, 200), weightAt(60, 190), weightAt(20, 180), weightAt(2, 170)])
    expect(changeText()).toBe(`−10 lbsince ${dayLabel(20)}`)
    await user.click(screen.getByRole('button', { name: '90d' }))
    expect(changeText()).toBe(`−20 lbsince ${dayLabel(60)}`)
    await user.click(screen.getByRole('button', { name: 'All' }))
    expect(changeText()).toBe(`−30 lbsince ${dayLabel(120)}`)
  })

  it('ignores a middle value: the change is latest minus first, not the largest swing', async () => {
    await openTrends([weightAt(20, 170), weightAt(10, 190), weightAt(2, 171)])
    expect(changeText()).toBe(`+1 lbsince ${dayLabel(20)}`)
  })

  it('converts kg entries to the lb display unit before computing the change', async () => {
    await openTrends([weightAt(20, 80, 'kg'), weightAt(2, 79, 'kg')], unitSettings('lb'))
    // 80 kg = 176.4 lb, 79 kg = 174.2 lb; change = -1 kg = -2.2046 lb
    expect(changeText()).toBe(`−2.2 lbsince ${dayLabel(20)}`)
    expect(screen.getByRole('img', { name: 'Weight trend from 174.2 to 176.4 lb' })).toBeTruthy()
  })

  it('converts lb entries to a kg display unit', async () => {
    await openTrends([weightAt(20, 200), weightAt(2, 220.46226218)], unitSettings('kg'))
    // 200 lb = 90.7 kg, 220.46 lb = 100 kg; change = +9.3 kg
    expect(changeText()).toBe(`+9.3 kgsince ${dayLabel(20)}`)
  })

  it('mixes units in one series and shows the display unit everywhere', async () => {
    await openTrends([weightAt(20, 100, 'kg'), weightAt(2, 220.46226218, 'lb')], unitSettings('lb'))
    expect(changeText()).toBe(`0 lbsince ${dayLabel(20)}`)
  })

  it('shows no change figure when there are fewer than two plotted check-ins', async () => {
    await openTrends([weightAt(2, 170)])
    expect(document.querySelector('.chart-change')).toBeNull()
    expect(screen.getByText('Add one more check-in.')).toBeTruthy()
  })

  it('shows the latest check-in value beside the change', async () => {
    await openTrends([weightAt(20, 180), weightAt(2, 176.5)])
    const summary = document.querySelector('.chart-summary') as HTMLElement
    expect(summary.textContent).toContain('176.5')
    expect(summary.textContent).toContain(`Latest check-in · ${dayLabel(2)}`)
  })
})

describe('low and high bounds and check-in values', () => {
  it('shows low and high of the plotted window with the unit', async () => {
    await openTrends([weightAt(25, 180), weightAt(15, 190.26), weightAt(2, 175.5)])
    expect((document.querySelector('.chart-bounds') as HTMLElement).textContent).toBe('Low 175.5 lb · High 190.3 lb')
  })

  it('shows equal low and high with a single distinct weight', async () => {
    await openTrends([weightAt(20, 170), weightAt(2, 170)])
    expect((document.querySelector('.chart-bounds') as HTMLElement).textContent).toBe('Low 170 lb · High 170 lb')
  })

  it('excludes entries outside the window from low and high', async () => {
    await openTrends([weightAt(120, 300), weightAt(20, 180), weightAt(2, 170)])
    expect((document.querySelector('.chart-bounds') as HTMLElement).textContent).toBe('Low 170 lb · High 180 lb')
  })

  it('shows bounds in the converted display unit', async () => {
    await openTrends([weightAt(20, 80, 'kg'), weightAt(2, 79, 'kg')], unitSettings('lb'))
    expect((document.querySelector('.chart-bounds') as HTMLElement).textContent).toBe('Low 174.2 lb · High 176.4 lb')
  })

  it('puts the check-in values in a collapsed details element with no "Accessible data:" prefix', async () => {
    await openTrends([weightAt(20, 180), weightAt(2, 176.5)])
    const details = document.querySelector('details.chart-data') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(details.querySelector('summary')?.textContent).toBe('View check-in values')
    const list = details.querySelector('p.chart-accessible') as HTMLElement
    expect(list.textContent).toBe(`${dayLabel(20)} 180 lb · ${dayLabel(2)} 176.5 lb.`)
    expect(screen.queryByText(/Accessible data:/)).toBeNull()
  })

  it('opens the check-in values when the summary is clicked', async () => {
    const user = await openTrends([weightAt(20, 180), weightAt(2, 176.5)])
    await user.click(screen.getByText('View check-in values'))
    expect((document.querySelector('details.chart-data') as HTMLDetailsElement).open).toBe(true)
  })

  it('lists only the entries in the selected window', async () => {
    const user = await openTrends([weightAt(60, 190), weightAt(20, 180), weightAt(2, 170)])
    expect((document.querySelector('.chart-accessible') as HTMLElement).textContent).not.toContain('190')
    await user.click(screen.getByRole('button', { name: '90d' }))
    expect((document.querySelector('.chart-accessible') as HTMLElement).textContent).toContain(`${dayLabel(60)} 190 lb`)
  })

  it('has no bounds or details in the empty and single-entry states', async () => {
    await openTrends([weightAt(2, 170)])
    expect(document.querySelector('.chart-bounds')).toBeNull()
    expect(document.querySelector('details.chart-data')).toBeNull()
  })
})

describe('weight log preview', () => {
  const series = (n: number) => Array.from({ length: n }, (_, i) => weightAt(n - i, 150 + i)) // oldest first

  it('shows no toggle and no rows for an empty log', async () => {
    await openTrends([])
    expect(showAll()).toBeNull()
    expect(logRows()).toHaveLength(0)
    expect(within(logPanel()).getByText('0 entries')).toBeTruthy()
  })

  it('shows no toggle with one entry and the singular badge', async () => {
    await openTrends(series(1))
    expect(showAll()).toBeNull()
    expect(logRows()).toHaveLength(1)
    expect(within(logPanel()).getByText('1 entry')).toBeTruthy()
  })

  it('shows all five rows and no toggle with exactly 5 check-ins', async () => {
    await openTrends(series(5))
    expect(logRows()).toHaveLength(5)
    expect(showAll()).toBeNull()
    expect(within(logPanel()).queryByText(/Show all|Show fewer/)).toBeNull()
  })

  it('shows 5 rows and a "Show all 6" toggle with exactly 6 check-ins', async () => {
    await openTrends(series(6))
    expect(logRows()).toHaveLength(5)
    expect(showAll()?.textContent).toBe('Show all 6')
    expect(showAll()?.getAttribute('aria-expanded')).toBe('false')
    expect(within(logPanel()).getByText('6 entries')).toBeTruthy()
  })

  it('lists the newest five first and hides the oldest in the preview', async () => {
    await openTrends(series(8))
    const dates = logRows().map((r) => r.querySelector('.weight-date')?.textContent)
    expect(dates).toEqual([1, 2, 3, 4, 5].map(dayLabel))
    expect(showAll()?.textContent).toBe('Show all 8')
  })

  it('expands to every check-in newest-first, then collapses back to five', async () => {
    const user = await openTrends(series(7))
    await user.click(showAll() as HTMLElement)
    expect(logRows().map((r) => r.querySelector('.weight-date')?.textContent)).toEqual([1, 2, 3, 4, 5, 6, 7].map(dayLabel))
    expect(showAll()?.textContent).toBe('Show fewer')
    expect(showAll()?.getAttribute('aria-expanded')).toBe('true')
    expect(within(logPanel()).getByText('7 entries')).toBeTruthy()
    await user.click(showAll() as HTMLElement)
    expect(logRows()).toHaveLength(5)
    expect(showAll()?.textContent).toBe('Show all 7')
    expect(showAll()?.getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps the badge on the total while the preview is collapsed', async () => {
    await openTrends(series(12))
    expect(logRows()).toHaveLength(5)
    expect(within(logPanel()).getByText('12 entries')).toBeTruthy()
  })

  it('orders newest-first even when the database returns entries out of date order', async () => {
    await openTrends([weightAt(3, 150), weightAt(9, 151), weightAt(1, 152), weightAt(5, 153)])
    expect(logRows().map((r) => r.querySelector('.weight-date')?.textContent)).toEqual([1, 3, 5, 9].map(dayLabel))
  })

  it('shows each row with its value in the entry unit', async () => {
    await openTrends([weightAt(2, 80, 'kg'), weightAt(1, 171.26)], unitSettings('lb'))
    const text = logRows().map((r) => r.textContent)
    expect(text[0]).toContain('171.3')
    expect(text[1]).toContain('80') // the log keeps each entry's own unit
    expect(text[1]).toContain('kg')
  })

  it('keeps edit and delete actions on visible rows only', async () => {
    await openTrends(series(6))
    expect(within(logPanel()).getAllByRole('button', { name: /^Edit weight from/ })).toHaveLength(5)
    expect(within(logPanel()).queryByRole('button', { name: `Edit weight from ${dayLabel(6)}` })).toBeNull()
  })
})

describe('trend weight', () => {
  // Each day since the previous reading moves the trend a tenth of the way (gap-aware): after 7 days, 1 - 0.9^7 = 52% of the way.
  it('shows the smoothed trend beside the latest check-in and a weekly rate', async () => {
    await openTrends([weightAt(7, 180), weightAt(0, 170)])
    const tile = document.querySelector('.chart-trend') as HTMLElement
    expect(tile.textContent).toBe('174.8 lbTrend · −5.2 lb/wk') // 180 + 0.5217 × (170 − 180) = 174.78, over 7 days
  })

  it('lists each check-in with its trend value in the entry unit, newest first', async () => {
    await openTrends([weightAt(2, 180), weightAt(1, 170), weightAt(0, 175)])
    const trends = logRows().map((r) => r.querySelector('.weight-trend')?.textContent)
    expect(trends).toEqual(['178.6 lb', '179 lb', '180 lb']) // 180 → 179 → 178.6
    expect((document.querySelector('.weight-table-head') as HTMLElement).textContent).toBe('DateScaleTrend')
  })

  it('carries the trend across unit changes by converting it to each entry’s own unit', async () => {
    await openTrends([weightAt(1, 100, 'kg'), weightAt(0, 220.46226218, 'lb')], unitSettings('lb'))
    const trends = logRows().map((r) => r.querySelector('.weight-trend')?.textContent)
    expect(trends).toEqual(['220.5 lb', '100 kg'])
  })

  it('keeps the plot in bounds when the window starts mid-trend', async () => {
    await openTrends([weightAt(60, 200), weightAt(50, 200), weightAt(20, 170), weightAt(2, 170)])
    expect((document.querySelector('.chart-bounds') as HTMLElement).textContent).toBe('Low 170 lb · High 170 lb')
    const trend = document.querySelector('.chart-trend-line') as SVGPolylineElement
    expect(trend.getAttribute('points')).toMatch(/^\S+ \S+$/)
    for (const y of (trend.getAttribute('points') ?? '').split(' ').map((p) => Number(p.split(',')[1]))) expect(y).toBeGreaterThanOrEqual(32)
  })
})
