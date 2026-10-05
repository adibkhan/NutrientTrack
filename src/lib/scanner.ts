import { normalizeBarcode } from './barcode'

/** Product barcode symbologies: EAN-13, EAN-8, UPC-A and UPC-E. The decoder expands UPC-E to its 12-digit form. */
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const

export interface ScanSession {
  /** Which decoder is reading frames. */
  engine: 'native' | 'zxing'
  stop: () => void
}

interface NativeDetector {
  detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>>
}

type NativeDetectorConstructor = new (options: { formats: string[] }) => NativeDetector

const nativeDetector = (): NativeDetectorConstructor | undefined =>
  (typeof window !== 'undefined' ? (window as unknown as { BarcodeDetector?: NativeDetectorConstructor }).BarcodeDetector : undefined)

export const cameraAvailable = (): boolean =>
  typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)

/**
 * Open the rear camera into `video` and call `onCode` with the first valid product barcode. Uses the browser's own
 * BarcodeDetector when it has one (Chrome on Android and macOS), otherwise the bundled ZXing decoder, which is loaded
 * on demand so it costs nothing until someone scans. Resolves once frames are being read; rejects if the camera
 * cannot be opened. The returned session must be stopped to release the camera.
 */
export const startScanning = async (video: HTMLVideoElement, onCode: (code: string) => void): Promise<ScanSession> => {
  if (!cameraAvailable()) throw new Error('camera-unavailable')
  let stopped = false
  const accept = (raw: string | undefined): boolean => {
    const code = raw ? normalizeBarcode(raw) : undefined
    if (!code || stopped) return false
    stopped = true
    onCode(code)
    return true
  }

  const Native = nativeDetector()
  if (Native) {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    video.srcObject = stream
    await video.play()
    const detector = new Native({ formats: [...FORMATS] })
    const stop = () => {
      stopped = true
      stream.getTracks().forEach((track) => track.stop())
      video.srcObject = null
    }
    const tick = async () => {
      if (stopped) return
      try {
        const found = await detector.detect(video)
        if (found.some((item) => accept(item.rawValue))) { stop(); return }
      } catch {
        // A frame that cannot be read is skipped.
      }
      window.setTimeout(() => { void tick() }, 200)
    }
    void tick()
    return { engine: 'native', stop }
  }

  const { BrowserMultiFormatReader } = await import('@zxing/browser')
  const { BarcodeFormat, DecodeHintType } = await import('@zxing/library')
  const hints = new Map()
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E])
  hints.set(DecodeHintType.TRY_HARDER, true)
  const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150, delayBetweenScanSuccess: 500 })
  const controls = await reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, video, (result) => {
    if (result && accept(result.getText())) controls.stop()
  })
  return {
    engine: 'zxing',
    stop: () => {
      stopped = true
      controls.stop()
    },
  }
}
