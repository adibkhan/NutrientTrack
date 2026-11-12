#!/usr/bin/env node
/**
 * Tiny static file server WITH HTTP Range support, for checking the branded packs locally. `python -m http.server` ignores Range
 * (it answers 200 with the whole file), which makes every shard read download a 25 MB pack; vite preview and nginx do honour it.
 *
 *   node scripts/serve-static-range.mjs [dir=dist] [port=8080] [--no-range]
 * --no-range answers every request with the whole file, to exercise the client's "server ignored Range" path.
 */
import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.bin': 'application/octet-stream', '.svg': 'image/svg+xml', '.png': 'image/png' }

export const parseRange = (header, size) => {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? '')
  if (!match || (match[1] === '' && match[2] === '')) return undefined
  let start = match[1] === '' ? size - Number(match[2]) : Number(match[1])
  let end = match[1] === '' || match[2] === '' ? size - 1 : Number(match[2])
  end = Math.min(end, size - 1)
  start = Math.max(0, start)
  return start <= end && start < size ? { start, end } : null
}

export const startServer = (root, port = 0, { ranges = true } = {}) => new Promise((resolvePromise) => {
  const server = createServer((request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url, 'http://x').pathname))
    const file = join(root, path.endsWith('/') ? `${path}index.html` : path)
    let stat
    try { stat = statSync(file) } catch { response.writeHead(404).end(); return }
    if (!stat.isFile() || !file.startsWith(root)) { response.writeHead(404).end(); return }
    const headers = { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', ...(ranges ? { 'Accept-Ranges': 'bytes' } : {}) }
    const range = ranges ? parseRange(request.headers.range, stat.size) : undefined
    if (range === null) { response.writeHead(416, { ...headers, 'Content-Range': `bytes */${stat.size}` }).end(); return }
    if (range) {
      response.writeHead(206, { ...headers, 'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`, 'Content-Length': range.end - range.start + 1 })
      createReadStream(file, range).pipe(response)
      return
    }
    response.writeHead(200, { ...headers, 'Content-Length': stat.size })
    createReadStream(file).pipe(response)
  })
  server.listen(port, '127.0.0.1', () => resolvePromise(server))
})

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
  const root = resolve(args[0] ?? 'dist')
  const server = await startServer(root, Number(args[1] ?? 8080), { ranges: !process.argv.includes('--no-range') })
  console.log(`serving ${root} on http://127.0.0.1:${server.address().port}`)
}
