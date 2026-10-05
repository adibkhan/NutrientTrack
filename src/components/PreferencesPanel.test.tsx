import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Preferences } from '../types'
import { PreferencesPanel } from './PreferencesPanel'

afterEach(cleanup)

const theme = () => screen.getByLabelText('Theme') as HTMLSelectElement
const macros = () => screen.getByLabelText('Macro display') as HTMLSelectElement

describe('PreferencesPanel', () => {
  it('shows defaults when preferences are undefined', () => {
    render(<PreferencesPanel preferences={undefined} onChange={vi.fn()} />)
    expect(theme().value).toBe('system')
    expect(macros().value).toBe('grams')
  })

  it('reflects stored preferences', () => {
    render(<PreferencesPanel preferences={{ theme: 'dark', macroDisplay: 'percent' }} onChange={vi.fn()} />)
    expect(theme().value).toBe('dark')
    expect(macros().value).toBe('percent')
  })

  it('falls back to defaults for junk stored values', () => {
    render(<PreferencesPanel preferences={{ theme: 'sepia', macroDisplay: 42 } as unknown as Preferences} onChange={vi.fn()} />)
    expect(theme().value).toBe('system')
    expect(macros().value).toBe('grams')
  })

  it('merges a theme change into existing preferences, keeping unknown keys', async () => {
    const onChange = vi.fn()
    const stored = { macroDisplay: 'percent', futureKey: { a: 1 } } as unknown as Preferences
    render(<PreferencesPanel preferences={stored} onChange={onChange} />)
    await userEvent.setup().selectOptions(theme(), 'dark')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ macroDisplay: 'percent', futureKey: { a: 1 }, theme: 'dark' })
  })

  it('merges a macro display change without dropping the theme', async () => {
    const onChange = vi.fn()
    render(<PreferencesPanel preferences={{ theme: 'light' }} onChange={onChange} />)
    await userEvent.setup().selectOptions(macros(), 'percent')
    expect(onChange).toHaveBeenCalledWith({ theme: 'light', macroDisplay: 'percent' })
  })

  it('emits only the changed key when nothing was stored', async () => {
    const onChange = vi.fn()
    render(<PreferencesPanel preferences={undefined} onChange={onChange} />)
    await userEvent.setup().selectOptions(theme(), 'light')
    expect(onChange).toHaveBeenCalledWith({ theme: 'light' })
  })
})
