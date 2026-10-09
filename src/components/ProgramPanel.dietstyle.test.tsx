import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExpenditureEstimate } from '../lib/expenditure'
import type { Program } from '../types'
import { ProgramPanel } from './ProgramPanel'

afterEach(cleanup)

const ok = (kcalPerDay = 2300): ExpenditureEstimate => ({
  kind: 'ok', kcalPerDay, avgIntake: kcalPerDay, loggedDays: 28, windowDays: 28, weighIns: 10, trendChangeLb: 0, spanDays: 28, impliedBalance: 0, confidence: 'high',
})

function panel(program: Program | undefined, opts: { unit?: 'lb' | 'kg'; trendWeight?: number } = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined)
  const onApplyBudget = vi.fn().mockResolvedValue(undefined)
  render(<ProgramPanel program={program} unit={opts.unit ?? 'lb'} expenditure={ok()} trendWeight={opts.trendWeight} onSave={onSave} onApplyBudget={onApplyBudget} />)
  return { onSave, onApplyBudget }
}
const select = () => screen.getByLabelText('Diet style') as HTMLSelectElement
const NUDGE = /nudge (up|down) to bring your trend back toward your goal weight/

describe('ProgramPanel: maintenance nudge note', () => {
  it('says the budget includes a nudge up when the trend is below the goal', () => {
    panel({ direction: 'maintain', goalWeight: 180 }, { trendWeight: 170 })
    expect(screen.getByText('Includes a 250 kcal nudge up to bring your trend back toward your goal weight.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Set my daily budget to 2,?550 kcal/ })).toBeTruthy()
  })
  it('says nudge down when the trend is above the goal', () => {
    panel({ direction: 'maintain', goalWeight: 180 }, { trendWeight: 190 })
    expect(screen.getByText('Includes a 250 kcal nudge down to bring your trend back toward your goal weight.')).toBeTruthy()
  })
  it('shows no note within the band', () => {
    panel({ direction: 'maintain', goalWeight: 180 }, { trendWeight: 180.5 })
    expect(screen.queryByText(NUDGE)).toBeNull()
  })
  it('shows no note for a lose program', () => {
    panel({ direction: 'lose', goalWeight: 180, weeklyRate: 1 }, { trendWeight: 190 })
    expect(screen.queryByText(NUDGE)).toBeNull()
  })
  it('shows no note without a goal weight', () => {
    panel({ direction: 'maintain' }, { trendWeight: 190 })
    expect(screen.queryByText(NUDGE)).toBeNull()
  })
})

describe('ProgramPanel: diet style', () => {
  it('defaults to Balanced (30% fat) and offers the other styles with their fat share', () => {
    panel(undefined)
    expect(select().value).toBe('')
    expect(screen.getByRole('option', { name: 'Balanced (30% fat)' })).toBeTruthy()
    for (const label of ['Lower fat (20% fat)', 'Lower carb (40% fat)', 'Keto (65% fat)']) expect(screen.getByRole('option', { name: label })).toBeTruthy()
  })
  it('shows the stored style', () => {
    panel({ direction: 'maintain', dietStyle: 'keto' })
    expect(select().value).toBe('keto')
  })
  it('shows balanced for a stored unknown style', () => {
    panel({ direction: 'maintain', dietStyle: 'paleo' } as unknown as Program)
    expect(select().value).toBe('')
  })
  it('saves a non-default style', async () => {
    const { onSave } = panel({ direction: 'maintain' })
    fireEvent.change(select(), { target: { value: 'lowcarb' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save program' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0]).toEqual({ direction: 'maintain', dietStyle: 'lowcarb' })
  })
  it('leaves dietStyle out of the saved program when balanced is chosen', async () => {
    const { onSave } = panel({ direction: 'maintain', dietStyle: 'keto' })
    fireEvent.change(select(), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save program' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect('dietStyle' in onSave.mock.calls[0][0]).toBe(false)
  })
  it('leaves dietStyle out when it was never set', async () => {
    const { onSave } = panel({ direction: 'maintain' })
    fireEvent.click(screen.getByRole('button', { name: 'Save program' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect('dietStyle' in onSave.mock.calls[0][0]).toBe(false)
  })
  it('applies a budget whose fat follows the chosen style while calories stay put', async () => {
    const { onApplyBudget } = panel({ direction: 'maintain', proteinPerWeight: 1 }, { trendWeight: 180 })
    fireEvent.change(select(), { target: { value: 'keto' } })
    fireEvent.click(screen.getByRole('button', { name: /Set my daily budget/ }))
    await waitFor(() => expect(onApplyBudget).toHaveBeenCalledTimes(1))
    expect(onApplyBudget.mock.calls[0][0]).toMatchObject({ calories: 2300, protein: 180, fat: Math.round((2300 * 0.65) / 9) })
  })
})
