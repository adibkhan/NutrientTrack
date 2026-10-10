import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PortionPicker, portionChipLabel } from './PortionPicker'

afterEach(cleanup)

const portions: Array<[string, number]> = [['1 large', 50], ['1 medium (7" to 7-7/8" long)', 118], ['1 cup, chopped', 128]]

function Harness({ onPick }: { onPick: (grams: number, label: string) => void }) {
  const [grams, setGrams] = useState(100)
  return <><PortionPicker portions={portions} grams={grams} onPick={(next, label) => { setGrams(next); onPick(next, label) }} /><button type="button" onClick={() => setGrams(42)}>type grams</button></>
}

describe('PortionPicker', () => {
  it('shortens_USDA_size_notes_for_the_chip', () => {
    expect(portionChipLabel('1 medium (7" to 7-7/8" long)')).toBe('1 medium')
    expect(portionChipLabel('1 cup, chopped')).toBe('1 cup, chopped')
  })

  it('sets_one_portion_and_adds_another_on_each_repeat_tap', async () => {
    const onPick = vi.fn()
    const user = userEvent.setup()
    render(<Harness onPick={onPick} />)
    const egg = screen.getByRole('button', { name: /1 large/ })
    await user.click(egg)
    expect(onPick).toHaveBeenLastCalledWith(50, '1 large')
    await user.click(egg)
    expect(onPick).toHaveBeenLastCalledWith(100, '2 × 1 large')
    expect(egg.getAttribute('aria-pressed')).toBe('true')
    expect(egg.textContent).toContain('2×')
    await user.click(screen.getByRole('button', { name: /1 medium/ }))
    expect(onPick).toHaveBeenLastCalledWith(118, '1 medium')
  })

  it('clears_the_selection_when_grams_are_changed_by_hand', async () => {
    const user = userEvent.setup()
    render(<Harness onPick={() => undefined} />)
    const cup = screen.getByRole('button', { name: /1 cup, chopped/ })
    await user.click(cup)
    expect(cup.getAttribute('aria-pressed')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'type grams' }))
    expect(cup.getAttribute('aria-pressed')).toBe('false')
  })
})
