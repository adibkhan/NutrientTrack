/** Photo preparation for the label reader: downscale, grayscale, stretch the contrast. Runs on the device, on a canvas. */

export const MAX_EDGE = 1600
const MIN_EDGE = 1100

/** Grayscale in place, then stretch so the 2nd to 98th brightness percentiles span 0 to 255. Skipped when the photo is already flat. */
export const stretchContrast = (data: Uint8ClampedArray): void => {
  const histogram = new Uint32Array(256)
  const pixels = data.length / 4
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
    data[i] = data[i + 1] = data[i + 2] = gray
    histogram[gray] += 1
  }
  const cut = pixels * 0.02
  let low = 0
  let seen = 0
  while (low < 255 && seen + histogram[low] < cut) { seen += histogram[low]; low += 1 }
  let high = 255
  seen = 0
  while (high > 0 && seen + histogram[high] < cut) { seen += histogram[high]; high -= 1 }
  if (high - low < 24) return
  const scale = 255 / (high - low)
  for (let i = 0; i < data.length; i += 4) {
    const stretched = Math.max(0, Math.min(255, Math.round((data[i] - low) * scale)))
    data[i] = data[i + 1] = data[i + 2] = stretched
  }
}

/** Size after fitting the long edge into [MIN_EDGE, MAX_EDGE]: big phone photos shrink, tiny ones grow. */
export const fitSize = (width: number, height: number): { width: number; height: number } => {
  const long = Math.max(width, height)
  const factor = long > MAX_EDGE ? MAX_EDGE / long : long < MIN_EDGE ? MIN_EDGE / long : 1
  return { width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)) }
}

/** The file is not an image this browser can open (HEIC in Chrome, a PDF, any other file). */
export class UnreadableImageError extends Error {
  constructor() {
    super('unreadable-image')
    this.name = 'UnreadableImageError'
  }
}

const decode = async (file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> => {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
    } catch {
      // Fall back to an image element below.
    }
  }
  const url = URL.createObjectURL(file)
  const image = new Image()
  image.src = url
  try {
    await image.decode()
  } catch (error) {
    URL.revokeObjectURL(url)
    throw new UnreadableImageError()
  }
  return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) }
}

/** Decode a photo into a prepared grayscale canvas. The photo itself is never stored. */
export const prepareCanvas = async (file: Blob): Promise<HTMLCanvasElement> => {
  const image = await decode(file)
  try {
    const { width, height } = fitSize(image.width, image.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('canvas-unavailable')
    context.drawImage(image.source, 0, 0, width, height)
    const pixels = context.getImageData(0, 0, width, height)
    stretchContrast(pixels.data)
    context.putImageData(pixels, 0, 0)
    return canvas
  } finally {
    image.close()
  }
}

/** A copy turned a quarter turn clockwise (90) or anticlockwise (270). */
export const rotateCanvas = (canvas: HTMLCanvasElement, degrees: 90 | 270): HTMLCanvasElement => {
  const turned = document.createElement('canvas')
  turned.width = canvas.height
  turned.height = canvas.width
  const context = turned.getContext('2d')
  if (!context) throw new Error('canvas-unavailable')
  context.translate(turned.width / 2, turned.height / 2)
  context.rotate((degrees * Math.PI) / 180)
  context.drawImage(canvas, -canvas.width / 2, -canvas.height / 2)
  return turned
}
