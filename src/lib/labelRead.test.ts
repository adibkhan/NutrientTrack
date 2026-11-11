import { beforeEach, describe, expect, it, vi } from 'vitest'

const recognizeText = vi.fn()
vi.mock('./labelOcr', () => ({ recognizeText: (...args: unknown[]) => recognizeText(...args) }))
const canvas = (name: string) => ({ name }) as unknown as HTMLCanvasElement
vi.mock('./labelImage', () => ({ prepareCanvas: vi.fn(() => Promise.resolve({ name: 'base' })), rotateCanvas: vi.fn((_c: unknown, degrees: number) => canvas(`rot${degrees}`)) }))

import { readLabelPhoto } from './labelRead'

const ocr = (text: string) => ({ text, lines: text.split('\n').map((line) => ({ text: line, confidence: 95 })) })
beforeEach(() => recognizeText.mockReset())

describe('readLabelPhoto', () => {
  it('stops after the first pass when Calories is found', async () => {
    recognizeText.mockResolvedValue(ocr('Calories 100\nProtein 3g'))
    const reading = await readLabelPhoto(new Blob(['x']))
    expect(recognizeText).toHaveBeenCalledTimes(1)
    expect(reading.rotation).toBe(0)
    expect(reading.parsed.values.calories?.value).toBe(100)
  })

  it('tries 90 then 270 only when no Calories turns up', async () => {
    recognizeText.mockResolvedValueOnce(ocr('garbage')).mockResolvedValueOnce(ocr('more garbage')).mockResolvedValueOnce(ocr('Calories 210'))
    const reading = await readLabelPhoto(new Blob(['x']))
    expect(recognizeText.mock.calls.map((call) => (call[0] as { name: string }).name)).toEqual(['base', 'rot90', 'rot270'])
    expect(reading.rotation).toBe(270)
    expect(reading.parsed.hasCalories).toBe(true)
  })

  it('keeps the pass that read the most nutrients when none found calories', async () => {
    recognizeText.mockResolvedValueOnce(ocr('nothing')).mockResolvedValueOnce(ocr('Total Fat 8g 10%\nTotal Carbohydrate 37g 13%\nProtein 3g')).mockResolvedValueOnce(ocr('nothing'))
    const reading = await readLabelPhoto(new Blob(['x']))
    expect(reading.rotation).toBe(90)
    expect(reading.parsed.usable).toBe(true)
    expect(reading.parsed.hasCalories).toBe(false)
  })

  it('returns the unrotated reading when nothing has calories', async () => {
    recognizeText.mockResolvedValue(ocr('nothing here'))
    const reading = await readLabelPhoto(new Blob(['x']))
    expect(recognizeText).toHaveBeenCalledTimes(3)
    expect(reading.rotation).toBe(0)
    expect(reading.parsed.hasCalories).toBe(false)
  })
})
