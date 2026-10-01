// Batch 6 of the UI refresh: HTML bar charts replace the SVG line charts in Nutrition insights.
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import type { DiaryEntry, Goals } from '../types'
import { formatShortDate, shiftDate, todayISO } from '../lib/utils'
import NutritionInsights from './NutritionInsights'

const stamp = '2026-01-01T00:00:00.000Z'
const entry = (daysAgo: number, over: Partial<DiaryEntry> = {}): DiaryEntry => ({
  id: `e${daysAgo}-${Math.random()}`, name: 'Food', date: shiftDate(todayISO(), -daysAgo), meal: 'lunch',
  calories: 300, protein: 10, carbs: 20, fat: 5, createdAt: stamp, updatedAt: stamp, ...over,
})
const dayLabel = (daysAgo: number) => formatShortDate(shiftDate(todayISO(), -daysAgo))

afterEach(cleanup)

const card = (name: 'Daily energy' | 'Daily protein') => screen.getByRole('region', { name })
const cols = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>('.bar-col'))
const barOf = (col: HTMLElement) => col.querySelector('.bar') as HTMLElement
const heightOf = (col: HTMLElement) => barOf(col).style.height
const pct = (col: HTMLElement) => parseFloat(heightOf(col))
const goalLine = (el: HTMLElement) => el.querySelector<HTMLElement>('.bar-goal')
const readout = (el: HTMLElement) => el.querySelector('.nutrition-readout') as HTMLElement
const plot = (el: HTMLElement) => el.querySelector('.bar-plot') as HTMLElement
const render_ = (entries: DiaryEntry[], goals?: Partial<Goals>) =>
  render(<NutritionInsights entries={entries} goals={goals && { weightUnit: 'lb', ...goals }} />)

describe('bar chart structure', () => {
  it('renders 7 bar columns per metric by default', () => {
    render_([])
    expect(cols(card('Daily energy'))).toHaveLength(7)
    expect(cols(card('Daily protein'))).toHaveLength(7)
  })

  it('renders 30 columns after switching to 30 days and 7 again after switching back', async () => {
    const user = userEvent.setup()
    render_([])
    const group = screen.getByRole('group', { name: 'Nutrition insight range' })
    await user.click(within(group).getByRole('button', { name: '30 days' }))
    expect(cols(card('Daily energy'))).toHaveLength(30)
    expect(within(group).getByRole('button', { name: '30 days' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(group).getByRole('button', { name: '7 days' }).getAttribute('aria-pressed')).toBe('false')
    await user.click(within(group).getByRole('button', { name: '7 days' }))
    expect(cols(card('Daily protein'))).toHaveLength(7)
  })

  it('shows an entry 20 days ago only in the 30-day range', async () => {
    const user = userEvent.setup()
    render_([entry(20)])
    expect(card('Daily energy').querySelectorAll('.bar:not(.empty)')).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: '30 days' }))
    expect(card('Daily energy').querySelectorAll('.bar:not(.empty)')).toHaveLength(1)
  })

  it('marks days without entries empty with no height style and the logged day with a height', () => {
    render_([entry(0)])
    const c = cols(card('Daily energy'))
    c.slice(0, 6).forEach((col) => {
      expect(barOf(col).className).toContain('empty')
      expect(barOf(col).getAttribute('style')).toBeNull()
    })
    expect(barOf(c[6]).className).not.toContain('empty')
    expect(heightOf(c[6])).not.toBe('')
  })

  it('scales the tallest logged day to 100% when there is no goal', () => {
    render_([entry(0, { calories: 300 }), entry(1, { calories: 150 })])
    const c = cols(card('Daily energy'))
    expect(pct(c[6])).toBeCloseTo(100)
    expect(pct(c[5])).toBeCloseTo(50)
  })

  it('rounds the scale up to the next multiple of its magnitude', () => {
    render_([entry(0, { calories: 1234 })])
    // scaleMax = ceil(1234/1000)*1000 = 2000
    expect(pct(cols(card('Daily energy'))[6])).toBeCloseTo(61.7)
  })

  it('lets a goal above the data raise the scale', () => {
    render_([entry(0, { calories: 300 })], { calories: 2000 })
    expect(pct(cols(card('Daily energy'))[6])).toBeCloseTo(15)
  })

  it('keeps the data as the scale when it is above the goal', () => {
    render_([entry(0, { calories: 3000 })], { calories: 2000 })
    const el = card('Daily energy')
    expect(pct(cols(el)[6])).toBeCloseTo(100)
    expect(goalLine(el)?.style.bottom).toBe(`${(2000 / 3000) * 100}%`)
  })

  it('gives a tiny non-zero day a minimum visible height of 2%', () => {
    render_([entry(0, { calories: 5000 }), entry(1, { calories: 1 })])
    expect(pct(cols(card('Daily energy'))[5])).toBe(2)
  })

  it('gives a logged day with zero calories the minimum height rather than an empty bar', () => {
    render_([entry(0, { calories: 0, protein: 0 })])
    const col = cols(card('Daily energy'))[6]
    expect(barOf(col).className).not.toContain('empty')
    expect(pct(col)).toBe(2)
  })

  it('sums several entries on the same day', () => {
    render_([entry(0, { calories: 100 }), entry(0, { calories: 200 })])
    expect(cols(card('Daily energy'))[6].title).toBe(`${dayLabel(0)}: 300 kcal`)
  })

  it('ignores entries outside the window', () => {
    render_([entry(8, { calories: 900 }), entry(-1, { calories: 900 })])
    expect(card('Daily energy').querySelectorAll('.bar:not(.empty)')).toHaveLength(0)
    expect(within(card('Daily energy')).getByText('No food logged in the last 7 days')).toBeTruthy()
  })
})

