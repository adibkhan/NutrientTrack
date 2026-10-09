// A native-path start that fails after the camera is already on must release the camera.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startScanning } from './scanner'

const setMedia = (value: unknown) => Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value })
let tracks: Array<{ stop: ReturnType<typeof vi.fn> }>
const stream = () => ({ getTracks: () => tracks })

beforeEach(() => {
  tracks = [{ stop: vi.fn() }, { stop: vi.fn() }]
  setMedia({ getUserMedia: vi.fn(() => Promise.resolve(stream())) })
  ;(window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = class { detect() { return Promise.resolve([]) } }
})
afterEach(() => {
  delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector
  setMedia(undefined)
})

describe('startScanning native release on failure', () => {
  it('stops_every_track_clears_srcObject_and_rethrows_when_play_rejects', async () => {
    const error = Object.assign(new Error('blocked'), { name: 'NotAllowedError' })
    const video = { srcObject: null as unknown, play: vi.fn(() => Promise.reject(error)) } as unknown as HTMLVideoElement
    await expect(startScanning(video, vi.fn())).rejects.toBe(error)
    expect(tracks[0].stop).toHaveBeenCalledTimes(1)
    expect(tracks[1].stop).toHaveBeenCalledTimes(1)
    expect(video.srcObject).toBeNull()
  })

  it('leaves_the_tracks_running_when_play_succeeds', async () => {
    vi.useFakeTimers()
    const video = { srcObject: null as unknown, play: vi.fn(() => Promise.resolve()) } as unknown as HTMLVideoElement
    const session = await startScanning(video, vi.fn())
    expect(tracks[0].stop).not.toHaveBeenCalled()
    expect(video.srcObject).not.toBeNull()
    session.stop()
    vi.useRealTimers()
  })
})
