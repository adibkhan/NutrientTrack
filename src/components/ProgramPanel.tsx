import { useEffect, useState, type FormEvent } from 'react'
import type { Program } from '../types'
import type { ExpenditureEstimate } from '../lib/expenditure'
import { budgetFor, describeGoalProgress, goalProgress, readProgram, type Budget } from '../lib/program'
import { formatNumber, todayISO } from '../lib/utils'
import { Icon } from './Icon'

interface ProgramPanelProps {
  program: Program | undefined
  unit: 'lb' | 'kg'
  expenditure: ExpenditureEstimate
  /** Latest trend weight in the display unit, when there are weigh-ins. */
  trendWeight?: number
  onSave: (program: Program) => Promise<void>
  onApplyBudget: (budget: Budget) => Promise<void>
}

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const directions = [{ value: 'lose', label: 'Lose' }, { value: 'maintain', label: 'Maintain' }, { value: 'gain', label: 'Gain' }] as const

interface Draft {
  direction: NonNullable<Program['direction']> | ''
  goalWeight: string
  weeklyRate: string
  proteinPerWeight: string
  checkInDay: string
}

const toDraft = (program: Program): Draft => ({
  direction: program.direction ?? '',
  goalWeight: program.goalWeight === undefined ? '' : String(program.goalWeight),
  weeklyRate: program.weeklyRate === undefined ? '' : String(program.weeklyRate),
  proteinPerWeight: program.proteinPerWeight === undefined ? '' : String(program.proteinPerWeight),
  checkInDay: program.checkInDay === undefined ? '' : String(program.checkInDay),
})