describe('goal line', () => {
  it('draws one positioned at goal / scale when the goal is positive', () => {
    render_([entry(0, { calories: 300, protein: 40 })], { calories: 2000, protein: 100 })
    expect(goalLine(card('Daily energy'))?.style.bottom).toBe('100%')
    expect(goalLine(card('Daily protein'))?.style.bottom).toBe('100%')
  })

  it('positions the goal below the top when data raises the scale', () => {
    render_([entry(0, { calories: 4000 })], { calories: 1000 })
    expect(parseFloat(goalLine(card('Daily energy'))?.style.bottom ?? '')).toBeCloseTo(25)
  })

  it('draws no goal line when no goals are given', () => {
    render_([entry(0)])
    expect(goalLine(card('Daily energy'))).toBeNull()
    expect(goalLine(card('Daily protein'))).toBeNull()
  })

  it('draws no goal line for a goal of 0', () => {
    render_([entry(0)], { calories: 0, protein: 0 })
    expect(goalLine(card('Daily energy'))).toBeNull()
    expect(goalLine(card('Daily protein'))).toBeNull()
    expect(within(card('Daily energy')).queryByText(/^Goal/)).toBeNull()
  })

  it('draws no goal line for a negative goal and does not let it affect the scale', () => {
    render_([entry(0, { calories: 300 })], { calories: -500 })
    const el = card('Daily energy')
    expect(goalLine(el)).toBeNull()
    expect(pct(cols(el)[6])).toBeCloseTo(100)
  })

  it('draws no goal line for a non-finite goal', () => {
    render_([entry(0)], { calories: Number.NaN, protein: Infinity })
    expect(goalLine(card('Daily energy'))).toBeNull()
    expect(goalLine(card('Daily protein'))).toBeNull()
  })

  it('sets goals per metric independently', () => {
    render_([entry(0)], { calories: 2000 })
    expect(goalLine(card('Daily energy'))).not.toBeNull()
    expect(goalLine(card('Daily protein'))).toBeNull()
  })

  it('still draws the goal line when no food is logged, with an empty chart', () => {
    render_([], { calories: 2000 })
    const el = card('Daily energy')
    expect(goalLine(el)?.style.bottom).toBe('100%')
    expect(el.querySelectorAll('.bar:not(.empty)')).toHaveLength(0)
  })
})

