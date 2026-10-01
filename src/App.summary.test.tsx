// Batch 4 of the UI refresh: the merged daily summary, the removed panel-header "Add food", and the mobile tab bar with the centre Log food button.
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CloudSync } from './lib/useCloudSync'
import type { DiaryEntry, Settings } from './types'
import { todayISO } from './lib/utils'

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

const fakeCloud = (): CloudSync => ({
  status: 'off',
  email: 'me@example.com',
  sendLink: vi.fn(async () => undefined),
  resetLink: vi.fn(),
  syncNow: vi.fn(async () => undefined),
  signOut: vi.fn(async () => undefined),
  deleteAccount: vi.fn(async () => undefined),
})

const entry = (over: Partial<DiaryEntry> & { id: string; name: string }): DiaryEntry => ({
  date: todayISO(), meal: 'breakfast', calories: 300, protein: 10, carbs: 20, fat: 5, createdAt: stamp, updatedAt: stamp, ...over,
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

const energy = (s: HTMLElement) => ({
  big: s.querySelector('.metric-value')?.firstChild?.textContent?.trim(),
  label: s.querySelector('.metric-value small')?.textContent,
  sub: s.querySelector('.metric-subtext')?.textContent,
  ring: s.querySelector('.progress-ring') as HTMLElement,
  ringText: s.querySelector('.progress-ring span')?.textContent,
})

const macro = (s: HTMLElement, label: string) => {
  const row = Array.from(s.querySelectorAll('.macro-list.compact .macro-row')).find((r) => r.querySelector('.macro-row-top span')?.textContent === label) as HTMLElement
  return { text: row.querySelector('strong')?.textContent, fill: row.querySelector('.progress-fill') as HTMLElement }
}

const allGoals = { calories: 2000, protein: 100, carbs: 200, fat: 50 }

describe('daily summary energy', () => {
  it('is a single section containing both energy and macros', async () => {
    const s = await renderApp()
    expect(document.querySelectorAll('.day-summary')).toHaveLength(1)
    expect(s.querySelector('.progress-ring')).not.toBeNull()
    expect(s.querySelector('.macro-list.compact')).not.toBeNull()
  })

  it('shows calories remaining, the eaten-of-goal line and a rounded percent when under goal', async () => {
    m.getSettings.mockResolvedValue(settingsWith(allGoals))
    entries = [entry({ id: 'a', name: 'Lunch', calories: 500 }), entry({ id: 'b', name: 'Snack', calories: 333 })]
    const e = energy(await renderApp())
    expect(e.big).toBe('1,167')
    expect(e.label).toBe('kcal left')
    expect(e.sub).toBe('833 of 2,000 kcal')
    expect(e.ringText).toBe('42%') // 41.65 rounds up
    expect(e.ring.classList.contains('over')).toBe(false)
  })

  it('shows the full goal as left with 0 of goal and 0% when nothing is logged', async () => {
    m.getSettings.mockResolvedValue(settingsWith(allGoals))
    const e = energy(await renderApp())
    expect(e.big).toBe('2,000')
    expect(e.label).toBe('kcal left')
    expect(e.sub).toBe('0 of 2,000 kcal')
    expect(e.ringText).toBe('0%')
    expect(e.ring.getAttribute('aria-label')).toBe('0 percent of calorie goal')
  })

  it('shows the amount over, the over class and the true unclamped percent when above goal', async () => {
    m.getSettings.mockResolvedValue(settingsWith({ ...allGoals, calories: 2000 }))
    entries = [entry({ id: 'a', name: 'Feast', calories: 2060 })]
    const e = energy(await renderApp())
    expect(e.big).toBe('60')
    expect(e.label).toBe('kcal over')
    expect(e.sub).toBe('2,060 of 2,000 kcal')
    expect(e.ring.classList.contains('over')).toBe(true)
    expect(e.ringText).toBe('103%')
    expect(e.ring.getAttribute('aria-label')).toBe('103 percent of calorie goal')
  })

  it('is neither over nor flagged when eaten exactly equals the goal', async () => {
    m.getSettings.mockResolvedValue(settingsWith(allGoals))
    entries = [entry({ id: 'a', name: 'Exact', calories: 2000 })]
    const e = energy(await renderApp())
    expect(e.big).toBe('0')
    expect(e.label).toBe('kcal left')
    expect(e.ringText).toBe('100%')
    expect(e.ring.classList.contains('over')).toBe(false)
  })

  it.each([
    ['missing', {}],
    ['zero', { calories: 0 }],
    ['negative', { calories: -500 }],
  ])('falls back to kcal eaten with a dash ring when the calorie goal is %s', async (_n, goals) => {
    m.getSettings.mockResolvedValue(settingsWith({ protein: 100, ...goals }))
    entries = [entry({ id: 'a', name: 'Lunch', calories: 640 })]
    const s = await renderApp()
    const e = energy(s)
    expect(e.big).toBe('640')
    expect(e.label).toBe('kcal eaten')
    expect(e.sub).toBe('Set an energy goal in Settings to see your balance.')
    expect(e.ringText).toBe('—')
    expect(e.ring.classList.contains('over')).toBe(false)
    expect(s.textContent).not.toMatch(/NaN|Infinity|undefined/)
  })

  it('falls back the same way when no settings are stored at all', async () => {
    const s = await renderApp()
    const e = energy(s)
    expect(e.big).toBe('0')
    expect(e.label).toBe('kcal eaten')
    expect(e.ringText).toBe('—')
    expect(s.textContent).not.toMatch(/NaN|Infinity|undefined/)
  })

  it('handles entries with 0 calories under a goal and under no goal', async () => {
    m.getSettings.mockResolvedValue(settingsWith(allGoals))
    entries = [entry({ id: 'a', name: 'Water', calories: 0, protein: 0, carbs: 0, fat: 0 })]
    const s = await renderApp()
    expect(energy(s).big).toBe('2,000')
    expect(energy(s).ringText).toBe('0%')
    expect(s.textContent).not.toMatch(/NaN|Infinity|undefined/)
  })

  it('does not produce NaN or Infinity text for very large numbers', async () => {
    m.getSettings.mockResolvedValue(settingsWith({ ...allGoals, calories: 1e9 }))
    entries = [entry({ id: 'a', name: 'Huge', calories: 2e9, protein: 1e9, carbs: 1e9, fat: 1e9 })]
    const s = await renderApp()
    expect(s.textContent).not.toMatch(/NaN|Infinity|undefined/)
    const e = energy(s)
    expect(e.label).toBe('kcal over')
    expect(e.ringText).toBe('200%')
  })
})

describe('daily summary macros', () => {
  it('shows value and goal for each macro, with the over class only above its own goal', async () => {
    m.getSettings.mockResolvedValue(settingsWith(allGoals))
    entries = [entry({ id: 'a', name: 'Meal', protein: 120, carbs: 50, fat: 50 })]
    const s = await renderApp()
    const protein = macro(s, 'Protein')
    const carbs = macro(s, 'Carbs')
    const fat = macro(s, 'Fat')
    expect(protein.text).toBe('120g / 100g')
    expect(carbs.text).toBe('50g / 200g')
    expect(fat.text).toBe('50g / 50g')
    expect(protein.fill.classList.contains('over')).toBe(true)
    expect(carbs.fill.classList.contains('over')).toBe(false)
    expect(fat.fill.classList.contains('over')).toBe(false) // exactly at goal
  })

  it('with only a protein goal, only protein shows a goal and the others have empty, non-over fills', async () => {
    m.getSettings.mockResolvedValue(settingsWith({ protein: 100 }))
    entries = [entry({ id: 'a', name: 'Meal', protein: 40, carbs: 300, fat: 90 })]
    const s = await renderApp()
    expect(macro(s, 'Protein').text).toBe('40g / 100g')
    expect(macro(s, 'Protein').fill.style.width).toBe('40%')
    for (const label of ['Carbs', 'Fat']) {
      const r = macro(s, label)
      expect(r.text).not.toContain('/')
      expect(r.fill.style.width).toBe('0%')
      expect(r.fill.classList.contains('over')).toBe(false)
    }
    expect(macro(s, 'Carbs').text).toBe('300g')
    expect(s.textContent).not.toMatch(/NaN|Infinity|undefined/)
  })

  it('treats a macro goal of 0 as not set: no "/ 0g", an empty fill and no over class', async () => {
    m.getSettings.mockResolvedValue(settingsWith({ protein: 0, carbs: 0, fat: 0 }))
    entries = [entry({ id: 'a', name: 'Meal', protein: 40, carbs: 30, fat: 10 })]
    const s = await renderApp()
    for (const [label, text] of [['Protein', '40g'], ['Carbs', '30g'], ['Fat', '10g']] as const) {
      const r = macro(s, label)
      expect(r.text).toBe(text)
      expect(r.fill.style.width).toBe('0%')
      expect(r.fill.classList.contains('over')).toBe(false)
    }
  })

  it('treats a negative macro goal as not set: no goal text, an empty fill and no over class', async () => {
    m.getSettings.mockResolvedValue(settingsWith({ protein: -50 }))
    entries = [entry({ id: 'a', name: 'Meal', protein: 40 })]
    const s = await renderApp()
    const r = macro(s, 'Protein')
    expect(r.text).toBe('40g')
    expect(r.fill.style.width).toBe('0%')
    expect(r.fill.classList.contains('over')).toBe(false)
  })

  it('shows plain values with 0% fills and no over class when no goals exist', async () => {
    entries = [entry({ id: 'a', name: 'Meal' })]
    const s = await renderApp()
    for (const label of ['Protein', 'Carbs', 'Fat']) {
      const r = macro(s, label)
      expect(r.text).not.toContain('/')
      expect(r.fill.style.width).toBe('0%')
      expect(r.fill.classList.contains('over')).toBe(false)
    }
  })
})

describe('diary add controls', () => {
  it('has no button named exactly "Add food" on the diary', async () => {
    await renderApp()
    expect(screen.queryByRole('button', { name: 'Add food' })).toBeNull()
  })

  it('keeps the per-meal Add buttons, one per meal, and one opens the Log food dialog', async () => {
    const user = userEvent.setup()
    await renderApp()
    const adds = screen.getAllByRole('button', { name: 'Add' })
    expect(adds).toHaveLength(5)
    await user.click(adds[0])
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('keeps the top-bar Log food button opening the dialog', async () => {
    const user = userEvent.setup()
    await renderApp()
    const topbar = document.querySelector('.topbar-actions') as HTMLElement
    await user.click(within(topbar).getByRole('button', { name: 'Log food' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })
})

describe('mobile navigation', () => {
  const nav = () => screen.getByRole('navigation', { name: 'Mobile navigation' })
  const controls = () => Array.from(nav().querySelectorAll(':scope > button')) as HTMLElement[]

  it('renders Diary, Trends, the round Log food button, Foods, Settings in that order', async () => {
    await renderApp()
    const c = controls()
    expect(c).toHaveLength(5)
    expect(c.map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Diary', 'Trends', 'Log food', 'Foods', 'Settings'])
    expect(c[2].classList.contains('mobile-nav-add')).toBe(true)
    expect(nav().querySelectorAll('.mobile-nav-add')).toHaveLength(1)
    expect(c[0].classList.contains('active')).toBe(true)
  })

  it('opens the Log food dialog from the centre button', async () => {
    const user = userEvent.setup()
    await renderApp()
    expect(screen.queryByRole('dialog')).toBeNull()
    await user.click(controls()[2])
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('still switches views with the tabs and does not mark the add button active', async () => {
    const user = userEvent.setup()
    await renderApp()
    await user.click(within(nav()).getByRole('button', { name: 'Trends' }))
    expect(await screen.findByRole('group', { name: 'Trend range' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Daily nutrition summary' })).toBeNull()
    const c = controls()
    expect(c[1].classList.contains('active')).toBe(true)
    expect(c[0].classList.contains('active')).toBe(false)
    expect(c[2].classList.contains('active')).toBe(false)
    await user.click(within(nav()).getByRole('button', { name: 'Diary' }))
    expect(await screen.findByRole('region', { name: 'Daily nutrition summary' })).toBeTruthy()
  })
})