const positiveOrUndefined = (value: string): number | undefined => {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

export function ProgramPanel({ program, unit, expenditure, trendWeight, onSave, onApplyBudget }: ProgramPanelProps) {
  const stored = readProgram(program)
  const [draft, setDraft] = useState<Draft>(() => toDraft(stored))
  const [error, setError] = useState('')
  useEffect(() => setDraft(toDraft(readProgram(program))), [program])

  const step = unit === 'kg' ? 0.1 : 0.25
  const maxRate = unit === 'kg' ? 1 : 2
  const rate = positiveOrUndefined(draft.weeklyRate)
  const setRate = (value: number) => setDraft({ ...draft, weeklyRate: String(Math.round(Math.min(maxRate, Math.max(step, value)) * 100) / 100) })

  const candidate: Program = {
    direction: draft.direction || undefined,
    goalWeight: positiveOrUndefined(draft.goalWeight),
    weeklyRate: draft.direction === 'maintain' ? undefined : rate,
    proteinPerWeight: positiveOrUndefined(draft.proteinPerWeight),
    checkInDay: draft.checkInDay === '' ? undefined : Number(draft.checkInDay),
  }
  const budget = candidate.direction && expenditure.kind === 'ok' ? budgetFor(candidate, unit, expenditure.kcalPerDay, trendWeight) : undefined
  const progress = trendWeight !== undefined ? goalProgress(candidate, trendWeight, todayISO()) : undefined
  // One percent of body weight a week is the usual ceiling for a steady loss.
  const fast = trendWeight !== undefined && rate !== undefined && candidate.direction === 'lose' && rate > trendWeight * 0.01

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (draft.goalWeight.trim() && positiveOrUndefined(draft.goalWeight) === undefined) { setError('Goal weight must be a number greater than zero.'); return }
    if (draft.direction && draft.direction !== 'maintain' && rate === undefined) { setError('Choose a weekly rate greater than zero.'); return }
    setError('')
    // Only the fields this form owns are sent; the app merges them into the stored record so nothing else on it is lost.
    await onSave(Object.fromEntries(Object.entries(candidate).filter(([, value]) => value !== undefined)) as Program)
  }

  return (
    <section className="panel program-panel" aria-labelledby="program-heading">
      <div className="panel-header"><div><h2 id="program-heading">Program</h2></div><span className="summary-badge">Optional</span></div>
      <form className="goals-form" onSubmit={submit}>
        <div className="form-field full">
          <span className="field-label" id="program-direction-label">Goal</span>
          <div className="range-toggle program-direction" role="group" aria-labelledby="program-direction-label">
            {directions.map((option) => (
              <button aria-pressed={draft.direction === option.value} className={draft.direction === option.value ? 'active' : ''} key={option.value} type="button" onClick={() => setDraft({ ...draft, direction: option.value })}>{option.label}</button>
            ))}
          </div>
        </div>
        <div className="form-field full">
          <label htmlFor="program-goal-weight">Goal weight <span>{unit}</span></label>
          <input id="program-goal-weight" inputMode="decimal" min="0" placeholder="e.g. 170" step="any" type="number" value={draft.goalWeight} onChange={(event) => setDraft({ ...draft, goalWeight: event.target.value })} />
        </div>
        {draft.direction && draft.direction !== 'maintain' && (
          <div className="form-field full">
            <label htmlFor="program-rate">Rate <span>{unit} per week</span></label>
            <div className="grams-stepper">
              <button className="icon-button" type="button" aria-label="Slower" disabled={rate === undefined || rate <= step} onClick={() => setRate((rate ?? step) - step)}>−</button>
              <div className="input-with-suffix wide"><input id="program-rate" inputMode="decimal" min="0" step="any" type="number" value={draft.weeklyRate} onChange={(event) => setDraft({ ...draft, weeklyRate: event.target.value })} /><span>{unit}</span></div>
              <button className="icon-button" type="button" aria-label="Faster" disabled={rate !== undefined && rate >= maxRate} onClick={() => setRate((rate ?? 0) + step)}>+</button>
            </div>
            {fast && <p className="field-hint warn">That is faster than one percent of your body weight a week. Slower is easier to keep and protects muscle.</p>}
          </div>
        )}
        <div className="form-field full">
          <label htmlFor="program-protein">Protein target <span>g per {unit}</span></label>
          <input id="program-protein" inputMode="decimal" min="0" placeholder={unit === 'lb' ? 'e.g. 0.8' : 'e.g. 1.8'} step="any" type="number" value={draft.proteinPerWeight} onChange={(event) => setDraft({ ...draft, proteinPerWeight: event.target.value })} />
        </div>
        <div className="form-field full">
          <label htmlFor="program-checkin-day">Check-in day</label>
          <select id="program-checkin-day" value={draft.checkInDay} onChange={(event) => setDraft({ ...draft, checkInDay: event.target.value })}>
            <option value="">No weekly check-in</option>
            {weekdays.map((name, index) => <option key={name} value={index}>{name}</option>)}
          </select>
        </div>
        {error && <p className="form-error" role="alert"><Icon name="info" size={15} />{error}</p>}
        <button className="button primary" type="submit"><Icon name="check" size={16} />Save program</button>
      </form>
      <div className="stat-list">
        <div className="stat-row"><span>Resulting budget</span><strong>{budget ? `${formatNumber(budget.calories)} kcal / day` : '—'}</strong></div>
        <div className="stat-row"><span>To goal</span><strong>{progress ? describeGoalProgress(progress, unit) : '—'}</strong></div>
        <div className="stat-row"><span>Protein target</span><strong>{budget?.protein !== undefined ? `${formatNumber(budget.protein)} g` : '—'}</strong></div>
      </div>
      {budget?.floored && <p className="field-hint warn">That rate would go below {formatNumber(1200)} kcal a day, so the budget is held at {formatNumber(1200)}. Choose a slower rate.</p>}
      {expenditure.kind !== 'ok' && candidate.direction && <p className="form-note"><Icon name="info" size={15} />A budget appears once there is enough logged food and weight data to estimate your expenditure. {expenditure.reason}</p>}
      {budget && (
        <button className="button secondary full-width apply-budget" type="button" onClick={() => { void onApplyBudget(budget) }}>Set my daily budget to {formatNumber(budget.calories)} kcal</button>
      )}
    </section>
  )
}
