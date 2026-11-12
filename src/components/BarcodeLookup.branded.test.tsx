// BarcodeLookup and the self-hosted brand list: it is tried first, needs no opt-in, and only a miss goes on.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrandedProduct } from '../catalog/branded'

vi.mock('../lib/scanner', () => ({ cameraAvailable: vi.fn(() => false), startScanning: vi.fn() }))
vi.mock('../lib/barcode', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/barcode')>()), lookupBarcode: vi.fn() }))
vi.mock('../lib/brandedApp', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/brandedApp')>()), findBarcode: vi.fn() }))

import { BarcodeLookup } from './BarcodeLookup'
import { lookupBarcode } from '../lib/barcode'
import { findBarcode } from '../lib/brandedApp'

const CODE = '012345678905'
const PRODUCT = { gtin: '00012345678905', fdcId: 1, name: 'Vanilla Greek Yogurt', brand: 'Chobani', category: 'Yogurt', per100: { calories: 80, protein: 9, fat: 0, carbs: 10 }, nutrients: {} } as BrandedProduct
const online = vi.mocked(lookupBarcode)
const own = vi.mocked(findBarcode)
const props = (enabled: boolean) => ({ enabled, onEnable: vi.fn(), onUse: vi.fn(), onBack: vi.fn(), onBranded: vi.fn(), onLabel: vi.fn(), onManual: vi.fn() })

beforeEach(() => { online.mockResolvedValue({ kind: 'not-found' }) })
afterEach(() => { cleanup(); vi.clearAllMocks() })

const lookUp = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText('Barcode number'), CODE)
  await user.click(screen.getByRole('button', { name: 'Look up' }))
}

describe('BarcodeLookup with the brand list', () => {
  it('hands a product from the brand list to the logger, with the opt-in off, and sends nothing else', async () => {
    own.mockResolvedValue({ product: PRODUCT })
    const p = props(false)
    render(<BarcodeLookup {...p} />)
    await lookUp(userEvent.setup())
    await waitFor(() => expect(p.onBranded).toHaveBeenCalledWith(PRODUCT))
    expect(own).toHaveBeenCalledWith(CODE)
    expect(online).not.toHaveBeenCalled()
  })

  it('does not go online after a hit, even with the opt-in on', async () => {
    own.mockResolvedValue({ product: PRODUCT })
    const p = props(true)
    render(<BarcodeLookup {...p} />)
    await lookUp(userEvent.setup())
    await waitFor(() => expect(p.onBranded).toHaveBeenCalledTimes(1))
    expect(online).not.toHaveBeenCalled()
  })

  it('goes on to the online lookup on a miss when the opt-in is on', async () => {
    own.mockResolvedValue({ reason: 'not-found' })
    render(<BarcodeLookup {...props(true)} />)
    await lookUp(userEvent.setup())
    await waitFor(() => expect(online).toHaveBeenCalledWith(CODE))
    expect(await screen.findByText('No product found')).toBeTruthy()
  })

  it('on a miss with the opt-in off, offers the three ways on and calls nothing online', async () => {
    own.mockResolvedValue({ reason: 'not-found' })
    const p = props(false)
    render(<BarcodeLookup {...p} />)
    const user = userEvent.setup()
    await lookUp(user)
    expect(await screen.findByText('Not in the brand list')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Turn on online lookup' }))
    expect(p.onEnable).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: /Scan the nutrition label instead/ }))
    expect(p.onLabel).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: /Enter it by hand/ }))
    expect(p.onManual).toHaveBeenCalledTimes(1)
    expect(online).not.toHaveBeenCalled()
  })

  it('looks the same code up online right after the opt-in is turned on from the prompt', async () => {
    own.mockResolvedValue({ reason: 'not-found' })
    const p = props(false)
    const { rerender } = render(<BarcodeLookup {...p} />)
    await lookUp(userEvent.setup())
    await screen.findByText('Not in the brand list')
    rerender(<BarcodeLookup {...p} enabled />)
    await waitFor(() => expect(online).toHaveBeenCalledWith(CODE))
  })

  it('says the list is unreachable (not "not in the list") when the miss was a connection failure', async () => {
    own.mockResolvedValue({ reason: 'offline' })
    render(<BarcodeLookup {...props(false)} />)
    await lookUp(userEvent.setup())
    expect(await screen.findByText('Brand list not reachable')).toBeTruthy()
  })

  it('does not ask the brand list about an invalid number', async () => {
    render(<BarcodeLookup {...props(false)} />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Barcode number'), '012345678906')
    await user.click(screen.getByRole('button', { name: 'Look up' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/not a valid barcode number/)
    expect(own).not.toHaveBeenCalled()
  })
})
