// Batch 3 of the UI refresh: diary row meta line, the row overflow toggle, and the cloud-aware top-bar chip and sidebar note.
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CloudSync } from './lib/useCloudSync'
import type { DiaryEntry } from './types'
import { formatClockTime, todayISO } from './lib/utils'

vi.mock('./lib/db', () => ({
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

const fakeCloud = (status: CloudSync['status']): CloudSync => ({
  status,
  email: 'me@example.com',
  sendLink: vi.fn(async () => undefined),
  resetLink: vi.fn(),
  syncNow: vi.fn(async () => undefined),
  signOut: vi.fn(async () => undefined),
  deleteAccount: vi.fn(async () => undefined),
})

const entry = (over: Partial<DiaryEntry> & { id: string; name: string }): DiaryEntry => ({
  date: todayISO(), meal: 'breakfast', calories: 300, protein: 10.5, carbs: 54, fat: 5.2, createdAt: stamp, updatedAt: stamp, ...over,
})

let entries: DiaryEntry[]

beforeEach(() => {
  cloud = fakeCloud('off')
  entries = []
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  m.getEntries.mockImplementation(async () => entries)
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
}

/** The diary row that contains the toggle for this entry. */
const rowOf = async (name: string) => {
  const toggle = await screen.findByRole('button', { name: `Actions for ${name}` })
  return toggle.closest('.entry-row') as HTMLElement
}

describe('diary row meta line', () => {
  it('shows the formatted clock time, grams, and both macro variants', async () => {
    entries = [entry({ id: 'e1', name: 'Oatmeal', time: '07:40', grams: 80 })]
    await renderApp()
    const row = await rowOf('Oatmeal')
    const meta = row.querySelector('.entry-meta') as HTMLElement
    expect(row.querySelector('.entry-time')?.textContent).toBe(formatClockTime('07:40'))
    expect(within(meta).getByText('80 g')).toBeTruthy()
    expect(row.querySelector('.entry-macros-full')?.textContent).toBe('10.5g protein · 54g carbs · 5.2g fat')
    expect(row.querySelector('.entry-macros-compact')?.textContent).toBe('10.5P · 54C · 5.2F')
    expect(row.querySelector('.entry-macros')?.children).toHaveLength(2)
  })

  it('drops the provenance label for catalog, saved and manual entries', async () => {
    entries = [
      entry({ id: 'a', name: 'Catalog thing', catalogId: 'c1', catalogSource: 'USDA SR Legacy' }),
      entry({ id: 'b', name: 'Library thing', foodId: 'f1' }),
      entry({ id: 'c', name: 'Hand-typed thing' }),
    ]
    await renderApp()
    await rowOf('Hand-typed thing')
    expect(document.querySelector('.entry-row .meal-label')).toBeNull()
    for (const row of Array.from(document.querySelectorAll('.entry-row'))) expect(row.textContent).not.toMatch(/Catalog snapshot|Saved food|Manual/)
  })

  it('shows no clock and no grams item when time and grams were not recorded', async () => {
    entries = [entry({ id: 'e2', name: 'Mystery snack' })]
    await renderApp()
    const row = await rowOf('Mystery snack')
    expect(row.querySelector('.entry-time')).toBeNull()
    expect(row.querySelector('.entry-meta')?.children).toHaveLength(1) // only the macros
    expect(within(row).queryByText(/^\d+(\.\d+)? g$/)).toBeNull()
    expect(row.textContent).not.toContain('0 g')
  })

  it('shows a recorded grams value of zero, unlike a missing one', async () => {
    entries = [entry({ id: 'e3', name: 'Zero gram', grams: 0 })]
    await renderApp()
    const row = await rowOf('Zero gram')
    expect(within(row).getByText('0 g')).toBeTruthy()
  })
})

describe('diary row overflow toggle', () => {
  it('starts collapsed, expands on click, and collapses on a second click', async () => {
    entries = [entry({ id: 'e1', name: 'Oatmeal' })]
    const user = userEvent.setup()
    await renderApp()
    const toggle = await screen.findByRole('button', { name: 'Actions for Oatmeal' })
    const row = toggle.closest('.entry-row') as HTMLElement
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(row.classList.contains('is-open')).toBe(false)
    await user.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(row.classList.contains('is-open')).toBe(true)
    await user.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(row.classList.contains('is-open')).toBe(false)
  })

  it('points aria-controls at the container holding Move, Edit and Delete, in every state', async () => {
    entries = [entry({ id: 'e1', name: 'Oatmeal' })]
    const user = userEvent.setup()
    await renderApp()
    const toggle = await screen.findByRole('button', { name: 'Actions for Oatmeal' })
    const check = () => {
      const target = document.getElementById(toggle.getAttribute('aria-controls') ?? '')
      expect(target).not.toBeNull()
      for (const verb of ['Move', 'Edit', 'Delete']) expect(within(target as HTMLElement).getByRole('button', { name: `${verb} Oatmeal` })).toBeTruthy()
    }
    check()
    await user.click(toggle)
    check()
  })

  it('toggles two rows independently and gives them distinct control ids', async () => {
    entries = [entry({ id: 'e1', name: 'Oatmeal' }), entry({ id: 'e2', name: 'Banana' })]
    const user = userEvent.setup()
    await renderApp()
    const a = await screen.findByRole('button', { name: 'Actions for Oatmeal' })
    const b = await screen.findByRole('button', { name: 'Actions for Banana' })
    expect(a.getAttribute('aria-controls')).not.toBe(b.getAttribute('aria-controls'))
    await user.click(a)
    expect(a.getAttribute('aria-expanded')).toBe('true')
    expect(b.getAttribute('aria-expanded')).toBe('false')
    await user.click(b)
    await user.click(a)
    expect(a.getAttribute('aria-expanded')).toBe('false')
    expect(b.getAttribute('aria-expanded')).toBe('true')
    expect(b.closest('.entry-row')?.classList.contains('is-open')).toBe(true)
    expect(a.closest('.entry-row')?.classList.contains('is-open')).toBe(false)
  })
})

describe('cloud-aware top bar chip and sidebar note', () => {
  const localOnly = 'Your entries stay in this browser. Export a backup before clearing site data or changing devices.'
  const chip = () => document.querySelector('.offline-chip') as HTMLElement
  const note = () => document.querySelector('.sidebar-footer p') as HTMLElement

  it.each([
    ['off', 'Local only', false],
    ['link-sent', 'Local only', false],
    ['checking', 'Checking backup…', false],
    ['syncing', 'Syncing…', false],
    ['synced', 'Backed up', false],
    ['offline', 'Offline, will sync later', true],
    ['error', 'Sync problem', true],
  ] as const)('status %s shows chip "%s"', async (status, label, warn) => {
    cloud = fakeCloud(status)
    await renderApp()
    expect(chip().textContent).toBe(label)
    expect(chip().classList.contains('warn')).toBe(warn)
  })

  it.each(['off', 'link-sent', 'checking'] as const)('status %s keeps the local-only sidebar sentence', async (status) => {
    cloud = fakeCloud(status)
    await renderApp()
    expect(note().textContent).toBe(localOnly)
  })

  it.each(['syncing', 'synced', 'offline', 'error'] as const)('status %s says entries are backed up to the account', async (status) => {
    cloud = fakeCloud(status)
    await renderApp()
    expect(note().textContent).toMatch(/backed up to your account/)
    expect(note().textContent).not.toBe(localOnly)
  })
})
