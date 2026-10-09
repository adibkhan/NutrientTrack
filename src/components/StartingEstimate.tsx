import { useState } from 'react'
import type { Program } from '../types'
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
  /** Put a number into the calorie goal box. The goals form still has to be saved. */
  onUse: (calories: number) => void
}

/**
 * An optional calculator for a first calorie target. The numbers typed here exist only while this box is open: nothing
 * is stored, synced or sent anywhere, and the result only fills the calorie box when asked.
 */
export function StartingEstimate({ unit, trendWeight, program, onUse }: StartingEstimateProps) {
  const [formula, setFormula] = useState<'male' | 'female'>('female')
  const [age, setAge] = useState('')
  const [height, setHeight] = useState('')
  const [weight, setWeight] = useState('')
  const [activity, setActivity] = useState<ActivityLevel>('light')

  const weightValue = weight.trim() ? Number(weight) : trendWeight
  const heightCm = Number(height) * (unit === 'lb' ? CM_PER_INCH : 1)
  const weightKg = weightValue === undefined ? NaN : unit === 'lb' ? weightValue / LB_PER_KG : weightValue
  const maintenance = estimateMaintenance({ formula, age: Number(age), heightCm, weightKg, activity })
  const stored = readProgram(program)
  const forProgram = maintenance !== undefined && stored.direction && !((stored.direction === 'lose' || stored.direction === 'gain') && stored.weeklyRate === undefined)
    ? budgetFor(stored, unit, maintenance, weightValue)
    : undefined

  return (
    // Enter in these boxes must not submit the goals form this sits inside.
    <details className="starting-estimate" onKeyDown={(event) => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault() }}>
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
          <div className="form-field"><label htmlFor="est-age">Age</label><input id="est-age" inputMode="numeric" min="0" placeholder="35" type="number" value={age} onChange={(event) => setAge(event.target.value)} /></div>
          <div className="form-field"><label htmlFor="est-height">Height <span>{unit === 'lb' ? 'in' : 'cm'}</span></label><input id="est-height" inputMode="decimal" min="0" placeholder={unit === 'lb' ? '67' : '170'} type="number" value={height} onChange={(event) => setHeight(event.target.value)} /></div>
          <div className="form-field"><label htmlFor="est-weight">Weight <span>{unit}</span></label><input id="est-weight" inputMode="decimal" min="0" placeholder={trendWeight === undefined ? '' : formatNumber(trendWeight, 1)} type="number" value={weight} onChange={(event) => setWeight(event.target.value)} /></div>
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
