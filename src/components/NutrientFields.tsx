import { useEffect, useState } from 'react'
import type { LimitProblem } from '../lib/limits'
import { BASIC_NUTRIENTS, EXTRA_NUTRIENTS, NUTRIENT_GROUPS, NUTRIENTS, type NutrientDraft, type NutrientInfo, type NutrientKey } from '../lib/nutrients'

interface NutrientFieldsProps {
  idPrefix: string
  values: NutrientDraft
  onChange: (key: NutrientKey, value: string) => void
  /** A cap message for one of the boxes, shown under it. */
  error?: LimitProblem
  /** Keys the scanned label flagged for checking: the full list opens so those boxes can be seen and edited. */
  flagged?: readonly string[]
}

/** The optional extra nutrients, tucked behind a disclosure so the quick path stays short. The original five show first; the rest sit behind "Show all nutrients". */
export function NutrientFields({ idPrefix, values, onChange, error, flagged }: NutrientFieldsProps) {
  const filled = (list: readonly NutrientInfo[]) => list.filter((nutrient) => values[nutrient.key].trim() !== '').length
  const errorIn = (list: readonly NutrientInfo[]) => error !== undefined && list.some((nutrient) => error.field === `${idPrefix}-${nutrient.key}`)
  const field = (nutrient: NutrientInfo) => (
    <div className="form-field" key={nutrient.key}>
      <label htmlFor={`${idPrefix}-${nutrient.key}`}>{nutrient.label} <span>{nutrient.unit}</span></label>
      <input id={`${idPrefix}-${nutrient.key}`} inputMode="decimal" placeholder="Not recorded" type="text" value={values[nutrient.key]} aria-invalid={error?.field === `${idPrefix}-${nutrient.key}` ? true : undefined} aria-describedby={error?.field === `${idPrefix}-${nutrient.key}` ? `${idPrefix}-${nutrient.key}-error` : undefined} onChange={(event) => onChange(nutrient.key, event.target.value)} />
    </div>
  )
  const message = (list: readonly NutrientInfo[]) => error && errorIn(list) && <p className="field-error" id={`${error.field}-error`} role="alert">{error.message}</p>
  const extraFilled = filled(EXTRA_NUTRIENTS)
  // The full list opens by itself for an error inside it and stays open while the box is corrected.
  const [allOpen, setAllOpen] = useState(false)
  const errorInExtra = errorIn(EXTRA_NUTRIENTS)
  const errorField = error !== undefined && NUTRIENTS.some((nutrient) => error.field === `${idPrefix}-${nutrient.key}`) ? error.field : undefined
  useEffect(() => { if (errorInExtra) setAllOpen(true) }, [errorInExtra])
  const flaggedInExtra = flagged !== undefined && EXTRA_NUTRIENTS.some((nutrient) => flagged.includes(nutrient.key))
  useEffect(() => { if (flaggedInExtra) setAllOpen(true) }, [flaggedInExtra])
  // Focus the box once it is on screen: a field inside a closed group cannot take focus.
  useEffect(() => {
    if (errorField && (allOpen || !errorInExtra)) document.getElementById(errorField)?.focus()
  }, [errorField, errorInExtra, allOpen])
  return (
    <details className="nutrient-fields" open={filled(BASIC_NUTRIENTS) + extraFilled > 0 || error !== undefined || flaggedInExtra || undefined}>
      <summary>More nutrients <span>optional</span></summary>
      <div className="nutrient-grid">
        {BASIC_NUTRIENTS.map(field)}
        {message(BASIC_NUTRIENTS)}
      </div>
      <details className="nutrient-all" open={allOpen} onToggle={(event) => setAllOpen(event.currentTarget.open)}>
        <summary>Show all nutrients <span>{extraFilled > 0 ? `${extraFilled} filled` : 'vitamins, minerals, fats'}</span></summary>
        {NUTRIENT_GROUPS.map((group) => {
          const list = EXTRA_NUTRIENTS.filter((nutrient) => nutrient.group === group)
          return (
            <div className="nutrient-group" key={group}>
              <h4>{group}</h4>
              <div className="nutrient-grid flush">
                {list.map(field)}
                {message(list)}
              </div>
            </div>
          )
        })}
      </details>
    </details>
  )
}
