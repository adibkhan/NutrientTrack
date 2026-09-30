// Enforces the data invariants in CLAUDE.md that are about files rather than behaviour.
import { describe, expect, it } from 'vitest'
import catalogSource from '../catalog/index.ts?raw'
import swSource from '../../public/sw.js?raw'
import catalogV1 from '../../public/data/usda-common-v1.json?raw'
import backupV1 from './__fixtures__/backup-v1.json?raw'

/** FNV-1a over the text with line endings normalised, so a Windows checkout hashes the same as CI. */
const fingerprint = (text: string): string => {
  let hash = 0x811c9dc5
  for (const char of text.replace(/\r\n/g, '\n')) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

describe('frozen backup fixtures (invariant 5)', () => {
  // A fixture records a format real users hold. Never edit one: add backup-vN.json and pin it here.
  it.each([['backup-v1.json', backupV1, '441ee9e1']])('%s is unchanged', (_name, text, pinned) => {
    expect(fingerprint(text)).toBe(pinned)
  })
})

describe('catalog is versioned by file name (invariant 7)', () => {
  const catalogPath = /CATALOG_PATH\s*=\s*'([^']+)'/.exec(catalogSource)?.[1]

  it('the app and the service worker precache the same catalog file', () => {
    expect(catalogPath).toBeDefined()
    expect(swSource).toContain(`'${catalogPath}'`)
  })

  // Browsers and the service worker cache the catalog by URL, so new content needs a new file name.
  it.each([['usda-common-v1.json', catalogV1, '0202e227']])('%s content matches its name', (name, text, pinned) => {
    expect(catalogPath?.endsWith(name) ? fingerprint(text) : pinned).toBe(pinned)
  })
})
