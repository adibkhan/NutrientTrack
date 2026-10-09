import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExpenditureEstimate } from '../lib/expenditure'
import type { Program } from '../types'
import { ProgramPanel } from './ProgramPanel'

afterEach(cleanup)

const ok: ExpenditureEstimate = {
  kind: 'ok', kcalPerDay: 2300, avgIntake: 2300, loggedDays: 28, windowDays: 28, weighIns: 10, trendChangeLb: 0, spanDays: 28, impliedBalance: 0, confidence: 'high',
}
const insufficient: ExpenditureEstimate = { kind: 'insufficient', reason: 'Not enough.', loggedDays: 0, weighIns: 0 }

function panel(program: Program | undefined, expenditure: ExpenditureEstimate, trendWeight?: number) {
  render(<ProgramPanel program={program} unit="lb" expenditure={expenditure} trendWeight={trendWeight} onSave={vi.fn()} onApplyBudget={vi.fn()} />)
}
const value = (label: string) => screen.getByText(label, { selector: '.stat-row span' }).parentElement?.querySelector('strong')?.textContent
const HINT = 'Choose a weekly rate to see your budget.'
const setButton = () => screen.queryByRole('button', { name: /Set my daily budget/ })

describe('ProgramPanel: weekly rate', () => {
  it.each(['lose', 'gain'] as const)('shows no budget, no button and a hint when %s has no rate', (direction) => {
    panel({ direction }, ok, 180)
    expect(value('Resulting budget')).toBe('—')
    expect(setButton()).toBeNull()
    expect(screen.getByText(HINT)).toBeTruthy()
  })

  it('needs no rate for maintain: budget and button show, no hint', () => {
    panel({ direction: 'maintain' }, ok, 180)
    expect(value('Resulting budget')).toMatch(/2,?300 kcal/)
    expect(setButton()).toBeTruthy()
    expect(screen.queryByText(HINT)).toBeNull()
  })

  it('brings the budget and button back once a rate is chosen', () => {
    panel({ direction: 'lose' }, ok, 180)
    expect(setButton()).toBeNull()
    fireEvent.change(screen.getByLabelText(/^Rate/), { target: { value: '1' } })
    expect(value('Resulting budget')).toMatch(/1,?800 kcal/)
    expect(setButton()).toBeTruthy()
    expect(screen.queryByText(HINT)).toBeNull()
  })

  it('shows no hint when no direction is chosen', () => {
    panel(undefined, ok, 180)
    expect(screen.queryByText(HINT)).toBeNull()
  })
})

describe('ProgramPanel: protein target', () => {
  it('computes grams from protein per weight and trend weight even when expenditure is insufficient', () => {
    panel({ direction: 'maintain', proteinPerWeight: 0.8 }, insufficient, 180)
    expect(value('Protein target')).toBe('144 g')
  })

  it('shows a dash without a trend weight', () => {
    panel({ direction: 'maintain', proteinPerWeight: 0.8 }, insufficient, undefined)
    expect(value('Protein target')).toBe('—')
  })

  it('shows a dash without a protein per weight setting', () => {
    panel({ direction: 'maintain' }, insufficient, 180)
    expect(value('Protein target')).toBe('—')
  })
})
