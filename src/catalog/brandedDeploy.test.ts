// @vitest-environment node
// The branded packs must reach the image and be served as ranges of already-compressed files.
import { describe, expect, it } from 'vitest'
// @ts-expect-error The app tsconfig has no Node typings; these checks read files from disk.
import { readdirSync } from 'node:fs'
import dockerignore from '../../.dockerignore?raw'
import nginx from '../../deploy/nginx.conf.template?raw'
import packageJson from '../../package.json?raw'
import dockerfile from '../../Dockerfile?raw'

/** Whether a path is excluded by a .dockerignore (patterns anchored at the context root; later lines win; ! re-includes). */
const excluded = (path: string): boolean => {
  let result = false
  for (const raw of dockerignore.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const negate = line.startsWith('!')
    const pattern = (negate ? line.slice(1) : line).replace(/^\/+/, '').replace(/\/+$/, '')
    const source = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*')
    // A pattern matches the path itself or any parent directory of it.
    if (new RegExp(`^${source}(/.*)?$`).test(path)) result = !negate
  }
  return result
}

describe('branded packs and the Docker image', () => {
  const dir = new URL('../../public/data/branded-v1/', import.meta.url)
  const files = (readdirSync(dir) as string[]).map((name) => `public/data/branded-v1/${name}`)

  it('the matcher understands the real rules', () => {
    expect(excluded('scripts/build-usda-branded.mjs')).toBe(true)
    expect(excluded('scripts/build-food-pages.mjs')).toBe(false)
    expect(excluded('README.md')).toBe(true)
    expect(excluded('node_modules/x/y.js')).toBe(true)
    expect(excluded('public/data/usda-common-v2.json')).toBe(false)
  })

  it('no pack or manifest is excluded from the image', () => {
    expect(files.length).toBeGreaterThanOrEqual(3)
    for (const file of files) expect(excluded(file), file).toBe(false)
  })

  it('the Docker build only serves the packs: the build script is not needed there', () => {
    expect(excluded('scripts/build-usda-branded.mjs')).toBe(true)
    const build = (JSON.parse(packageJson) as { scripts: Record<string, string> }).scripts.build
    expect(build).not.toContain('build-usda-branded')
    expect(dockerfile).toContain('RUN npm run build')
  })

  it('review: the packs get a content-derived mtime in the image so the nginx ETag (mtime + size) is the same on every instance and build', () => {
    const at = dockerfile.indexOf('RUN npm run build')
    const step = dockerfile.slice(at)
    expect(step).toContain('utimesSync')
    expect(step).toContain('dist/data/branded-v1/')
    expect(step).toContain('sha256')
    expect(step.indexOf('utimesSync')).toBeGreaterThan(0)
    // The mtime derives from the bytes only: no Date.now / new Date() without arguments.
    expect(step).not.toMatch(/Date\.now|new Date\(\)/)
  })
})

describe('nginx serves the packs as ranges of compressed files', () => {
  const block = (pattern: string): string => {
    const start = nginx.indexOf(pattern)
    expect(start, pattern).toBeGreaterThan(-1)
    return nginx.slice(start, nginx.indexOf('\n    }', start))
  }

  it('does not gzip packs on the fly and caches them forever', () => {
    const packs = block('location ~ ^/data/branded-v1/')
    expect(packs).toContain('.bin$')
    expect(packs).toMatch(/gzip off;/)
    expect(packs).toMatch(/gzip_static off;/)
    expect(packs).toContain('max-age=31536000, immutable')
    expect(packs).not.toMatch(/\bgzip on\b/)
  })

  it('review H2: only successful pack answers are immutable; a missing pack is never cached', () => {
    const packs = block('location ~ ^/data/branded-v1/')
    const cacheLine = packs.split('\n').find((line) => line.includes('add_header') && line.includes('immutable')) ?? ''
    expect(cacheLine).not.toContain('always')
    expect(packs).toContain('error_page 404 = @branded_missing;')
    const manifest = block('location /data/branded-v1/ {')
    expect(manifest.split('\n').find((line) => line.includes('add_header') && line.includes('max-age=86400'))).not.toContain('always')
    expect(manifest).toContain('error_page 404 = @branded_missing;')
    const missing = block('location @branded_missing')
    expect(missing).toContain('Cache-Control "no-store" always')
    expect(missing).toContain('return 404')
  })

  it('review: ETags are on and compared exactly, so a Range request validates the same copy on every instance', () => {
    const packs = block('location ~ ^/data/branded-v1/')
    expect(packs).toMatch(/etag on;/)
    expect(packs).toMatch(/if_modified_since exact;/)
    const manifest = block('location /data/branded-v1/ {')
    expect(manifest).toMatch(/etag on;/)
  })

  it('leaves the manifest to the normal rules: gzipped JSON, a day of cache', () => {
    expect(nginx).toMatch(/gzip_types[^;]*application\/json/)
    const manifest = block('location /data/branded-v1/ {')
    expect(manifest).toContain('max-age=86400')
    expect(manifest).not.toMatch(/gzip off/)
  })

  it('the pack rule comes before the general /data/ rule and the .bin types are not in gzip_types', () => {
    expect(nginx.indexOf('branded-v1')).toBeLessThan(nginx.indexOf('location /data/ {'))
    expect(nginx).not.toMatch(/gzip_types[^;]*octet-stream/)
  })
})
