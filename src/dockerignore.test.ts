import { describe, expect, it } from 'vitest'
import dockerignore from '../.dockerignore?raw'
import packageSource from '../package.json?raw'

// Docker builds only see files that .dockerignore lets through. A build script that is excluded fails the image build,
// which is how the label scanner's copy-ocr-assets step once broke deploys.
function ignored(path: string, patterns: string[]): boolean {
  let out = false
  for (const raw of patterns) {
    const negate = raw.startsWith('!')
    const pat = negate ? raw.slice(1) : raw
    const re = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '(/.*)?$')
    if (re.test(path)) out = !negate
  }
  return out
}

describe('.dockerignore', () => {
  const patterns = dockerignore.split('\n').map((l: string) => l.trim()).filter((l: string) => l && !l.startsWith('#'))
  const pkg = JSON.parse(packageSource) as { scripts: Record<string, string> }

  it('lets through every script file that the build and prebuild scripts run', () => {
    const files = new Set<string>()
    for (const name of ['prebuild', 'build']) {
      for (const m of (pkg.scripts[name] ?? '').matchAll(/(?:node|tsx)\s+([\w./-]+\.(?:mjs|js|ts|cjs))/g)) files.add(m[1])
    }
    expect([...files]).toContain('scripts/copy-ocr-assets.mjs')
    for (const f of files) expect(ignored(f, patterns), `${f} is excluded by .dockerignore`).toBe(false)
  })

  it('lets through every file those scripts import, and the data the app and offline cache need', () => {
    const sources = import.meta.glob('../scripts/**/*.mjs', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const byPath = Object.fromEntries(Object.entries(sources).map(([key, text]) => [key.replace('../', ''), text]))
    const roots = ['scripts/build-food-pages.mjs', 'scripts/copy-ocr-assets.mjs']
    const seen = new Set<string>()
    const walk = (file: string) => {
      if (seen.has(file)) return
      seen.add(file)
      const text = byPath[file] ?? ''
      for (const m of text.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
        const target = new URL(m[1], `file:///${file}`).pathname.slice(1)
        walk(target)
      }
    }
    roots.forEach(walk)
    for (const f of seen) expect(ignored(f, patterns), `${f} is imported by the build and excluded by .dockerignore`).toBe(false)
    for (const data of ['public/data/usda-common-v2.json', 'public/data/usda-nutrients-v1.json', 'public/sw.js']) expect(ignored(data, patterns), `${data} is excluded`).toBe(false)
  })

  it('still excludes other scripts', () => {
    expect(ignored('scripts/ocr/e2e.mjs', patterns)).toBe(true)
  })
})
