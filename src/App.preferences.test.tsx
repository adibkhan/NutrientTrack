import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry, Settings } from './types'
import { todayISO } from './lib/utils'

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
const settingsRecord = (extra: Record<string, unknown> = {}): Settings =>
  ({ id: 'profile', goals: { weightUnit: 'lb', calories: 2000, protein: 150 }, updatedAt: stamp, ...extra }) as unknown as Settings
// 50g protein + 50g carbs, no fat: protein and carbs are each 50 percent of energy.
const entry = (over: Partial<DiaryEntry> = {}): DiaryEntry => ({
  id: 'e1', name: 'Mix', date: todayISO(), meal: 'breakfast', calories: 400, protein: 50, carbs: 50, fat: 0, createdAt: stamp, updatedAt: stamp, ...over,
})

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  document.documentElement.removeAttribute('data-theme')
  localStorage.clear()
  m.getEntries.mockResolvedValue([])
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(undefined)
  m.saveSettings.mockResolvedValue(undefined)
  m.onDatabaseEvent.mockImplementation(() => () => undefined)
  m.onLocalChange.mockImplementation(() => () => undefined)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetAllMocks()
  document.documentElement.removeAttribute('data-theme')
})

async function renderApp() {
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
}
async function openSettings() {
  const user = userEvent.setup()
  await renderApp()
  await user.click(first('Settings'))
  await screen.findByRole('heading', { name: 'Preferences' })
  return user
}
const summary = () => screen.getByLabelText('Daily nutrition summary')
const macroTexts = () => Array.from(summary().querySelectorAll('.macro-row strong')).map((n) => n.textContent)

describe('Settings preferences panel', () => {
  it('shows the Preferences panel with defaults when no preferences are stored', async () => {
    await openSettings()
    expect((screen.getByLabelText('Theme') as HTMLSelectElement).value).toBe('system')
    expect((screen.getByLabelText('Macro display') as HTMLSelectElement).value).toBe('grams')
  })

  it('saves dark theme keeping goals and unknown fields, and sets data-theme', async () => {
    m.getSettings.mockResolvedValue(settingsRecord({ futureField: { keep: true }, preferences: { macroDisplay: 'percent', futurePref: 1 } }))
    const user = await openSettings()
    await user.selectOptions(screen.getByLabelText('Theme'), 'dark')
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    const saved = m.saveSettings.mock.calls[0][0] as unknown as Record<string, unknown>
    expect(saved.goals).toEqual({ weightUnit: 'lb', calories: 2000, protein: 150 })
    expect(saved.futureField).toEqual({ keep: true })
    expect(saved.id).toBe('profile')
    expect(saved.preferences).toEqual({ macroDisplay: 'percent', futurePref: 1, theme: 'dark' })
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('dark'))
    expect(localStorage.getItem('nutrienttrack-theme')).toBe('dark')
  })

  it('removes data-theme when switching back to Match my device', async () => {
    m.getSettings.mockResolvedValue(settingsRecord({ preferences: { theme: 'dark' } }))
    const user = await openSettings()
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('dark'))
    await user.selectOptions(screen.getByLabelText('Theme'), 'system')
    await waitFor(() => expect(document.documentElement.hasAttribute('data-theme')).toBe(false))
    expect((m.saveSettings.mock.calls[0][0] as Settings).preferences?.theme).toBe('system')
  })

  it('saves default goals when no settings record existed yet', async () => {
    const user = await openSettings()
    await user.selectOptions(screen.getByLabelText('Theme'), 'light')
    await waitFor(() => expect(m.saveSettings).toHaveBeenCalled())
    expect(m.saveSettings.mock.calls[0][0]).toMatchObject({ id: 'profile', goals: { weightUnit: 'lb' }, preferences: { theme: 'light' } })
  })
})

describe('macro display in the diary summary', () => {
  it('shows grams by default', async () => {
    m.getEntries.mockResolvedValue([entry()])
    m.getSettings.mockResolvedValue(settingsRecord())
    await renderApp()
    await waitFor(() => expect(summary().textContent).toContain('50g / 150g'))
    expect(macroTexts()).toEqual(['50g / 150g', '50g', '0g'])
  })

  it('shows percents of energy when macroDisplay is percent', async () => {
    m.getEntries.mockResolvedValue([entry()])
    m.getSettings.mockResolvedValue({ id: 'profile', goals: { weightUnit: 'lb' }, preferences: { macroDisplay: 'percent' }, updatedAt: stamp })
    await renderApp()
    await waitFor(() => expect(macroTexts()).toEqual(['50%', '50%', '0%']))
    expect(summary().textContent).not.toMatch(/\dg\b/)
  })

  it('shows an em dash for each macro when nothing is logged', async () => {
    m.getSettings.mockResolvedValue({ id: 'profile', goals: { weightUnit: 'lb' }, preferences: { macroDisplay: 'percent' }, updatedAt: stamp })
    await renderApp()
    await waitFor(() => expect(macroTexts()).toEqual(['—', '—', '—']))
  })

  it('switches the summary to percents after choosing Share of energy', async () => {
    m.getEntries.mockResolvedValue([entry()])
    const user = await openSettings()
    await user.selectOptions(screen.getByLabelText('Macro display'), 'percent')
    await user.click(first('Diary'))
    await waitFor(() => expect(macroTexts()).toEqual(['50%', '50%', '0%']))
  })
})

describe('stored preferences from other builds', () => {
  it('renders a settings record with no preferences field using defaults', async () => {
    m.getEntries.mockResolvedValue([entry()])
    m.getSettings.mockResolvedValue(settingsRecord())
    await renderApp()
    await waitFor(() => expect(summary().textContent).toContain('50g'))
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('falls back to defaults for junk preference values without crashing', async () => {
    m.getEntries.mockResolvedValue([entry()])
    m.getSettings.mockResolvedValue(settingsRecord({ preferences: { theme: 'sepia', macroDisplay: 42 } }))
    const user = await openSettings()
    expect((screen.getByLabelText('Theme') as HTMLSelectElement).value).toBe('system')
    expect((screen.getByLabelText('Macro display') as HTMLSelectElement).value).toBe('grams')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    await user.click(first('Diary'))
    await waitFor(() => expect(summary().textContent).toContain('50g'))
  })
})
