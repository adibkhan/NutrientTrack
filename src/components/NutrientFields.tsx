import type { LimitProblem } from '../lib/limits'
import { NUTRIENTS, type NutrientDraft, type NutrientKey } from '../lib/nutrients'

interface NutrientFieldsProps {
  idPrefix: string
  values: NutrientDraft
  onChange: (key: NutrientKey, value: string) => void
  /** A cap message for one of the boxes, shown under it. */
  error?: LimitProblem
}

/** The optional extra nutrients, tucked behind a disclosure so the quick path stays short. Opens by itself when any is filled in. */
export function NutrientFields({ idPrefix, values, onChange, error }: NutrientFieldsProps) {
  const anyFilled = NUTRIENTS.some((nutrient) => values[nutrient.key].trim() !== '')
  return (
    <details className="nutrient-fields" open={anyFilled || error !== undefined || undefined}>
      <summary>More nutrients <span>optional</span></summary>
      <div className="nutrient-grid">
        {NUTRIENTS.map((nutrient) => (
          <div className="form-field" key={nutrient.key}>
            <label htmlFor={`${idPrefix}-${nutrient.key}`}>{nutrient.label} <span>{nutrient.unit}</span></label>
            <input id={`${idPrefix}-${nutrient.key}`} inputMode="decimal" min="0" placeholder="Not recorded" step="any" type="number" value={values[nutrient.key]} aria-invalid={error?.field === `${idPrefix}-${nutrient.key}` ? true : undefined} aria-describedby={error?.field === `${idPrefix}-${nutrient.key}` ? `${idPrefix}-${nutrient.key}-error` : undefined} onChange={(event) => onChange(nutrient.key, event.target.value)} />
            {error?.field === `${idPrefix}-${nutrient.key}` && <p className="field-error" id={`${idPrefix}-${nutrient.key}-error`} role="alert">{error.message}</p>}
          </div>
        ))}
      </div>
    </details>
  )
}
