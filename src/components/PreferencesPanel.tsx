import type { Preferences } from '../types'
import { readPreferences } from '../lib/preferences'

interface PreferencesPanelProps {
  preferences: Preferences | undefined
  onChange: (next: Preferences) => void
}

export function PreferencesPanel({ preferences, onChange }: PreferencesPanelProps) {
  const current = readPreferences(preferences)
  return (
    <section className="panel" aria-labelledby="preferences-heading">
      <div className="panel-header"><div><h2 id="preferences-heading">Preferences</h2></div></div>
      <div className="goals-form">
        <div className="form-field full">
          <label htmlFor="pref-theme">Theme</label>
          <select id="pref-theme" value={current.theme} onChange={(event) => onChange({ ...preferences, theme: event.target.value as Preferences['theme'] })}>
            <option value="system">Match my device</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
        <div className="form-field full">
          <label htmlFor="pref-macros">Macro display</label>
          <select id="pref-macros" value={current.macroDisplay} onChange={(event) => onChange({ ...preferences, macroDisplay: event.target.value as Preferences['macroDisplay'] })}>
            <option value="grams">Grams</option>
            <option value="percent">Share of energy</option>
          </select>
        </div>
        <label className="check-row" htmlFor="pref-barcode">
          <input checked={preferences?.barcodeLookup === true} id="pref-barcode" type="checkbox" onChange={(event) => {
            const next: Preferences = { ...preferences }
            if (event.target.checked) next.barcodeLookup = true
            else delete next.barcodeLookup
            onChange(next)
          }} />
          <span><strong>Look up barcodes online</strong><small>Sends each barcode number you scan to Open Food Facts. Off by default.</small></span>
        </label>
      </div>
      <p className="form-note">These choices are saved with your goals. Share of energy shows each macro as a percent of the calories you have eaten.</p>
    </section>
  )
}
