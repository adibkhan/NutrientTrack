import { useState } from 'react'
import type { Program } from '../types'
import { ambiguityMessage, parseDecimal } from '../lib/decimal'
import { budgetFor, readProgram } from '../lib/program'
import { ACTIVITY_LEVELS, estimateMaintenance, type ActivityLevel } from '../lib/startingEstimate'
import { CM_PER_INCH } from '../lib/measurements'
import { LB_PER_KG } from '../lib/trend'
import { formatNumber } from '../lib/utils'

interface StartingEstimateProps {
  unit: 'lb' | 'kg'
  /** Latest trend weight in `unit`, to pre-fill the weight box. */
  trendWeight?: number
  program: Program | undefined
  /** Start expanded, e.g. when arriving from the welcome card's estimate link. */
  defaultOpen?: boolean
  /** Put a number into the calorie goal box. The goals form still has to be saved. */
  onUse: (calories: number) => void
}

/**
 * An optional calculator for a first calorie target. The numbers typed here exist only while this box is open: nothing
 * is stored, synced or sent anywhere, and the result only fills the calorie box when asked.
 */
export function StartingEstimate({ unit, trendWeight, program, defaultOpen, onUse }: StartingEstimateProps) {
  const [open, setOpen] = useState(defaultOpen === true)
  const [formula, setFormula] = useState<'male' | 'female'>('female')
  const [age, setAge] = useState('')
  const [height, setHeight] = useState('')
  const [weight, setWeight] = useState('')
  const [activity, setActivity] = useState<ActivityLevel>('light')

  const weightValue = weight.trim() ? parseDecimal(weight) : trendWeight
  const heightCm = parseDecimal(height) * (unit === 'lb' ? CM_PER_INCH : 1)
  const weightKg = weightValue === undefined ? NaN : unit === 'lb' ? weightValue / LB_PER_KG : weightValue
  const maintenance = estimateMaintenance({ formula, age: parseDecimal(age), heightCm, weightKg, activity })
  const ambiguous = { age: ambiguityMessage(age), height: ambiguityMessage(height), weight: ambiguityMessage(weight) }
  const stored = readProgram(program)
  const forProgram = maintenance !== undefined && stored.direction && !((stored.direction === 'lose' || stored.direction === 'gain') && stored.weeklyRate === undefined)
    ? budgetFor(stored, unit, maintenance, weightValue)
    : undefined

  return (
    // Enter in these boxes must not submit the goals form this sits inside.
    <details className="starting-estimate" open={open} onToggle={(event) => setOpen(event.currentTarget.open)} onKeyDown={(event) => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault() }}>
      <summary>Estimate a starting target <span>optional</span></summary>
      <div className="starting-estimate-body">
        <p className="field-hint">Type a few numbers to get a first guess. They are not saved. Once you have logged food and weight for about two weeks, NutrientTrack measures your real expenditure instead.</p>
        <div className="form-field full">
          <label htmlFor="est-formula">Formula</label>
          <select id="est-formula" value={formula} onChange={(event) => setFormula(event.target.value as 'male' | 'female')}>
            <option value="female">Female formula</option>
            <option value="male">Male formula</option>
          </select>
        </div>
        <div className="goal-fields">
          <div className="form-field"><label htmlFor="est-age">Age</label><div className="input-with-suffix wide est-suffix"><input id="est-age" aria-invalid={ambiguous.age ? true : undefined} aria-describedby={ambiguous.age ? 'est-age-error' : undefined} inputMode="numeric" placeholder="e.g. 35" type="text" value={age} onChange={(event) => setAge(event.target.value)} /><span aria-hidden="true">yr</span></div>{ambiguous.age && <p className="field-error" id="est-age-error" role="alert">{ambiguous.age}</p>}</div>
          <div className="form-field"><label htmlFor="est-height">Height <span>{unit === 'lb' ? 'in' : 'cm'}</span></label><div className="input-with-suffix wide est-suffix"><input id="est-height" aria-invalid={ambiguous.height ? true : undefined} aria-describedby={ambiguous.height ? 'est-height-error' : undefined} inputMode="decimal" placeholder={unit === 'lb' ? 'e.g. 67' : 'e.g. 170'} type="text" value={height} onChange={(event) => setHeight(event.target.value)} /><span aria-hidden="true">{unit === 'lb' ? 'in' : 'cm'}</span></div>{ambiguous.height && <p className="field-error" id="est-height-error" role="alert">{ambiguous.height}</p>}</div>
          <div className="form-field"><label htmlFor="est-weight">Weight <span>{unit}</span></label><div className="input-with-suffix wide est-suffix"><input id="est-weight" aria-invalid={ambiguous.weight ? true : undefined} aria-describedby={ambiguous.weight ? 'est-weight-error' : undefined} inputMode="decimal" placeholder={trendWeight === undefined ? (unit === 'lb' ? 'e.g. 150' : 'e.g. 70') : formatNumber(trendWeight, 1)} type="text" value={weight} onChange={(event) => setWeight(event.target.value)} /><span aria-hidden="true">{unit}</span></div>{ambiguous.weight && <p className="field-error" id="est-weight-error" role="alert">{ambiguous.weight}</p>}</div>
        </div>
        <div className="form-field full">
          <label htmlFor="est-activity">Activity</label>
          <select id="est-activity" value={activity} onChange={(event) => setActivity(event.target.value as ActivityLevel)}>
            {ACTIVITY_LEVELS.map((level) => <option key={level.value} value={level.value}>{level.label}</option>)}
          </select>
        </div>
        {maintenance === undefined ? (
          <p className="field-hint">Enter your age, height and weight to see an estimate.</p>
        ) : (
          <div className="stat-list" aria-live="polite">
            <div className="stat-row"><span>Estimated maintenance</span><strong>{formatNumber(maintenance)} kcal / day</strong></div>
            {forProgram && <div className="stat-row"><span>For your program</span><strong>{formatNumber(forProgram.calories)} kcal / day</strong></div>}
          </div>
        )}
        {maintenance !== undefined && (
          <div className="estimate-actions">
            <button className="button secondary compact" type="button" onClick={() => onUse(maintenance)}>Use maintenance as my goal</button>
            {forProgram && <button className="button primary compact" type="button" onClick={() => onUse(forProgram.calories)}>Use the program budget</button>}
          </div>
        )}
      </div>
    </details>
  )
}
