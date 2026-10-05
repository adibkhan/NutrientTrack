// BarcodeLookup camera flow. The scanner and the Open Food Facts lookup are faked; the component runs for real.
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('../lib/scanner', () => ({ cameraAvailable: vi.fn(), startScanning: vi.fn() }))
vi.mock('../lib/barcode', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/barcode')>()), lookupBarcode: vi.fn() }))

import { BarcodeLookup } from './BarcodeLookup'
import { lookupBarcode } from '../lib/barcode'
import { cameraAvailable, startScanning } from '../lib/scanner'

const CODE = '3017620422003'
const FOUND = { kind: 'found', product: { code: CODE, name: 'Hazelnut spread', brand: 'Nutella', per100g: { calories: 539, protein: 6.3, carbs: 57.5, fat: 30.9 } } }

const scan = vi.mocked(startScanning)
const lookup = vi.mocked(lookupBarcode)
let stop: Mock<() => void>
let deliver: (code: string) => void

const setMedia = (value: unknown) => Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value })
const props = () => ({ enabled: true, onEnable: vi.fn(), onUse: vi.fn(), onBack: vi.fn() })
const reject = (name: string) => scan.mockRejectedValue(Object.assign(new Error(name), { name }))

beforeEach(() => {
  setMedia({ getUserMedia: vi.fn() })
  vi.mocked(cameraAvailable).mockReturnValue(true)
  stop = vi.fn<() => void>()
  deliver = () => undefined
  scan.mockImplementation((_video, onCode) => { deliver = onCode; return Promise.resolve({ engine: 'native', stop }) })
  lookup.mockResolvedValue(FOUND as never)
})

afterEach(() => {
  cleanup()
  setMedia(undefined)
  vi.clearAllMocks()
})

describe('BarcodeLookup without a camera', () => {
  beforeEach(() => {
    setMedia(undefined)
    vi.mocked(cameraAvailable).mockReturnValue(false)
  })

  it('hides_the_viewfinder_offers_no_scan_button_and_says_the_browser_cannot_use_the_camera', () => {
    const { container } = render(<BarcodeLookup {...props()} />)
    expect(container.querySelector('.barcode-viewfinder')).toHaveProperty('hidden', true)
    expect(screen.queryByRole('button', { name: /Scan with camera/ })).toBeNull()
    expect(screen.getByText(/This browser cannot use the camera/)).toBeTruthy()
    expect(scan).not.toHaveBeenCalled()
  })
})

describe('BarcodeLookup with a camera', () => {
  it('auto_starts_shows_progress_then_the_scanning_prompt_and_a_stop_button', async () => {
    let finish: (session: { engine: 'native'; stop: () => void }) => void = () => undefined
    scan.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    render(<BarcodeLookup {...props()} />)
    expect(await screen.findByText('Opening the camera…')).toBeTruthy()
    await act(async () => { finish({ engine: 'native', stop }) })
    expect(await screen.findByText('Point the camera at the barcode. It reads by itself.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop camera' })).toBeTruthy()
    expect(scan).toHaveBeenCalledTimes(1)
  })

  it('puts_a_scanned_code_in_the_field_and_looks_it_up_exactly_once', async () => {
    render(<BarcodeLookup {...props()} />)
    await screen.findByRole('button', { name: 'Stop camera' })
    await act(async () => { deliver(CODE) })
    expect(await screen.findByText('Hazelnut spread')).toBeTruthy()
    expect((screen.getByLabelText('Barcode number') as HTMLInputElement).value).toBe(CODE)
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(lookup).toHaveBeenCalledWith(CODE)
  })

  it('shows_the_blocked_message_and_retry_button_when_permission_is_denied_without_a_lookup', async () => {
    reject('NotAllowedError')
    render(<BarcodeLookup {...props()} />)
    expect(await screen.findByText(/Camera access is blocked for this site/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try the camera again' })).toBeTruthy()
    expect(lookup).not.toHaveBeenCalled()
  })

  it('shows_the_no_camera_message_for_NotFoundError', async () => {
    reject('NotFoundError')
    render(<BarcodeLookup {...props()} />)
    expect(await screen.findByText(/No camera was found on this device/)).toBeTruthy()
    expect(lookup).not.toHaveBeenCalled()
  })

  it('shows_a_generic_message_for_other_camera_failures', async () => {
    reject('AbortError')
    render(<BarcodeLookup {...props()} />)
    expect(await screen.findByText(/The camera could not be started/)).toBeTruthy()
  })

  it('stops_the_session_on_unmount', async () => {
    const { unmount } = render(<BarcodeLookup {...props()} />)
    await screen.findByRole('button', { name: 'Stop camera' })
    unmount()
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('stop_camera_stops_the_session_and_brings_back_scan_with_camera', async () => {
    const user = userEvent.setup()
    render(<BarcodeLookup {...props()} />)
    await user.click(await screen.findByRole('button', { name: 'Stop camera' }))
    expect(stop).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: /Scan with camera/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Stop camera' })).toBeNull()
  })

  it('never_auto_starts_when_lookup_is_not_enabled', () => {
    render(<BarcodeLookup {...props()} enabled={false} />)
    expect(scan).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Turn on barcode lookup' })).toBeTruthy()
  })

  it('starts_the_scanner_when_enabled_flips_to_true', async () => {
    const p = props()
    const { rerender } = render(<BarcodeLookup {...p} enabled={false} />)
    expect(scan).not.toHaveBeenCalled()
    rerender(<BarcodeLookup {...p} enabled />)
    await waitFor(() => expect(scan).toHaveBeenCalledTimes(1))
  })

  it('scan_another_starts_the_scanner_again_after_a_found_product', async () => {
    const user = userEvent.setup()
    render(<BarcodeLookup {...props()} />)
    await screen.findByRole('button', { name: 'Stop camera' })
    await act(async () => { deliver(CODE) })
    await user.click(await screen.findByRole('button', { name: 'Scan another' }))
    await waitFor(() => expect(scan).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('button', { name: 'Stop camera' })).toBeTruthy()
    expect(screen.queryByText('Hazelnut spread')).toBeNull()
    expect((screen.getByLabelText('Barcode number') as HTMLInputElement).value).toBe('')
  })

  it('back_stops_the_camera_and_calls_onBack', async () => {
    const user = userEvent.setup()
    const p = props()
    render(<BarcodeLookup {...p} />)
    await screen.findByRole('button', { name: 'Stop camera' })
    await user.click(screen.getByRole('button', { name: /Back to food search/ }))
    expect(stop).toHaveBeenCalled()
    expect(p.onBack).toHaveBeenCalledTimes(1)
  })
})
