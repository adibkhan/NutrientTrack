// The card says when the weekly change was held to 250 kcal.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CheckIn } from '../lib/program'
import { CheckInCard } from './CheckInCard'

afterEach(cleanup)

const checkIn = (limited: boolean): CheckIn => ({
  dueDate: '2026-03-15', weekEnding: '2026-03-14', daysLogged: 7, avgIntake: 2000, unit: 'lb',
  expenditure: { kind: 'ok', kcalPerDay: 2300, avgIntake: 2000, loggedDays: 20, windowDays: 28, weighIns: 5, trendChangeLb: 0, spanDays: 20, impliedBalance: -300, confidence: 'medium' },
  currentBudget: 2000, newBudget: { calories: 1750, floored: false }, ...(limited ? { limited } : {}), headline: 'The budget falls by 250 kcal.',
})

describe('CheckInCard change limit', () => {
  it('explains_a_capped_change', () => {
    render(<CheckInCard checkIn={checkIn(true)} onAccept={vi.fn()} onKeep={vi.fn()} />)
    expect(screen.getByText('Moving gradually: capped at 250 kcal this week.')).toBeTruthy()
  })
  it('stays_quiet_otherwise', () => {
    render(<CheckInCard checkIn={checkIn(false)} onAccept={vi.fn()} onKeep={vi.fn()} />)
    expect(screen.queryByText(/Moving gradually/)).toBeNull()
  })
})
