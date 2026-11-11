// End to end on the synthetic labels: render -> (same preprocessing idea) -> real Tesseract -> parseLabel -> per-field accuracy.
// Usage: node --experimental-strip-types scripts/ocr/e2e.mjs [outDir]
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { renderLabels } from './render-labels.mjs'
import { parseLabel } from '../../src/lib/labelParse.ts'
import { LABELS } from './labels.mjs'

const require = createRequire(import.meta.url)
const { createWorker, PSM } = require('tesseract.js')
const outDir = process.argv[2] ?? '/tmp/label-fixtures'
const files = await renderLabels(outDir)
const worker = await createWorker('eng', 1, {
  langPath: new URL('../../node_modules/@tesseract.js-data/eng/4.0.0_best_int', import.meta.url).pathname,
  corePath: new URL('../../node_modules/tesseract.js-core', import.meta.url).pathname,
  cacheMethod: 'none',
})
await worker.setParameters({ tessedit_pageseg_mode: process.env.PSM ?? PSM.SINGLE_BLOCK })
const tally = {}
let total = 0, right = 0
for (const f of files) {
  const t0 = Date.now()
  const { data } = await worker.recognize(readFileSync(f.file))
  const ms = Date.now() - t0
  const parsed = parseLabel(data.text)
  if (process.env.VERBOSE) console.log(data.text)
  console.log(`\n== ${f.name} (${ms} ms) basis=${parsed.basis} serving=${JSON.stringify(parsed.servingText)} per container=${parsed.servingsPerContainer} checkNumbers=${parsed.checkNumbers}`)
  const exp = f.expected
  for (const [key, want] of Object.entries(exp)) {
    let got
    if (key === 'basis') got = parsed.basis
    else if (key === 'servingGrams') got = parsed.servingAmount?.value
    else if (key === 'servingsPerContainer') got = parsed.servingsPerContainer
    else got = parsed.values[key]?.value
    const flag = parsed.values[key]?.confidence
    const ok = got === want
    total += 1; if (ok) right += 1
    tally[key] = tally[key] ?? { ok: 0, n: 0 }
    tally[key].n += 1; if (ok) tally[key].ok += 1
    console.log(`${ok ? 'ok  ' : 'MISS'} ${key}: want ${want} got ${got}${flag === 'check' ? ' [check]' : ''}`)
  }
}
await worker.terminate()
console.log(`\nField accuracy: ${right}/${total} = ${(100 * right / total).toFixed(1)}%`)
console.log(JSON.stringify(tally))
