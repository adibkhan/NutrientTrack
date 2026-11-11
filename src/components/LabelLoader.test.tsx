import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The label chunk fails to load, as it does offline before the scanner was ever opened.
vi.mock('./LabelScan', () => { throw new Error('Failed to fetch dynamically imported module') })

import { LabelScreen } from './LabelLoader'

afterEach(cleanup)

describe('LabelScreen when its code cannot be downloaded', () => {
  it('shows the offline message with a way back instead of crashing', async () => {
    const onBack = vi.fn()
    render(<LabelScreen onBack={onBack} onUse={vi.fn()} />)
    expect((await screen.findByRole('alert')).textContent).toContain("The label reader isn't available offline yet. Open it once while online.")
    screen.getByRole('button', { name: /Back/ }).click()
    expect(onBack).toHaveBeenCalled()
  })
})
