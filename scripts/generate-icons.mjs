import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const outputDirectory = join(root, 'public', 'icons')

const crc32 = (bytes) => {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let index = 0; index < 8; index += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

const chunk = (type, data) => {
  const name = Buffer.from(type)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])))
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  return Buffer.concat([length, name, data, checksum])
}

const createIcon = (size) => {
  const pixels = Buffer.alloc(size * size * 4, 0)
  const set = (x, y, color) => {
    if (x < 0 || x >= size || y < 0 || y >= size) return
    const offset = (y * size + x) * 4
    pixels[offset] = color[0]
    pixels[offset + 1] = color[1]
    pixels[offset + 2] = color[2]
    pixels[offset + 3] = color[3]
  }
  const dark = [37, 43, 49, 255]
  const warm = [238, 138, 120, 255]
  const cream = [248, 247, 244, 255]
  const teal = [47, 158, 152, 255]
  const blue = [92, 122, 232, 255]
  const radius = size * 0.23
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const edgeX = Math.min(x, size - 1 - x)
      const edgeY = Math.min(y, size - 1 - y)
      const edge = Math.min(edgeX, edgeY)
      const cornerDistance = Math.hypot(radius - edgeX, radius - edgeY)
      if (edge >= radius || cornerDistance <= radius) set(x, y, dark)
    }
  }

  const center = size / 2
  const ringOuter = size * 0.297
  const ringInner = size * 0.203
  const diamondRadius = size * 0.183
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x + 0.5 - center, y + 0.5 - center)
      if (distance >= ringInner && distance <= ringOuter) set(x, y, warm)
      const diamond = Math.abs(x + 0.5 - center) + Math.abs(y + 0.5 - center)
      if (diamond <= diamondRadius) set(x, y, cream)
    }
  }

  const circle = (cx, cy, radiusValue, color) => {
    for (let y = Math.floor(cy - radiusValue); y <= Math.ceil(cy + radiusValue); y += 1) {
      for (let x = Math.floor(cx - radiusValue); x <= Math.ceil(cx + radiusValue); x += 1) {
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= radiusValue) set(x, y, color)
      }
    }
  }
  circle(size * 0.483, size * 0.461, size * 0.042, teal)
  circle(size * 0.567, size * 0.544, size * 0.042, blue)

  const rows = []
  for (let y = 0; y < size; y += 1) rows.push(Buffer.concat([Buffer.from([0]), pixels.subarray(y * size * 4, (y + 1) * size * 4)]))
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))])
}

mkdirSync(outputDirectory, { recursive: true })
for (const size of [192, 512]) writeFileSync(join(outputDirectory, `nutrienttrack-${size}.png`), createIcon(size))

