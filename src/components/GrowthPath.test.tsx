import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GrowthPath } from './GrowthPath'
import { pipGrowth } from '../lib/pipGrowth'
import type { DiaryEntry } from '../types'

afterEach(cleanup)
const entry = (date: string): DiaryEntry => ({ id: date, date, meal: 'lunch', name: 'Rice', calories: 1, protein: 0, carbs: 0, fat: 0, createdAt: 'x', updatedAt: 'x' })

describe('GrowthPath', () => {
  it('marks_reached_current_and_upcoming_stages_with_days_to_go', () => {
    const growth = pipGrowth(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'].map(entry), '2026-10-05')
    render(<GrowthPath growth={growth} />)
    const items = within(screen.getByRole('list', { name: 'Pip’s growth stages' })).getAllByRole('listitem')
    expect(items.map((item) => item.className.replace('growth-stage ', ''))).toEqual(['is-reached', 'is-current', 'is-ahead', 'is-ahead', 'is-ahead'])
    expect(items[1].getAttribute('aria-current')).toBe('step')
    expect(items[1].textContent).toContain('You are here')
    expect(items[2].textContent).toContain('2 more days')
    expect(items[4].textContent).toContain('25 more days')
    expect(items[4].textContent).toContain('A soft glow all around')
  })
})