describe('readout and titles', () => {
  it('shows the hint before any selection', () => {
    render_([entry(0)])
    const r = readout(card('Daily energy'))
    expect(r.textContent).toBe('Tap or hover a bar for that day’s value.')
    expect(r.className).toContain('hint')
  })

  it('gives every column a title with the date and value or "no food logged"', () => {
    render_([entry(0, { calories: 300 })])
    const c = cols(card('Daily energy'))
    expect(c[6].title).toBe(`${dayLabel(0)}: 300 kcal`)
    expect(c[5].title).toBe(`${dayLabel(1)}: no food logged`)
    expect(cols(card('Daily protein'))[6].title).toBe(`${dayLabel(0)}: 10 g`)
  })

  it('shows the value and selects the column when a bar is clicked', async () => {
    const user = userEvent.setup()
    render_([entry(0, { calories: 300 })])
    const el = card('Daily energy')
    await user.click(cols(el)[6])
    expect(readout(el).textContent).toBe(`${dayLabel(0)} · 300 kcal`)
    expect(readout(el).className).not.toContain('hint')
    expect(cols(el)[6].className).toContain('selected')
  })

  it('shows "No food logged" for a clicked empty day', async () => {
    const user = userEvent.setup()
    render_([entry(0)])
    const el = card('Daily energy')
    await user.click(cols(el)[2])
    expect(readout(el).textContent).toBe(`${dayLabel(4)} · No food logged`)
  })

  it('shows the value on pointer hover', async () => {
    const user = userEvent.setup()
    render_([entry(1, { calories: 450 })])
    const el = card('Daily energy')
    await user.hover(cols(el)[5])
    expect(readout(el).textContent).toBe(`${dayLabel(1)} · 450 kcal`)
  })

  it('moves the selected class to the newest selection only', async () => {
    const user = userEvent.setup()
    render_([entry(0)])
    const el = card('Daily energy')
    await user.click(cols(el)[1])
    await user.click(cols(el)[4])
    expect(el.querySelectorAll('.bar-col.selected')).toHaveLength(1)
    expect(cols(el)[4].className).toContain('selected')
  })

  it('keeps the two metric cards independent', async () => {
    const user = userEvent.setup()
    render_([entry(0)])
    await user.click(cols(card('Daily energy'))[6])
    expect(readout(card('Daily protein')).className).toContain('hint')
    expect(card('Daily protein').querySelector('.selected')).toBeNull()
  })

  it('shows protein with one decimal in the readout', async () => {
    const user = userEvent.setup()
    render_([entry(0, { protein: 12.34 })])
    await user.click(cols(card('Daily protein'))[6])
    expect(readout(card('Daily protein')).textContent).toBe(`${dayLabel(0)} · 12.3 g`)
  })

  it('drops the selection when the range changes to one that no longer contains it', async () => {
    // Selection is by date; switching 30 -> 7 removes a date older than 7 days, falling back to the hint.
    const user = userEvent.setup()
    render_([entry(20)])
    await user.click(screen.getByRole('button', { name: '30 days' }))
    const el = card('Daily energy')
    await user.click(cols(el)[9])
    expect(readout(el).textContent).toContain('300 kcal')
    await user.click(screen.getByRole('button', { name: '7 days' }))
    expect(readout(card('Daily energy')).className).toContain('hint')
  })
})

