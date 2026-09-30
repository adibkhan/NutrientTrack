// App wiring for opt-in cloud sync: clearing local data while signed in must sign this device out first,
// otherwise the next sync pulls the cloud copy straight back.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CloudSync } from './lib/useCloudSync'

vi.mock('./lib/db', () => ({
  deleteEntry: vi.fn(), deleteFood: vi.fn(), deleteWeight: vi.fn(), exportBackup: vi.fn(), clearAllData: vi.fn(),
  getEntries: vi.fn(), getFoods: vi.fn(), getSettings: vi.fn(), getWeights: vi.fn(), importBackup: vi.fn(),
  requestPersistentStorage: vi.fn(), onDatabaseEvent: vi.fn(() => () => undefined), onLocalChange: vi.fn(() => () => undefined),
  saveEntries: vi.fn(), saveEntry: vi.fn(), saveFood: vi.fn(), saveSettings: vi.fn(), saveWeight: vi.fn(),
}))

const calls: string[] = []
let cloud: CloudSync
vi.mock('./lib/useCloudSync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/useCloudSync')>()),
  useCloudSync: () => cloud,
}))

import * as db from './lib/db'
import App from './App'

const m = vi.mocked(db)

const fakeCloud = (status: CloudSync['status']): CloudSync => ({
  status,
  email: 'me@example.com',
  sendLink: vi.fn(async () => undefined),
  syncNow: vi.fn(async () => undefined),
  signOut: vi.fn(async () => { calls.push('signOut') }),
  deleteAccount: vi.fn(async () => undefined),
})

beforeEach(() => {
  calls.length = 0
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  m.getEntries.mockResolvedValue([])
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(undefined)
  m.clearAllData.mockImplementation(async () => { calls.push('clearAllData') })
  m.onDatabaseEvent.mockImplementation(() => () => undefined)
  m.onLocalChange.mockImplementation(() => () => undefined)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const clearFromSettings = async () => {
  const user = userEvent.setup()
  render(<App />)
  await screen.findAllByRole('button', { name: 'Log food' })
  await user.click(screen.getAllByRole('button', { name: /settings/i })[0])
  await user.click(await screen.findByRole('button', { name: /^clear$/i }))
}

describe('clearing local data with cloud sync', () => {
  it('signs this device out before clearing when signed in, and says so', async () => {
    cloud = fakeCloud('synced')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await clearFromSettings()
    await waitFor(() => expect(calls).toEqual(['signOut', 'clearAllData']))
    expect(String(confirm.mock.calls[0][0])).toMatch(/sign out of backup here/i)
  })

  it('only clears when signed out', async () => {
    cloud = fakeCloud('off')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await clearFromSettings()
    await waitFor(() => expect(calls).toEqual(['clearAllData']))
    expect(String(confirm.mock.calls[0][0])).not.toMatch(/sign out/i)
  })

  it('does nothing when the confirmation is declined', async () => {
    cloud = fakeCloud('synced')
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await clearFromSettings()
    expect(calls).toEqual([])
  })
})
