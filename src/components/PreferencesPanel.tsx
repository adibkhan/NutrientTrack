import type { Preferences } from '../types'
import { readPreferences } from '../lib/preferences'
import { isMascotOn } from '../lib/mascot'

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
        <label className="check-row" htmlFor="pref-mascot">
          <input checked={isMascotOn(preferences)} id="pref-mascot" type="checkbox" onChange={(event) => {
            const next: Preferences = { ...preferences }
            if (event.target.checked) delete next.mascot
            else next.mascot = false
            onChange(next)
          }} />
          <span><strong>Show Pip on the diary</strong><small>A small buddy that cheers on your logging habit. Its messages are written on this device.</small></span>
        </label>
        <label className="check-row" htmlFor="pref-reflux">
          <input checked={preferences?.refluxWatch === true} id="pref-reflux" type="checkbox" onChange={(event) => {
            const next: Preferences = { ...preferences }
            if (event.target.checked) next.refluxWatch = true
            else delete next.refluxWatch
            onChange(next)
          }} />
          <span><strong>Reflux watch</strong><small>Pip points out foods that are common heartburn triggers, like coffee, tomato or late heavy meals. Triggers differ between people; this is not medical advice.</small></span>
        </label>
      </div>
      <p className="form-note">These choices are saved with your goals. Share of energy shows each macro as a percent of the calories you have eaten.</p>
    </section>
  )
}
