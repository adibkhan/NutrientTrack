// Reminders: the in-app notification hook (useReminders) and the Settings panel (RemindersPanel).
// Only the clock is faked (Date), so timers, waitFor and user-event keep working.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry, Settings, WeightEntry } from './types'
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

/** Fixed "now" of 15:30, so "10 minutes ago" is 15:20 and never crosses midnight. */
const NOW = new Date(2026, 5, 15, 15, 30, 0)
const TEN_MINUTES_AGO = '15:20'

const settingsWith = (preferences: Settings['preferences'], extra: Record<string, unknown> = {}): Settings =>
  ({ id: 'profile', goals: { weightUnit: 'lb' }, preferences, updatedAt: stamp, ...extra }) as Settings
const eaten = (over: Partial<DiaryEntry> = {}): DiaryEntry =>
  ({ id: 'e1', name: 'Porridge', meal: 'breakfast', date: todayISO(), calories: 300, protein: 10, carbs: 40, fat: 5, createdAt: stamp, updatedAt: stamp, ...over }) as DiaryEntry

type Permission = 'granted' | 'denied' | 'default'
let notification: ReturnType<typeof vi.fn> & { permission?: Permission; requestPermission?: ReturnType<typeof vi.fn> }

const stubNotification = (permission: Permission, requestResult: Permission = 'denied') => {
  notification = vi.fn() as typeof notification
  notification.permission = permission
  notification.requestPermission = vi.fn(() => Promise.resolve(requestResult))
  vi.stubGlobal('Notification', notification)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  m.getEntries.mockResolvedValue([])
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(undefined)
  m.getWaterLogs.mockResolvedValue([])
  m.getMeasurements.mockResolvedValue([])
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
  localStorage.clear()
})

