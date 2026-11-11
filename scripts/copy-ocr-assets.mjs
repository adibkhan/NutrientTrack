// Copies the OCR engine files the label scanner needs from node_modules into public/ocr/, so they are served from the
// app's own origin (no CDN). Run by `npm run build` and `npm run dev`; public/ocr is git-ignored.
//   worker.min.js            tesseract.js worker script
//   core/*-lstm.wasm.js      the wasm core, three CPU variants (the worker picks one); LSTM only, the model needs no legacy engine
//   lang/eng.traineddata.gz  English model, the integer-quantised "best" LSTM data that tesseract.js uses by default (about 3 MB)
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public', 'ocr')
const modules = join(root, 'node_modules')

rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'core'), { recursive: true })
mkdirSync(join(out, 'lang'), { recursive: true })
copyFileSync(join(modules, 'tesseract.js', 'dist', 'worker.min.js'), join(out, 'worker.min.js'))
for (const name of ['tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js']) {
  copyFileSync(join(modules, 'tesseract.js-core', name), join(out, 'core', name))
}
copyFileSync(join(modules, '@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz'), join(out, 'lang', 'eng.traineddata.gz'))
console.log('OCR assets copied to public/ocr')
