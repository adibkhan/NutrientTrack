interface ServingsStepperProps {
  value: string
  hint?: string
  onChange: (value: string) => void
}

/** Half-serving steps around a free-typed amount, for foods that already carry their nutrition per serving. */
export function ServingsStepper({ value, hint, onChange }: ServingsStepperProps) {
  const amount = Number(value)
  const valid = value.trim() !== '' && Number.isFinite(amount) && amount > 0
  return (
    <div className="form-field full">
      <div className="grams-field">
        <label htmlFor="entry-servings">Servings</label>
        <div className="grams-stepper">
          <button className="icon-button" type="button" aria-label="Half a serving less" disabled={!valid || amount <= 0.5} onClick={() => onChange(String(Math.max(0.5, amount - 0.5)))}>−</button>
          <div className="input-with-suffix">
            <input id="entry-servings" inputMode="decimal" min="0" step="any" type="number" value={value} onChange={(event) => onChange(event.target.value)} />
          </div>
          <button className="icon-button" type="button" aria-label="Half a serving more" onClick={() => onChange(String((valid ? amount : 0) + 0.5))}>+</button>
        </div>
      </div>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  )
}
