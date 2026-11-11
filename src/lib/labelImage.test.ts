import { describe, expect, it } from 'vitest'
import { fitSize, stretchContrast } from './labelImage'

const rgba = (...grays: number[]) => new Uint8ClampedArray(grays.flatMap((g) => [g, g, g, 255]))

describe('stretchContrast', () => {
  it('turns colour into gray and stretches a washed-out photo to the full range', () => {
    const pixels = []
    for (let i = 0; i < 100; i += 1) pixels.push(100 + Math.round((i / 99) * 60))
    const data = rgba(...pixels)
    stretchContrast(data)
    const grays = Array.from({ length: 100 }, (_, i) => data[i * 4])
    expect(Math.min(...grays)).toBe(0)
    expect(Math.max(...grays)).toBe(255)
    expect(data[3]).toBe(255)
  })

  it('converts RGB with luma weights', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255])
    stretchContrast(data)
    expect(data[0]).toBe(data[1])
    expect(data[1]).toBe(data[2])
  })

  it('leaves an already flat photo alone rather than amplifying noise', () => {
    const data = rgba(120, 121, 122, 120)
    stretchContrast(data)
    expect([data[0], data[4], data[8], data[12]]).toEqual([120, 121, 122, 120])
  })
})

describe('fitSize', () => {
  it('downscales large photos to 1600 on the long edge', () => {
    expect(fitSize(4000, 3000)).toEqual({ width: 1600, height: 1200 })
    expect(fitSize(3000, 4000)).toEqual({ width: 1200, height: 1600 })
  })
  it('keeps mid sized photos and enlarges tiny ones', () => {
    expect(fitSize(1400, 1000)).toEqual({ width: 1400, height: 1000 })
    expect(fitSize(550, 400)).toEqual({ width: 1100, height: 800 })
  })
})