describe('accessible description', () => {
  it('labels the chart as an image naming the metric and range', async () => {
    const user = userEvent.setup()
    render_([])
    expect(screen.getByRole('img', { name: 'Energy over the last 7 days' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Protein over the last 7 days' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '30 days' }))
    expect(screen.getByRole('img', { name: 'Energy over the last 30 days' })).toBeTruthy()
  })

  it('describes every day, ending with the gaps note', () => {
    render_([entry(0, { calories: 300 })])
    const desc = plot(card('Daily energy')).querySelector('[id$="chart-description"]') as HTMLElement
    expect(plot(card('Daily energy')).getAttribute('aria-describedby')).toBe(desc.id)
    expect(desc.textContent).toContain(`${dayLabel(0)}: 300 kcal`)
    expect(desc.textContent).toContain(`${dayLabel(1)}: no food logged`)
    expect(desc.textContent?.split('. ').filter((s) => s.includes(': '))).toHaveLength(7)
    expect(desc.textContent?.endsWith('Empty dates are shown as gaps; a logged day may be partial.')).toBe(true)
  })

  it('describes the protein chart in grams', () => {
    render_([entry(0, { protein: 12.5 })])
    const desc = plot(card('Daily protein')).querySelector('[id$="chart-description"]') as HTMLElement
    expect(desc.textContent).toContain(`${dayLabel(0)}: 12.5 g`)
  })
})

describe('header and averages', () => {
  it('has one h2, a status line counting logged days and the date span, and no old badge or description', () => {
    render_([entry(0), entry(3)])
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Nutrition insights'])
    expect(screen.getByRole('status').textContent).toBe(`2 of 7 days logged · ${dayLabel(6)} – ${dayLabel(0)}`)
    expect(screen.queryByText('Local data')).toBeNull()
    expect(screen.queryByText('Window')).toBeNull()
  })

  it('updates the status line for 30 days', async () => {
    const user = userEvent.setup()
    render_([entry(0)])
    await user.click(screen.getByRole('button', { name: '30 days' }))
    expect(screen.getByRole('status').textContent).toBe(`1 of 30 days logged · ${dayLabel(29)} – ${dayLabel(0)}`)
  })

  it('averages over logged days only', () => {
    render_([entry(0, { calories: 300, protein: 10 }), entry(2, { calories: 500, protein: 21 })])
    const e = within(card('Daily energy'))
    expect(e.getByText('400')).toBeTruthy()
    expect(e.getByText('average kcal')).toBeTruthy()
    // protein: (10 + 21) / 2 = 15.5, one decimal
    expect(within(card('Daily protein')).getByText('15.5')).toBeTruthy()
  })

  it('shows a dash, not NaN, when nothing is logged', () => {
    render_([])
    ;(['Daily energy', 'Daily protein'] as const).forEach((name) => {
      const el = card(name)
      expect(el.querySelector('.nutrition-card-average strong')?.textContent).toBe('—')
      expect(el.textContent).not.toMatch(/NaN|Infinity/)
    })
    expect(screen.getByRole('status').textContent).toContain('0 of 7 days logged')
    expect(within(card('Daily energy')).getByText('No food logged in the last 7 days')).toBeTruthy()
  })

  it('keeps the daily values table with every day', async () => {
    const user = userEvent.setup()
    render_([entry(0, { calories: 300 })])
    const el = card('Daily energy')
    expect(el.querySelectorAll('tbody tr')).toHaveLength(7)
    expect(within(el).getByText('View daily values')).toBeTruthy()
    expect(within(el).getByText('1 entry')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '30 days' }))
    expect(card('Daily energy').querySelectorAll('tbody tr')).toHaveLength(30)
  })
})

describe('extreme values', () => {
  it('handles a 1e9 day without NaN or Infinity heights and keeps small days visible', () => {
    render_([entry(0, { calories: 1e9, protein: 1e9 }), entry(1, { calories: 5, protein: 5 })], { calories: 2000, protein: 100 })
    ;(['Daily energy', 'Daily protein'] as const).forEach((name) => {
      const el = card(name)
      const c = cols(el)
      expect(pct(c[6])).toBeCloseTo(100)
      expect(pct(c[5])).toBe(2)
      c.forEach((col) => expect(col.outerHTML).not.toMatch(/NaN|Infinity/))
      expect(goalLine(el)?.style.bottom).not.toMatch(/NaN|Infinity/)
      expect(parseFloat(goalLine(el)?.style.bottom ?? '')).toBeGreaterThan(0)
      expect(el.textContent).not.toMatch(/NaN|Infinity/)
    })
  })

  it('treats non-finite stored values as zero instead of producing NaN heights', () => {
    render_([entry(0, { calories: Number.NaN, protein: Infinity }), entry(1, { calories: 400 })])
    const el = card('Daily energy')
    expect(cols(el).every((c) => !/NaN|Infinity/.test(c.outerHTML))).toBe(true)
    expect(pct(cols(el)[6])).toBe(2)
    expect(pct(cols(el)[5])).toBeCloseTo(100)
    expect(card('Daily protein').textContent).not.toMatch(/NaN|Infinity/)
  })

  it('handles fractional tiny scale (values below 1) without NaN', () => {
    render_([entry(0, { calories: 0.4 })])
    const c = cols(card('Daily energy'))[6]
    // scaleMax has a floor of 1, so 0.4 is 40%
    expect(pct(c)).toBeCloseTo(40)
  })
})
