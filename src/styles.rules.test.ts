// @vitest-environment node
// jsdom does not apply the stylesheet, so these read it as text: layout rules that keep toasts and rows usable on a phone.
import { describe, expect, it } from 'vitest'
// @ts-expect-error The app tsconfig has no Node typings; this file runs in Node.
import { readFileSync } from 'node:fs'
// Not `?raw`: Vitest's CSS handling turns a .css import into an empty string even with ?raw, so read the file in a Node environment.
const css: string = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

const flat = css.replace(/\r/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
const phoneStart = flat.indexOf('@media (max-width: 680px) {\n  .update-banner { top: calc')

/** Declarations of the first top-level rule whose selector is exactly `selector`. */
function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(flat)
  if (!match) throw new Error(`no top-level rule for ${selector}`)
  return match[1]
}
const zIndex = (selector: string) => Number(/z-index:\s*(\d+)/.exec(declarations(selector))?.[1])

describe('stylesheet layout rules', () => {
  it('puts_toasts_at_z_index_30_above_the_update_banner', () => {
    expect(declarations('.toast-region')).toMatch(/z-index:\s*30\b/)
    expect(zIndex('.update-banner')).toBeLessThan(zIndex('.toast-region'))
  })

  it('lets_the_logger_search_column_shrink', () => {
    expect(declarations('.logger-search')).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/)
  })

  it('wraps_panel_headers', () => {
    expect(declarations('.panel-header')).toMatch(/flex-wrap:\s*wrap/)
  })

  it('stacks_the_converted_weight_on_its_own_line_in_the_phone_block', () => {
    expect(phoneStart).toBeGreaterThan(-1)
    const phone = flat.slice(phoneStart, flat.indexOf('\n}', phoneStart))
    expect(phone).toMatch(/\.weight-row \.converted\s*\{[^}]*display:\s*block/)
  })
})
