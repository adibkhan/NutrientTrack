import { describe, expect, it } from 'vitest'

// A failed React.lazy import throws into the whole app (a blank page offline); on-demand screens use their own loader with a caught failure path.
const raw = import.meta.glob(['./**/*.ts', './**/*.tsx', '!./**/*.test.ts', '!./**/*.test.tsx', '!./**/testkit/**'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
/** Source without whole-line comments, so a comment that mentions React.lazy does not count. */
const sources = Object.fromEntries(Object.entries(raw).map(([file, text]) => [file, text.split('\n').filter((line) => !/^\s*(\/\/|\/?\*)/.test(line)).join('\n')]))

describe('offline safety', () => {
  it('uses React.lazy nowhere', () => {
    const offenders = Object.entries(sources).filter(([, text]) => /\blazy\(|React\.lazy|\bSuspense\b/.test(text)).map(([file]) => file)
    expect(offenders).toEqual([])
  })

  // Imports whose own statement has no catch: the failure is caught by the caller, which is checked below.
  const CAUGHT_BY_CALLER: Record<string, { caller: string; call: RegExp }> = {
    './lib/scanner.ts': { caller: './components/BarcodeLookup.tsx', call: /try\s*\{\s*const session = await startScanning/ },
    './lib/xlsx.ts': { caller: './components/ImportPanel.tsx', call: /try\s*\{\s*const workbook = await reader\.readXlsx/ },
  }

  it('catches every dynamic import', () => {
    const uncaught: string[] = []
    for (const [file, text] of Object.entries(sources)) {
      if (file === './lib/cloud.ts') { expect(text).toMatch(/import\('@supabase\/supabase-js'\)[\s\S]*?\.catch\(/); continue }
      const guard = CAUGHT_BY_CALLER[file]
      if (guard) { expect(sources[guard.caller]).toMatch(guard.call); continue }
      const lines = text.split('\n')
      lines.forEach((line, index) => {
        if (!/[^.\w]import\(/.test(line) || /typeof import\(|import type/.test(line)) return
        // A catch on the same statement or a try block within the five lines above.
        const nearby = lines.slice(Math.max(0, index - 5), index + 3).join('\n')
        if (!/\.catch\(|catch\s*[({]|\btry\s*\{/.test(nearby)) uncaught.push(`${file}:${index + 1}`)
      })
    }
    expect(uncaught).toEqual([])
  })
})
