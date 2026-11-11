/**
 * The OCR engine for label photos: Tesseract compiled to WebAssembly, run in a worker, entirely on the device.
 * Everything it needs is served from this app's own origin under /ocr/ (copied from node_modules at build time by
 * scripts/copy-ocr-assets.mjs): the worker script, the wasm core and the English model. Nothing comes from a CDN.
 * This module and the library are imported only when someone opens the label scanner, like the barcode decoder.
 */

export interface OcrProgress { status: string; progress: number }

/** One recognised line with how sure the engine was (0 to 100): the mean over its words, and the weakest word that holds a digit. */
export interface OcrLine { text: string; confidence: number; digitConfidence?: number }
export interface OcrResult { text: string; lines: OcrLine[] }

/** The reader could not be fetched or started (offline on first use, a missing file, a stuck download). */
export class OcrLoadError extends Error {
  constructor(message = 'ocr-load-failed') {
    super(message)
    this.name = 'OcrLoadError'
  }
}

interface Word { text: string; confidence: number }
interface Block { paragraphs?: Array<{ lines?: Array<{ words?: Word[]; text?: string }> }> }
interface Engine {
  setParameters: (params: Record<string, string>) => Promise<unknown>
  recognize: (image: HTMLCanvasElement, options: Record<string, unknown>, output: Record<string, boolean>) => Promise<{ data: { text: string; blocks?: Block[] | null } }>
  terminate: () => Promise<unknown>
}

/** Milliseconds allowed for the reader to download and start, and for each reading pass. */
export const OCR_TIMEOUT_MS = 45_000

let engine: Promise<Engine> | undefined
let listener: ((progress: OcrProgress) => void) | undefined

const asset = (path: string): string => new URL(`${import.meta.env.BASE_URL}ocr/${path}`, document.baseURI).href

const timeout = <T>(work: Promise<T>, ms: number, make: () => Error): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(make()), ms)
    work.then((value) => { clearTimeout(timer); resolve(value) }, (error) => { clearTimeout(timer); reject(error) })
  })

const start = async (): Promise<Engine> => {
  let fail: (error: Error) => void = () => undefined
  // A failed model or core download is reported to errorHandler only; without this the load would just never finish.
  const failed = new Promise<never>((_, reject) => { fail = reject })
  failed.catch(() => undefined)
  const loading = (async () => {
    const { createWorker, OEM, PSM } = (await import('tesseract.js/dist/tesseract.esm.min.js')).default
    const worker = await createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: asset('worker.min.js'),
      corePath: asset('core'),
      langPath: asset('lang'),
      // A page worker (not a blob) so the service worker controls it and can serve it offline.
      workerBlobURL: false,
      // The service worker caches the files; a second copy in IndexedDB would only take space.
      cacheMethod: 'none',
      logger: (message: { status: string; progress: number }) => listener?.({ status: message.status, progress: message.progress }),
      errorHandler: (error: unknown) => fail(new OcrLoadError(String(error))),
    })
    // The label is one block of text.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK })
    return worker as unknown as Engine
  })()
  try {
    return await timeout(Promise.race([loading, failed]), OCR_TIMEOUT_MS, () => new OcrLoadError('ocr-load-timeout'))
  } catch (error) {
    // Do not wait for a stuck worker; stop it if it ever does come up.
    loading.then((worker) => worker.terminate()).catch(() => undefined)
    throw error instanceof OcrLoadError ? error : new OcrLoadError(String(error))
  }
}

const linesFrom = (text: string, blocks: Block[] | null | undefined): OcrLine[] => {
  const found: OcrLine[] = []
  for (const block of blocks ?? []) for (const paragraph of block.paragraphs ?? []) for (const line of paragraph.lines ?? []) {
    const words = line.words ?? []
    const lineText = (line.text ?? words.map((word) => word.text).join(' ')).replace(/\s+$/, '')
    if (lineText.trim() === '') continue
    const mean = words.length > 0 ? words.reduce((sum, word) => sum + word.confidence, 0) / words.length : 0
    const digits = words.filter((word) => /\d/.test(word.text)).map((word) => word.confidence)
    found.push({ text: lineText, confidence: mean, ...(digits.length > 0 ? { digitConfidence: Math.min(...digits) } : {}) })
  }
  // Without word data the plain text still parses, just with no confidence.
  return found.length > 0 ? found : text.split(/\r?\n/).filter((line) => line.trim() !== '').map((line) => ({ text: line, confidence: 100 }))
}

/** Read the text in a prepared canvas. The first call loads the engine (a few MB, cached by the service worker). */
export const recognizeText = async (canvas: HTMLCanvasElement, onProgress?: (progress: OcrProgress) => void): Promise<OcrResult> => {
  listener = onProgress
  if (!engine) engine = start()
  const starting = engine
  try {
    const worker = await starting
    const { data } = await timeout(worker.recognize(canvas, {}, { text: true, blocks: true }), OCR_TIMEOUT_MS, () => new OcrLoadError('ocr-read-timeout'))
    return { text: data.text, lines: linesFrom(data.text, data.blocks) }
  } catch (error) {
    // Allow a retry after a failed or stuck run.
    if (engine === starting) {
      engine = undefined
      starting.then((worker) => worker.terminate()).catch(() => undefined)
    }
    throw error
  } finally {
    listener = undefined
  }
}

/** Free the worker (about 100 MB of memory) when the scanner closes. Never throws and never waits on a stuck worker. */
export const releaseOcr = (): void => {
  const running = engine
  engine = undefined
  running?.then((worker) => worker.terminate()).catch(() => undefined)
}
