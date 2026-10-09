// The camera must be released when the screen is closed or stopped while the camera is still opening.
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('../lib/scanner', () => ({ cameraAvailable: vi.fn(), startScanning: vi.fn() }))
vi.mock('../lib/barcode', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/barcode')>()), lookupBarcode: vi.fn() }))

import { BarcodeLookup } from './BarcodeLookup'
import { cameraAvailable, startScanning } from '../lib/scanner'

const scan = vi.mocked(startScanning)
let stop: Mock<() => void>
let resolveStart: (session: { engine: 'native'; stop: () => void }) => void
let rejectStart: (error: Error) => void
const props = () => ({ enabled: true, onEnable: vi.fn(), onUse: vi.fn(), onBack: vi.fn() })

beforeEach(() => {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn() } })
  vi.mocked(cameraAvailable).mockReturnValue(true)
  stop = vi.fn<() => void>()
  scan.mockImplementation(() => new Promise((resolve, reject) => { resolveStart = resolve as typeof resolveStart; rejectStart = reject }))
})
afterEach(() => {
  cleanup()
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('BarcodeLookup while the camera is still opening', () => {
  it('stops_the_session_once_when_the_start_resolves_after_unmount_without_a_state_update_warning', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { unmount } = render(<BarcodeLookup {...props()} />)
    await screen.findByText('Opening the camera…')
    unmount()
    expect(stop).not.toHaveBeenCalled()
    await act(async () => { resolveStart({ engine: 'native', stop }) })
    expect(stop).toHaveBeenCalledTimes(1)
    expect(errors).not.toHaveBeenCalled()
  })

  it('stops_the_late_session_and_stays_idle_when_Stop_camera_is_pressed_before_it_resolves', async () => {
    const user = userEvent.setup()
    render(<BarcodeLookup {...props()} />)
    await screen.findByText('Opening the camera…')
    await user.click(screen.getByRole('button', { name: 'Stop camera' }))
    await act(async () => { resolveStart({ engine: 'native', stop }) })
    expect(stop).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Point the camera at the barcode. It reads by itself.')).toBeNull()
    expect(screen.getByRole('button', { name: /Scan with camera/ })).toBeTruthy()
  })

  it('ignores_a_start_failure_that_arrives_after_Stop_camera', async () => {
    const user = userEvent.setup()
    render(<BarcodeLookup {...props()} />)
    await screen.findByText('Opening the camera…')
    await user.click(screen.getByRole('button', { name: 'Stop camera' }))
    await act(async () => { rejectStart(Object.assign(new Error('x'), { name: 'NotAllowedError' })) })
    expect(screen.queryByText(/Camera access is blocked/)).toBeNull()
    expect(screen.queryByText(/The camera could not be started/)).toBeNull()
  })

  it('still_scans_when_the_start_resolves_without_a_stop', async () => {
    render(<BarcodeLookup {...props()} />)
    await screen.findByText('Opening the camera…')
    await act(async () => { resolveStart({ engine: 'native', stop }) })
    expect(await screen.findByText('Point the camera at the barcode. It reads by itself.')).toBeTruthy()
    expect(stop).not.toHaveBeenCalled()
  })
})
