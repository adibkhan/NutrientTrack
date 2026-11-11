// Usage: node scripts/ocr/render-labels.mjs <outDir>
// Renders the synthetic labels to PNG with Playwright (resolved from PLAYWRIGHT_PATH or the shots install) and Chrome from CHROME_PATH.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { LABELS, pageFor } from './labels.mjs'

export const renderLabels = async (outDir) => {
  const { chromium } = await import(process.env.PLAYWRIGHT_PATH ?? '/home/claude/shots/node_modules/playwright/index.mjs')
  mkdirSync(outDir, { recursive: true })
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' })
  const page = await browser.newPage({ viewport: { width: 640, height: 900 }, deviceScaleFactor: 2 })
  const files = []
  for (const label of LABELS) {
    await page.setContent(pageFor(label))
    const file = join(outDir, `${label.name}.png`)
    await page.locator('.stage').screenshot({ path: file })
    files.push({ ...label, file })
  }
  await browser.close()
  return files
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2]
  if (!out) throw new Error('Usage: node scripts/ocr/render-labels.mjs <outDir>')
  for (const f of await renderLabels(out)) console.log(f.file)
}
