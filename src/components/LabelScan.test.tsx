import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { parseLabel } from '../lib/labelParse'
import { LabelScan } from './LabelScan'

vi.mock('../lib/labelOcr', () => ({ releaseOcr: vi.fn(() => Promise.resolve()), recognizeText: vi.fn() }))

const LABEL = 'Nutrition Facts\nServing size 1 cup (240g)\nCalories 120\nTotal Fat 8g 10%\nTotal Carbohydrate 5g 2%\nProtein 6g'
const photo = () => new File(['x'], 'label.jpg', { type: 'image/jpeg' })

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:photo')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('LabelScan', () => {
  it('offers a camera input and a gallery input', () => {
    render(<LabelScan onBack={vi.fn()} onUse={vi.fn()} read={vi.fn()} />)
    const camera = screen.getByLabelText('Take a photo of the label') as HTMLInputElement
    const gallery = screen.getByLabelText('Choose a photo of the label') as HTMLInputElement
    expect(camera.type).toBe('file')
    expect(camera.accept).toBe('image/*')
    expect(camera.getAttribute('capture')).toBe('environment')
    expect(gallery.getAttribute('capture')).toBeNull()
  })

  it('shows the photo and a progress state, then the parsed values with Check marks, and hands them over only when asked', async () => {
    let finish: (value: ReturnType<typeof parseLabel>) => void = () => undefined
    const read = vi.fn((_file: Blob, onProgress: (n: { stage: 'read'; percent: number }) => void) => { onProgress({ stage: 'read', percent: 40 }); return new Promise<ReturnType<typeof parseLabel>>((resolve) => { finish = resolve }) })
    const onUse = vi.fn()
    const user = userEvent.setup()
    render(<LabelScan onBack={vi.fn()} onUse={onUse} read={read} />)
    await user.upload(screen.getByLabelText('Choose a photo of the label'), photo())
    expect((await screen.findByRole('status')).textContent).toContain('Reading label…')
    expect(screen.getByRole('status').textContent).toContain('40%')
    expect((screen.getByAltText('Your label photo') as HTMLImageElement).src).toContain('blob:photo')
    finish(parseLabel(`${LABEL}\nSodium 600mg 7%`))
    expect(await screen.findByText('Use these values')).toBeTruthy()
    expect(screen.getByText('Calories').nextSibling?.textContent).toContain('120 kcal')
    expect(screen.getByText('Sodium').nextSibling?.textContent).toContain('Check')
    expect(onUse).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /Use these values/ }))
    expect(onUse).toHaveBeenCalledTimes(1)
    const fill = onUse.mock.calls[0][0]
    expect(onUse.mock.calls[0][1]).toBeInstanceOf(File)
    expect(fill.fields.calories).toBe('120')
    expect(fill.fields.servings).toBe('1')
    expect(fill.checks.map((check: { id: string }) => check.id)).toEqual(['sodium'])
    expect(fill.fields.serving).toBe('1 cup (240g)')
  })

  it('says it could not read the label when there are no calories, and offers to type it in', async () => {
    const onBack = vi.fn()
    const user = userEvent.setup()
    render(<LabelScan onBack={onBack} onUse={vi.fn()} read={() => Promise.resolve(parseLabel('blurry nonsense'))} />)
    await user.upload(screen.getByLabelText('Take a photo of the label'), photo())
    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't read this label. Try a flatter, closer photo, or type it in.")
    await user.click(screen.getByRole('button', { name: 'Type it in' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('reports an engine that could not start, and revokes the photo URL on close', async () => {
    const user = userEvent.setup()
    const view = render(<LabelScan onBack={vi.fn()} onUse={vi.fn()} read={() => Promise.reject(new Error('offline'))} />)
    await user.upload(screen.getByLabelText('Choose a photo of the label'), photo())
    expect((await screen.findByRole('alert')).textContent).toContain('could not start')
    view.unmount()
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo'))
  })

  it('says the reader could not be downloaded, with the retry hint', async () => {
    const user = userEvent.setup()
    const error = Object.assign(new Error('x'), { name: 'OcrLoadError' })
    render(<LabelScan onBack={vi.fn()} onUse={vi.fn()} read={() => Promise.reject(error)} />)
    await user.upload(screen.getByLabelText('Choose a photo of the label'), photo())
    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't download the label reader. Check your connection and try again.")
  })

  it('says the file is not a photo and hides the broken image', async () => {
    const user = userEvent.setup()
    const error = Object.assign(new Error('x'), { name: 'UnreadableImageError' })
    render(<LabelScan onBack={vi.fn()} onUse={vi.fn()} read={() => Promise.reject(error)} />)
    await user.upload(screen.getByLabelText('Choose a photo of the label'), new File(['x'], 'label.heic', { type: 'image/heic' }))
    expect((await screen.findByRole('alert')).textContent).toContain("This file isn't a photo we can open. Try a JPEG or PNG, or take the photo here.")
    fireEvent.error(screen.getByAltText('Your label photo'))
    expect(screen.queryByAltText('Your label photo')).toBeNull()
  })

  it('shows the one-time download label while the reader loads', async () => {
    const user = userEvent.setup()
    render(<LabelScan onBack={vi.fn()} onUse={vi.fn()} read={(_f, onProgress) => { onProgress({ stage: 'download', percent: 0 }); return new Promise(() => undefined) }} />)
    await user.upload(screen.getByLabelText('Choose a photo of the label'), photo())
    expect((await screen.findByRole('status')).textContent).toContain('Downloading the reader, one time, 4 MB')
  })

  it('never writes the photo to storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const user = userEvent.setup()
    render(<LabelScan onBack={vi.fn()} onUse={vi.fn()} read={() => Promise.resolve(parseLabel(LABEL))} />)
    await user.upload(screen.getByLabelText('Choose a photo of the label'), photo())
    await screen.findByText('Use these values')
    expect(setItem).not.toHaveBeenCalled()
  })
})
