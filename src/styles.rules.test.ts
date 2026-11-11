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

describe('trends cards fit a phone', () => {
  it('lets_the_contributors_card_shrink_and_wrap_long_names', () => {
    expect(declarations('.contributors-panel')).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/)
    expect(declarations('.contributors-panel > *')).toMatch(/min-width:\s*0/)
    expect(declarations('.contributors-panel .form-field select')).toMatch(/width:\s*100%/)
    expect(declarations('.contributor-top span')).toMatch(/overflow-wrap:\s*anywhere/)
    expect(declarations('.contributor-top span')).not.toMatch(/nowrap/)
  })
})

describe('long unbroken text', () => {
  it('wraps_entry_names_pip_bubble_toast_and_contributor_rows_anywhere', () => {
    for (const selector of ['.entry-copy strong', '.mascot-bubble p', '.toast', '.contributor-top span']) {
      expect(flat).toMatch(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{}]*\\{[^}]*overflow-wrap:\\s*anywhere`))
    }
  })

  it('keeps the one-tap Log now button a 44px target with room from the plate plus', () => {
    expect(flat).toMatch(/^\.quick-result \{ gap: 8px;/m)
    expect(flat).toMatch(/^\.quick-result \.quick-add \{ width: 44px; height: 44px;/m)
    expect(declarations('.plate-add')).toMatch(/width:\s*44px;\s*height:\s*44px/)
  })

  it('keeps the plate tray above the keyboard and last in the sheet', () => {
    expect(declarations('.plate-tray')).toMatch(/order:\s*9/)
    expect(declarations('.plate-tray')).toMatch(/var\(--kb-inset/)
    expect(declarations('.logger-search')).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/)
  })
})
