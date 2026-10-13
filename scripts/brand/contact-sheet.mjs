// Renders Pip's contact sheet (every mood, reaction and stage at three sizes, light and dark) to PNGs.
//   SHEET_OUT=/tmp/sheet npx vite build --config scripts/brand/vite.sheet.config.ts
//   node scripts/brand/contact-sheet.mjs /tmp/sheet out-dir
// Playwright is not a project dependency; run with a global install or `npx --yes playwright@1.56.0`.
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

const [dist, out = '.'] = process.argv.slice(2)
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json' }
const server = createServer(async (request, response) => {
  const path = request.url.split('?')[0] === '/' ? '/index.html' : request.url.split('?')[0]
  try {
    const body = await readFile(join(dist, path))
    response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(body)
  } catch {
    response.writeHead(404).end()
  }
}).listen(0)
const port = server.address().port
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? undefined })
for (const theme of ['light', 'dark']) {
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2, colorScheme: theme })).newPage()
  await page.goto(`http://localhost:${port}/?theme=${theme}`)
  await page.waitForSelector('.pip')
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(out, `pip-sheet-${theme}.png`), fullPage: true })
}
await browser.close()
server.close()