async function renderApp() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
  return user
}
/** Give effects that run after loading a chance to fire, for tests that expect nothing to happen. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 60))

describe('useReminders through App', () => {
  it('creates one notification for a food reminder that is due and nothing was logged', async () => {
    stubNotification('granted')
    m.getSettings.mockResolvedValue(settingsWith({ reminders: { logFood: TEN_MINUTES_AGO } }))
    await renderApp()

    await waitFor(() => expect(notification).toHaveBeenCalledTimes(1))
    expect(notification).toHaveBeenCalledWith('Log your food', expect.objectContaining({ tag: 'nutrienttrack-logFood' }))
  })

  it('creates none on a second render the same day', async () => {
    stubNotification('granted')
    m.getSettings.mockResolvedValue(settingsWith({ reminders: { logFood: TEN_MINUTES_AGO } }))
    await renderApp()
    await waitFor(() => expect(notification).toHaveBeenCalledTimes(1))
    expect(localStorage.getItem(`nutrienttrack-reminder-logFood-${todayISO()}`)).not.toBeNull()

    cleanup()
    await renderApp()
    await settle()
    expect(notification).toHaveBeenCalledTimes(1)
  })

  it('creates none when food was already eaten today', async () => {
    stubNotification('granted')
    m.getSettings.mockResolvedValue(settingsWith({ reminders: { logFood: TEN_MINUTES_AGO } }))
    m.getEntries.mockResolvedValue([eaten()])
    await renderApp()
    await settle()
    expect(notification).not.toHaveBeenCalled()
  })

  it('still reminds when today only has a planned entry', async () => {
    stubNotification('granted')
    m.getSettings.mockResolvedValue(settingsWith({ reminders: { logFood: TEN_MINUTES_AGO } }))
    m.getEntries.mockResolvedValue([eaten({ planned: true })])
    await renderApp()
    await waitFor(() => expect(notification).toHaveBeenCalledTimes(1))
  })

  it('creates none when the reminder time is still ahead', async () => {
    stubNotification('granted')
    m.getSettings.mockResolvedValue(settingsWith({ reminders: { logFood: '15:45' } }))
    await renderApp()
    await settle()
    expect(notification).not.toHaveBeenCalled()
  })

  it('creates none when the reminder time was more than an hour ago', async () => {
    stubNotification('granted')
    m.getSettings.mockResolvedValue(settingsWith({ reminders: { logFood: '14:00' } }))
    await renderApp()
    await settle()
    expect(notification).not.toHaveBeenCalled()
  })

  it('creates a weigh-in notification, and none once weight is logged today', async () => {
    stubNotification('granted')
    m.getSettings.mockResolvedValue(settingsWith({ reminders: { weighIn: TEN_MINUTES_AGO } }))
    await renderApp()
    await waitFor(() => expect(notification).toHaveBeenCalledWith('Time to weigh in', expect.objectContaining({ tag: 'nutrienttrack-weighIn' })))

    cleanup()
    localStorage.clear()
    notification.mockClear()
    m.getWeights.mockResolvedValue([{ id: 'w1', date: todayISO(), weight: 180, unit: 'lb', createdAt: stamp } as WeightEntry])
    await renderApp()
    await settle()
    expect(notification).not.toHaveBeenCalled()
  })

  it('creates none when permission is denied', async () => {
    stubNotification('denied')
    m.getSettings.mockResolvedValue(settingsWith({ reminders: { logFood: TEN_MINUTES_AGO } }))
    await renderApp()
    await settle()
    expect(notification).not.toHaveBeenCalled()
  })

  it('creates none when permission was never asked', async () => {
    stubNotification('default')
    m.getSettings.mockResolvedValue(settingsWith({ reminders: { logFood: TEN_MINUTES_AGO } }))
    await renderApp()
    await settle()
    expect(notification).not.toHaveBeenCalled()
  })

  it('creates none when no reminder is set', async () => {
    stubNotification('granted')
    m.getSettings.mockResolvedValue(settingsWith({ theme: 'dark' }))
    await renderApp()
    await settle()
    expect(notification).not.toHaveBeenCalled()
  })

  it('does not throw when Notification is undefined', async () => {
    vi.stubGlobal('Notification', undefined)
    m.getSettings.mockResolvedValue(settingsWith({ reminders: { logFood: TEN_MINUTES_AGO } }))
    await renderApp()
    await settle()
    expect(screen.getAllByRole('button', { name: 'Log food' }).length).toBeGreaterThan(0)
  })

  it('does not break the app when the Notification constructor throws', async () => {
    stubNotification('granted')
    notification.mockImplementation(() => { throw new TypeError('Illegal constructor') })
    m.getSettings.mockResolvedValue(settingsWith({ reminders: { logFood: TEN_MINUTES_AGO } }))
    await renderApp()
    await waitFor(() => expect(notification).toHaveBeenCalledTimes(1))
    expect(screen.getAllByRole('button', { name: 'Log food' }).length).toBeGreaterThan(0)
  })
})

describe('Reminders panel in Settings', () => {
  async function openSettings() {
    const user = await renderApp()
    await user.click(first('Settings'))
    await screen.findByRole('heading', { name: 'Reminders' })
    return user
  }
  const saved = () => {
    expect(m.saveSettings).toHaveBeenCalledTimes(1)
    return m.saveSettings.mock.calls[0][0] as Settings & Record<string, unknown>
  }

  it('says notifications are unsupported when Notification is undefined', async () => {
    vi.stubGlobal('Notification', undefined)
    await openSettings()
    expect(screen.getByText(/does not support notifications/)).toBeTruthy()
    expect(screen.queryByRole('checkbox', { name: 'Log your food' })).toBeNull()
  })

  it('ticking Log your food saves 12:00 and keeps other preferences and unknown settings fields', async () => {
    stubNotification('granted')
    m.getSettings.mockResolvedValue(settingsWith({ theme: 'dark', barcodeLookup: true, reminders: { weighIn: '07:30' }, futurePref: 1 } as Settings['preferences'], { futureSettingsField: { kept: true } }))
    const user = await openSettings()
    await user.click(screen.getByRole('checkbox', { name: 'Log your food' }))

    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    expect(saved().preferences).toMatchObject({ theme: 'dark', barcodeLookup: true, futurePref: 1, reminders: { logFood: '12:00', weighIn: '07:30' } })
    expect(saved().futureSettingsField).toEqual({ kept: true })
    expect(saved().goals).toEqual({ weightUnit: 'lb' })
  })

  it('changing the time saves it', async () => {
    stubNotification('granted')
    m.getSettings.mockResolvedValue(settingsWith({ reminders: { logFood: '12:00' } }))
    await openSettings()
    fireEvent.change(screen.getByLabelText('Log your food time'), { target: { value: '08:30' } })

    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    expect(saved().preferences?.reminders).toEqual({ logFood: '08:30' })
  })

  it('does not save when the time box is cleared', async () => {
    stubNotification('granted')
    m.getSettings.mockResolvedValue(settingsWith({ reminders: { logFood: '12:00' } }))
    await openSettings()
    fireEvent.change(screen.getByLabelText('Log your food time'), { target: { value: '' } })
    await settle()
    expect(m.saveSettings).not.toHaveBeenCalled()
  })

  it('unticking removes the key and keeps the other reminder', async () => {
    stubNotification('granted')
    m.getSettings.mockResolvedValue(settingsWith({ reminders: { logFood: '12:00', weighIn: '07:00' } }))
    const user = await openSettings()
    await user.click(screen.getByRole('checkbox', { name: 'Log your food' }))

    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    const reminders = saved().preferences?.reminders
    expect(reminders).not.toHaveProperty('logFood')
    expect(reminders).toEqual({ weighIn: '07:00' })
  })

  it('asks for permission when it is default and shows the blocking message when denied, saving nothing', async () => {
    stubNotification('default', 'denied')
    const user = await openSettings()
    await user.click(screen.getByRole('checkbox', { name: 'Log your food' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/blocking notifications/)
    expect(notification.requestPermission).toHaveBeenCalledTimes(1)
    expect(m.saveSettings).not.toHaveBeenCalled()
    expect((screen.getByRole('checkbox', { name: 'Log your food' }) as HTMLInputElement).checked).toBe(false)
  })

  it('saves the reminder when the permission prompt is accepted', async () => {
    stubNotification('default', 'granted')
    const user = await openSettings()
    await user.click(screen.getByRole('checkbox', { name: 'Weigh-in' }))

    await waitFor(() => expect(m.saveSettings).toHaveBeenCalledTimes(1))
    expect(saved().preferences?.reminders).toEqual({ weighIn: '07:00' })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the blocking message without prompting when permission is already denied', async () => {
    stubNotification('denied')
    const user = await openSettings()
    await user.click(screen.getByRole('checkbox', { name: 'Log your food' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/blocking notifications/)
    expect(notification.requestPermission).not.toHaveBeenCalled()
    expect(m.saveSettings).not.toHaveBeenCalled()
  })
})
