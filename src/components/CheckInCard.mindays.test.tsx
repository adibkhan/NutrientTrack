// Accept is off when the week has too few logged days, even though the card shows a new budget.
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MIN_CHECKIN_DAYS, type CheckIn } from '../lib/program'
import { CheckInCard } from './CheckInCard'

afterEach(cleanup)

const checkIn = (daysLogged: number): CheckIn => ({
  dueDate: '2026-03-15', weekEnding: '2026-03-14', daysLogged, avgIntake: 2000, unit: 'lb',
  expenditure: { kind: 'ok', kcalPerDay: 2300, avgIntake: 2000, loggedDays: 20, windowDays: 28, weighIns: 5, trendChangeLb: 0, spanDays: 20, impliedBalance: -300, confidence: 'medium' },
  currentBudget: 2000, newBudget: { calories: 1800, floored: false }, headline: 'The budget falls by 200 kcal.',
})
const accept = () => screen.getByRole('button', { name: /Accept new budget/ }) as HTMLButtonElement
const keep = () => screen.getByRole('button', { name: /Keep current budget/ }) as HTMLButtonElement

describe('CheckInCard minimum logged days', () => {
  it('disables Accept at one day below the minimum but keeps Keep enabled', () => {
    render(<CheckInCard checkIn={checkIn(MIN_CHECKIN_DAYS - 1)} onAccept={vi.fn()} onKeep={vi.fn()} />)
    expect(accept().disabled).toBe(true)
    expect(keep().disabled).toBe(false)
  })

  it('disables Accept with zero logged days', () => {
    render(<CheckInCard checkIn={checkIn(0)} onAccept={vi.fn()} onKeep={vi.fn()} />)
    expect(accept().disabled).toBe(true)
  })

  it('enables Accept at exactly the minimum', async () => {
    const onAccept = vi.fn(() => Promise.resolve())
    render(<CheckInCard checkIn={checkIn(MIN_CHECKIN_DAYS)} onAccept={onAccept} onKeep={vi.fn()} />)
    expect(accept().disabled).toBe(false)
    await userEvent.setup().click(accept())
    expect(onAccept).toHaveBeenCalledTimes(1)
  })

  it('does not call onAccept when a disabled Accept is clicked, and Keep still works', async () => {
    const onAccept = vi.fn(() => Promise.resolve())
    const onKeep = vi.fn(() => Promise.resolve())
    render(<CheckInCard checkIn={checkIn(3)} onAccept={onAccept} onKeep={onKeep} />)
    const user = userEvent.setup()
    await user.click(accept())
    await user.click(keep())
    expect(onAccept).not.toHaveBeenCalled()
    expect(onKeep).toHaveBeenCalledTimes(1)
  })
})
