import { inputText, parseDecimal } from '../lib/decimal'

interface ServingsStepperProps {
  value: string
  hint?: string
  error?: string
  onChange: (value: string) => void
}

/** Half-serving steps around a free-typed amount, for foods that already carry their nutrition per serving. */
export function ServingsStepper({ value, hint, error, onChange }: ServingsStepperProps) {
  const amount = parseDecimal(value)
  const valid = value.trim() !== '' && Number.isFinite(amount) && amount > 0
  return (
    <div className="form-field full">
      <div className="grams-field">
        <label htmlFor="entry-servings">Servings</label>
        <div className="grams-stepper">
          <button className="icon-button" type="button" aria-label="Half a serving less" disabled={!valid || amount <= 0.5} onClick={() => onChange(inputText(Math.max(0.5, Math.round((amount - 0.5) * 100) / 100)))}>−</button>
          <div className="input-with-suffix">
            <input id="entry-servings" aria-invalid={error ? true : undefined} aria-describedby={error ? 'entry-servings-error' : undefined} inputMode="decimal" type="text" value={value} onChange={(event) => onChange(event.target.value)} />
          </div>
          <button className="icon-button" type="button" aria-label="Half a serving more" onClick={() => onChange(inputText(Math.round(((valid ? amount : 0) + 0.5) * 100) / 100))}>+</button>
        </div>
      </div>
      {error && <p className="field-error" id="entry-servings-error" role="alert">{error}</p>}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  )
}
