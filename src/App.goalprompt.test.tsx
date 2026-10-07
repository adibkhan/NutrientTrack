// Regression: with no calorie goal the diary showed a bar stuck at 0% and plain-text advice. Now the bar is hidden and a button leads to the calorie goal field.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CloudSync } from './lib/useCloudSync'
import type { DiaryEntry, Settings } from './types'

vi.mock('./lib/db', () => ({
  getWaterLogs: vi.fn(() => Promise.resolve([])), getMeasurements: vi.fn(() => Promise.resolve([])), saveWaterLog: vi.fn(), deleteWaterLog: vi.fn(), saveMeasurement: vi.fn(), deleteMeasurement: vi.fn(),
  deleteEntry: vi.fn(), deleteFood: vi.fn(), deleteWeight: vi.fn(), exportBackup: vi.fn(), clearAllData: vi.fn(),
  getEntries: vi.fn(), getFoods: vi.fn(), getSettings: vi.fn(), getWeights: vi.fn(), importBackup: vi.fn(),
  requestPersistentStorage: vi.fn(), onDatabaseEvent: vi.fn(() => () => undefined), onLocalChange: vi.fn(() => () => undefined),
  saveEntries: vi.fn(), saveEntry: vi.fn(), saveFood: vi.fn(), saveSettings: vi.fn(), saveWeight: vi.fn(),
}))

let cloud: CloudSync
vi.mock('./lib/useCloudSync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/useCloudSync')>()),
  useCloudSync: () => cloud,
}))

import * as db from './lib/db'
import App from './App'

const m = vi.mocked(db)
const stamp = '2026-01-01T00:00:00.000Z'

const fakeCloud = (): CloudSync => ({
  status: 'off',
  email: 'me@example.com',
  sendLink: vi.fn(async () => undefined),
  resetLink: vi.fn(),
  syncNow: vi.fn(async () => undefined),
  signOut: vi.fn(async () => undefined),
  deleteAccount: vi.fn(async () => undefined),
})

type GoalsInput = Partial<NonNullable<Settings['goals']>>
const settingsWith = (goals: GoalsInput): Settings => ({ id: 'profile', goals: { weightUnit: 'lb', ...goals }, updatedAt: stamp }) as unknown as Settings

let entries: DiaryEntry[]

beforeEach(() => {
  cloud = fakeCloud()
  entries = []
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  m.getEntries.mockImplementation(async () => entries)
  m.saveEntry.mockImplementation(async (e: DiaryEntry) => { entries = [...entries.filter((x) => x.id !== e.id), e] })
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(undefined)
  m.onDatabaseEvent.mockImplementation(() => () => undefined)
  m.onLocalChange.mockImplementation(() => () => undefined)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function renderApp() {
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
  return screen.getByRole('region', { name: 'Daily nutrition summary' })
}

async function logManualFood(calories: string) {
  const user = userEvent.setup()
  const topbar = document.querySelector('.topbar-actions') as HTMLElement
  await user.click(within(topbar).getByRole('button', { name: 'Log food' }))
  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByRole('button', { name: /Manual quick add/ }))
  await user.type(within(dialog).getByLabelText('Food or meal name'), 'Chicken bowl')
  await user.type(within(dialog).getByLabelText(/^Calories/), calories)
  await user.click(within(dialog).getByRole('button', { name: 'Add to diary' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
}

const bar = () => document.querySelector('.day-progress')
const goalButton = () => screen.queryByRole('button', { name: /Set an energy goal/ })

describe('diary energy bar without a calorie goal', () => {
  it('hides the bar and offers the set-goal button', async () => {
    await renderApp()
    expect(bar()).toBeNull()
    expect(goalButton()).not.toBeNull()
  })

  it('opens Settings and focuses the calorie goal input when the button is clicked', async () => {
    const user = userEvent.setup()
    await renderApp()
    await user.click(goalButton() as HTMLElement)
    expect(await screen.findByRole('heading', { name: 'Goals' })).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('goal-calories')))
    expect(document.activeElement?.id).toBe('goal-calories')
  })

  it('updates the kcal figure after logging a food but still shows no bar', async () => {
    const s = await renderApp()
    await logManualFood('450')
    await waitFor(() => expect(s.querySelector('.metric-value')?.textContent).toMatch(/450\s*kcal eaten/))
    expect(bar()).toBeNull()
    expect(goalButton()).not.toBeNull()
  })

  it.each([
    ['zero', 0],
    ['negative', -500],
  ])('treats a %s calorie goal as no goal: button shown, no bar', async (_n, calories) => {
    m.getSettings.mockResolvedValue(settingsWith({ calories }))
    await renderApp()
    expect(bar()).toBeNull()
    expect(goalButton()).not.toBeNull()
  })
})

describe('diary energy bar with a calorie goal', () => {
  it('renders the bar at eaten/goal percent after a food is logged and has no set-goal button', async () => {
    m.getSettings.mockResolvedValue(settingsWith({ calories: 2000 }))
    await renderApp()
    expect(goalButton()).toBeNull()
    expect((bar()?.querySelector('b') as HTMLElement).style.width).toBe('0%')
    await logManualFood('450')
    await waitFor(() => expect((bar()?.querySelector('b') as HTMLElement).style.width).toBe('22.5%'))
    expect(bar()?.querySelector('b')?.classList.contains('over')).toBe(false)
    expect(goalButton()).toBeNull()
  })

  it('marks the bar over and clamps it to 100% when eaten exceeds the goal', async () => {
    m.getSettings.mockResolvedValue(settingsWith({ calories: 400 }))
    await renderApp()
    await logManualFood('450')
    await waitFor(() => expect(bar()?.querySelector('b')?.classList.contains('over')).toBe(true))
    expect((bar()?.querySelector('b') as HTMLElement).style.width).toBe('100%')
    expect(goalButton()).toBeNull()
  })
})
