import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiaryEntry, Food, WeightEntry } from '../types'
import { todayISO } from '../lib/utils'

vi.mock('../lib/csv', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/csv')>()),
  downloadTextFile: vi.fn(),
}))

import { downloadTextFile } from '../lib/csv'
import { ExportTools } from './ExportTools'

const stamp = '2026-01-01T00:00:00.000Z'
const entry = (id: string): DiaryEntry => ({ id, date: '2026-03-02', meal: 'lunch', name: `Food ${id}`, calories: 1, protein: 1, carbs: 1, fat: 1, createdAt: stamp, updatedAt: stamp })
const weight = (id: string): WeightEntry => ({ id, date: '2026-03-02', weight: 180, unit: 'lb', createdAt: stamp }) as WeightEntry
const food = (id: string): Food => ({ id, name: `F${id}`, serving: '1', calories: 1, protein: 1, carbs: 1, fat: 1, createdAt: stamp, updatedAt: stamp })

afterEach(() => { cleanup(); vi.clearAllMocks() })

const rowFor = (label: string) => screen.getByText(label).closest('.tool-row') as HTMLElement

describe('ExportTools', () => {
  it('shows row counts with singular and plural wording', () => {
    render(<ExportTools entries={[entry('1'), entry('2')]} weights={[weight('1')]} foods={[]} onExported={vi.fn()} />)
    expect(within(rowFor('Food diary')).getByText('2 rows')).toBeTruthy()
    expect(within(rowFor('Weight log')).getByText('1 row')).toBeTruthy()
    expect(within(rowFor('Saved foods')).getByText('Nothing here yet.')).toBeTruthy()
  })

  it('disables the CSV button for an empty list and not for a filled one', () => {
    render(<ExportTools entries={[entry('1')]} weights={[]} foods={[]} onExported={vi.fn()} />)
    expect(within(rowFor('Food diary')).getByRole('button', { name: 'CSV' })).toHaveProperty('disabled', false)
    expect(within(rowFor('Weight log')).getByRole('button', { name: 'CSV' })).toHaveProperty('disabled', true)
    expect(within(rowFor('Saved foods')).getByRole('button', { name: 'CSV' })).toHaveProperty('disabled', true)
  })

  it('does not download when a disabled button is clicked', async () => {
    const onExported = vi.fn()
    render(<ExportTools entries={[]} weights={[]} foods={[]} onExported={onExported} />)
    await userEvent.click(within(rowFor('Food diary')).getByRole('button', { name: 'CSV' }))
    expect(downloadTextFile).not.toHaveBeenCalled()
    expect(onExported).not.toHaveBeenCalled()
  })

  it.each([
    ['Food diary', 'diary', 'Date,Time,Meal'],
    ['Weight log', 'weights', 'Date,Weight,Unit,Body fat (%),Note'],
    ['Saved foods', 'foods', 'Food,Serving,Calories'],
  ])('downloads %s with a dated filename and reports it', async (label, slug, header) => {
    const onExported = vi.fn()
    render(<ExportTools entries={[entry('1')]} weights={[weight('1')]} foods={[food('1')]} onExported={onExported} />)
    await userEvent.click(within(rowFor(label)).getByRole('button', { name: 'CSV' }))
    expect(downloadTextFile).toHaveBeenCalledTimes(1)
    const [file, text] = vi.mocked(downloadTextFile).mock.calls[0]
    expect(file).toBe(`nutrienttrack-${slug}-${todayISO()}.csv`)
    expect(text).toContain(header)
    expect(onExported).toHaveBeenCalledWith(`${label} exported as CSV.`)
  })
})
