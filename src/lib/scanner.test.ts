// Camera scanner: native BarcodeDetector first, bundled ZXing otherwise. Only the camera and decoders are faked.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

const zxing = vi.hoisted(() => ({
  stop: vi.fn(),
  decode: vi.fn(),
  hints: undefined as Map<unknown, unknown> | undefined,
}))

vi.mock('@zxing/library', () => ({
  BarcodeFormat: { EAN_13: 'EAN_13', EAN_8: 'EAN_8', UPC_A: 'UPC_A', UPC_E: 'UPC_E' },
  DecodeHintType: { POSSIBLE_FORMATS: 'POSSIBLE_FORMATS', TRY_HARDER: 'TRY_HARDER' },
}))
vi.mock('@zxing/browser', () => ({
  BrowserMultiFormatReader: class {
    constructor(hints: Map<unknown, unknown>) { zxing.hints = hints }
    decodeFromConstraints(constraints: unknown, video: unknown, callback: unknown) { return zxing.decode(constraints, video, callback) }
  },
}))

import { cameraAvailable, startScanning } from './scanner'

const GOOD = '3017620422003'
const BAD_CHECK = '3017620422004'

const track = () => ({ stop: vi.fn() })
const fakeVideo = () => ({ srcObject: null as unknown, play: vi.fn(() => Promise.resolve()) }) as unknown as HTMLVideoElement & { play: ReturnType<typeof vi.fn> }
const setMedia = (value: unknown) => Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value })

let tracks: ReturnType<typeof track>[]
let getUserMedia: ReturnType<typeof vi.fn>

beforeEach(() => {
  tracks = [track(), track()]
  getUserMedia = vi.fn(() => Promise.resolve({ getTracks: () => tracks }))
  setMedia({ getUserMedia })
  zxing.stop = vi.fn()
  zxing.hints = undefined
  zxing.decode = vi.fn(() => Promise.resolve({ stop: zxing.stop }))
})

afterEach(() => {
  vi.useRealTimers()
  delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector
  setMedia(undefined)
})

describe('cameraAvailable', () => {
  it('is false without mediaDevices', () => {
    setMedia(undefined)
    expect(cameraAvailable()).toBe(false)
  })
  it('is false when getUserMedia is missing', () => {
    setMedia({})
    expect(cameraAvailable()).toBe(false)
  })
  it('is true when getUserMedia exists', () => {
    expect(cameraAvailable()).toBe(true)
  })
})

describe('startScanning without a camera', () => {
  it('rejects with camera-unavailable', async () => {
    setMedia(undefined)
    await expect(startScanning(fakeVideo(), vi.fn())).rejects.toThrow('camera-unavailable')
  })
})

