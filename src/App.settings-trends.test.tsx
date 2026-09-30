import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WeightEntry } from './types'
import { shiftDate, todayISO } from './lib/utils'

vi.mock('./lib/db', () => ({
  deleteEntry: vi.fn(), deleteFood: vi.fn(), deleteWeight: vi.fn(), exportBackup: vi.fn(), clearAllData: vi.fn(),
  getEntries: vi.fn(), getFoods: vi.fn(), getSettings: vi.fn(), getWeights: vi.fn(), importBackup: vi.fn(),
  requestPersistentStorage: vi.fn(), onDatabaseEvent: vi.fn(() => () => undefined), saveEntries: vi.fn(), saveEntry: vi.fn(), saveFood: vi.fn(),
  saveSettings: vi.fn(), saveWeight: vi.fn(),
}))

import * as db from './lib/db'
import App from './App'

const m = vi.mocked(db)
const stamp = '2026-01-01T00:00:00.000Z'
const first = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]
const toastEl = () => document.querySelector('.toast') as HTMLElement | null

const weightAt = (daysAgo: number, weight: number): WeightEntry => ({
  id: `w${daysAgo}`, date: shiftDate(todayISO(), -daysAgo), weight, unit: 'lb', createdAt: stamp,
})

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

async function openSettings() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
  await user.click(first('Settings'))
  return user
}

describe('settings actions report failures', () => {
  it('shows an error and no success toast when clearing local data fails', async () => {
    m.clearAllData.mockRejectedValue(new Error('blocked'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = await openSettings()
    await user.click(screen.getByRole('button', { name: /^Clear$/ }))
    expect(await screen.findByText('Local data could not be cleared. Nothing was removed.')).toBeTruthy()
    expect(screen.queryByText('Local data cleared.')).toBeNull()
    expect(toastEl()?.className).toContain('error')
  })

  it('does not call clearAllData when the confirm dialog is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = await openSettings()
    await user.click(screen.getByRole('button', { name: /^Clear$/ }))
    expect(m.clearAllData).not.toHaveBeenCalled()
    expect(toastEl()).toBeNull()
  })

  it('shows a success toast when clearing succeeds', async () => {
    m.clearAllData.mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = await openSettings()
    await user.click(screen.getByRole('button', { name: /^Clear$/ }))
    expect(await screen.findByText('Local data cleared.')).toBeTruthy()
  })

  it('shows an error when requesting persistent storage rejects', async () => {
    m.requestPersistentStorage.mockRejectedValue(new Error('denied'))
    const user = await openSettings()
    await user.click(screen.getByRole('button', { name: /Ask browser to keep local data/ }))
    expect(await screen.findByText('The browser could not be asked for persistent storage.')).toBeTruthy()
    expect(toastEl()?.className).toContain('error')
  })

  it('shows a success toast when persistent storage is granted', async () => {
    m.requestPersistentStorage.mockResolvedValue(true)
    const user = await openSettings()
    await user.click(screen.getByRole('button', { name: /Ask browser to keep local data/ }))
    expect(await screen.findByText('This browser will try to keep local data available.')).toBeTruthy()
  })
})

describe('weight trend range', () => {
  async function openTrends() {
    m.getWeights.mockResolvedValue([weightAt(120, 200), weightAt(60, 190), weightAt(20, 180), weightAt(2, 170)])
    const user = userEvent.setup()
    render(<App />)
    await screen.findAllByRole('button', { name: 'Log food' })
    await user.click(first('Trends'))
    const group = await screen.findByRole('group', { name: 'Trend range' })
    return { user, group }
  }
  const chartLabel = () => screen.getByRole('img', { name: /^Weight trend from/ }).getAttribute('aria-label')
  const pressed = (group: HTMLElement) =>
    within(group).getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent)

  it('offers 7d, 30d, 90d and All, defaulting to 30d', async () => {
    const { group } = await openTrends()
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['7d', '30d', '90d', 'All'])
    expect(pressed(group)).toEqual(['30d'])
    expect(screen.getByRole('heading', { name: 'Last 30 days' })).toBeTruthy()
  })

  it('30d plots only the two entries inside the window', async () => {
    await openTrends()
    expect(chartLabel()).toMatch(/from 170 to 180 lb/)
  })

  it('7d has one entry, so it asks for another check-in instead of a chart', async () => {
    const { user, group } = await openTrends()
    await user.click(within(group).getByRole('button', { name: '7d' }))
    expect(screen.getByRole('heading', { name: 'Last 7 days' })).toBeTruthy()
    expect(screen.getByText('Add one more check-in.')).toBeTruthy()
    expect(screen.queryByRole('img', { name: /^Weight trend from/ })).toBeNull()
    expect(pressed(group)).toEqual(['7d'])
  })

  it('90d includes the 60-day-old entry but not the 120-day-old one', async () => {
    const { user, group } = await openTrends()
    await user.click(within(group).getByRole('button', { name: '90d' }))
    expect(screen.getByRole('heading', { name: 'Last 90 days' })).toBeTruthy()
    expect(chartLabel()).toMatch(/from 170 to 190 lb/)
    expect(pressed(group)).toEqual(['90d'])
  })

  it('All includes all four entries and is headed All time', async () => {
    const { user, group } = await openTrends()
    await user.click(within(group).getByRole('button', { name: 'All' }))
    expect(screen.getByRole('heading', { name: 'All time' })).toBeTruthy()
    expect(chartLabel()).toMatch(/from 170 to 200 lb/)
    expect(pressed(group)).toEqual(['All'])
  })

  it('All with a single past entry shows the add-one-more state', async () => {
    m.getWeights.mockResolvedValue([weightAt(5, 150)])
    const user = userEvent.setup()
    render(<App />)
    await screen.findAllByRole('button', { name: 'Log food' })
    await user.click(first('Trends'))
    await user.click(within(await screen.findByRole('group', { name: 'Trend range' })).getByRole('button', { name: 'All' }))
    await waitFor(() => expect(screen.getByText('Add one more check-in.')).toBeTruthy())
  })

  it('All with no entries shows the empty state', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findAllByRole('button', { name: 'Log food' })
    await user.click(first('Trends'))
    await user.click(within(await screen.findByRole('group', { name: 'Trend range' })).getByRole('button', { name: 'All' }))
    expect(screen.getByText('No weight entries in this window.')).toBeTruthy()
  })
})