describe('startScanning with the native BarcodeDetector', () => {
  let detect: Mock<(video: unknown) => Promise<Array<{ rawValue: string }>>>
  let ctorOptions: unknown

  beforeEach(() => {
    vi.useFakeTimers()
    detect = vi.fn<(video: unknown) => Promise<Array<{ rawValue: string }>>>(() => Promise.resolve([]))
    ;(window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = class {
      constructor(options: unknown) { ctorOptions = options }
      detect(video: unknown) { return detect(video) }
    }
  })

  it('opens_the_rear_camera_attaches_the_stream_and_plays', async () => {
    const video = fakeVideo()
    const session = await startScanning(video, vi.fn())
    expect(session.engine).toBe('native')
    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: 'environment' } })
    expect(video.srcObject).not.toBeNull()
    expect(video.play).toHaveBeenCalledTimes(1)
    expect(ctorOptions).toEqual({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] })
    session.stop()
  })

  it('reports_a_valid_code_once_normalised_and_releases_the_camera', async () => {
    detect.mockResolvedValue([{ rawValue: '3017 6204-22003' }])
    const onCode = vi.fn()
    const video = fakeVideo()
    await startScanning(video, onCode)
    await vi.advanceTimersByTimeAsync(1000)
    expect(onCode).toHaveBeenCalledTimes(1)
    expect(onCode).toHaveBeenCalledWith(GOOD)
    tracks.forEach((t) => expect(t.stop).toHaveBeenCalledTimes(1))
    expect(video.srcObject).toBeNull()
    const calls = detect.mock.calls.length
    await vi.advanceTimersByTimeAsync(1000)
    expect(detect.mock.calls.length).toBe(calls)
  })

  it('ignores_non_numeric_and_bad_check_digit_codes_and_keeps_polling', async () => {
    detect
      .mockResolvedValueOnce([{ rawValue: 'ABC' }])
      .mockResolvedValueOnce([{ rawValue: BAD_CHECK }])
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ rawValue: GOOD }])
    const onCode = vi.fn()
    await startScanning(fakeVideo(), onCode)
    await vi.advanceTimersByTimeAsync(0)
    expect(onCode).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(onCode).toHaveBeenCalledTimes(1)
    expect(onCode).toHaveBeenCalledWith(GOOD)
    expect(detect.mock.calls.length).toBe(4)
  })

  it('keeps_polling_after_a_frame_that_throws', async () => {
    detect.mockRejectedValueOnce(new Error('bad frame')).mockResolvedValue([{ rawValue: GOOD }])
    const onCode = vi.fn()
    await startScanning(fakeVideo(), onCode)
    await vi.advanceTimersByTimeAsync(1000)
    expect(onCode).toHaveBeenCalledWith(GOOD)
  })

  it('polls_about_every_200_ms', async () => {
    await startScanning(fakeVideo(), vi.fn())
    await vi.advanceTimersByTimeAsync(0)
    const start = detect.mock.calls.length
    await vi.advanceTimersByTimeAsync(199)
    expect(detect.mock.calls.length).toBe(start)
    await vi.advanceTimersByTimeAsync(1)
    expect(detect.mock.calls.length).toBe(start + 1)
  })

  it('stop_releases_the_tracks_clears_srcObject_and_suppresses_later_codes', async () => {
    let release: (value: Array<{ rawValue: string }>) => void = () => undefined
    detect.mockImplementation(() => new Promise((resolve) => { release = resolve }))
    const onCode = vi.fn()
    const video = fakeVideo()
    const session = await startScanning(video, onCode)
    session.stop()
    tracks.forEach((t) => expect(t.stop).toHaveBeenCalled())
    expect(video.srcObject).toBeNull()
    release([{ rawValue: GOOD }])
    await vi.advanceTimersByTimeAsync(1000)
    expect(onCode).not.toHaveBeenCalled()
    const calls = detect.mock.calls.length
    await vi.advanceTimersByTimeAsync(1000)
    expect(detect.mock.calls.length).toBe(calls)
  })

  it('propagates_a_camera_permission_error', async () => {
    const denied = Object.assign(new Error('denied'), { name: 'NotAllowedError' })
    getUserMedia.mockRejectedValue(denied)
    await expect(startScanning(fakeVideo(), vi.fn())).rejects.toBe(denied)
  })
})

describe('startScanning with the ZXing fallback', () => {
  const callbackOf = () => zxing.decode.mock.calls[0][2] as (result: { getText: () => string } | null) => void

  it('hints_the_four_product_formats_and_requests_the_rear_camera', async () => {
    const video = fakeVideo()
    const session = await startScanning(video, vi.fn())
    expect(session.engine).toBe('zxing')
    expect(zxing.decode.mock.calls[0][0]).toEqual({ video: { facingMode: 'environment' } })
    expect(zxing.decode.mock.calls[0][1]).toBe(video)
    expect(zxing.hints?.get('POSSIBLE_FORMATS')).toEqual(['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E'])
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('reports_a_hit_once_normalised_and_stops_the_controls', async () => {
    const onCode = vi.fn()
    await startScanning(fakeVideo(), onCode)
    const cb = callbackOf()
    cb({ getText: () => '3017 6204 22003' })
    cb({ getText: () => GOOD })
    expect(onCode).toHaveBeenCalledTimes(1)
    expect(onCode).toHaveBeenCalledWith(GOOD)
    expect(zxing.stop).toHaveBeenCalledTimes(1)
  })

  it('ignores_a_null_result', async () => {
    const onCode = vi.fn()
    await startScanning(fakeVideo(), onCode)
    callbackOf()(null)
    expect(onCode).not.toHaveBeenCalled()
    expect(zxing.stop).not.toHaveBeenCalled()
  })

  it('ignores_invalid_text_and_keeps_decoding', async () => {
    const onCode = vi.fn()
    await startScanning(fakeVideo(), onCode)
    const cb = callbackOf()
    cb({ getText: () => 'ABC' })
    cb({ getText: () => BAD_CHECK })
    expect(onCode).not.toHaveBeenCalled()
    expect(zxing.stop).not.toHaveBeenCalled()
    cb({ getText: () => GOOD })
    expect(onCode).toHaveBeenCalledWith(GOOD)
  })

  it('stop_stops_the_controls_and_suppresses_later_codes', async () => {
    const onCode = vi.fn()
    const session = await startScanning(fakeVideo(), onCode)
    session.stop()
    expect(zxing.stop).toHaveBeenCalledTimes(1)
    callbackOf()({ getText: () => GOOD })
    expect(onCode).not.toHaveBeenCalled()
  })
})
