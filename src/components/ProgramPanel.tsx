import { useEffect, useState, type FormEvent } from 'react'
import type { Program } from '../types'
import type { ExpenditureEstimate } from '../lib/expenditure'
import { inputText, parseDecimal } from '../lib/decimal'
import { firstNumberProblem } from '../lib/numberProblem'
import { useFieldProblem } from '../lib/useFieldProblem'
import { budgetFor, DIET_STYLES, describeGoalProgress, goalProgress, readProgram, type Budget, type DietStyle } from '../lib/program'
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
  dietStyle: DietStyle | ''
  checkInDay: string
}

const toDraft = (program: Program): Draft => ({
  direction: program.direction ?? '',
  goalWeight: program.goalWeight === undefined ? '' : inputText(program.goalWeight),
  weeklyRate: program.weeklyRate === undefined ? '' : inputText(program.weeklyRate),
  proteinPerWeight: program.proteinPerWeight === undefined ? '' : inputText(program.proteinPerWeight),
  dietStyle: program.dietStyle ?? '',
  checkInDay: program.checkInDay === undefined ? '' : String(program.checkInDay),
})

const positiveOrUndefined = (value: string): number | undefined => {
  if (!value.trim()) return undefined
  const parsed = parseDecimal(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

export function ProgramPanel({ program, unit, expenditure, trendWeight, onSave, onApplyBudget }: ProgramPanelProps) {
  const stored = readProgram(program)
  const [draft, setDraft] = useState<Draft>(() => toDraft(stored))
  const [error, setError] = useState('')
  const [problem, setProblem] = useFieldProblem((id) => (id === 'program-goal-weight' ? draft.goalWeight : id === 'program-rate' ? draft.weeklyRate : draft.proteinPerWeight))
  useEffect(() => setDraft(toDraft(readProgram(program))), [program])

  const step = unit === 'kg' ? 0.1 : 0.25
  const maxRate = unit === 'kg' ? 1 : 2
  const rate = positiveOrUndefined(draft.weeklyRate)
  const setRate = (value: number) => setDraft({ ...draft, weeklyRate: inputText(Math.round(Math.min(maxRate, Math.max(step, value)) * 100) / 100) })

  const candidate: Program = {
    direction: draft.direction || undefined,
    goalWeight: positiveOrUndefined(draft.goalWeight),
    weeklyRate: draft.direction === 'maintain' ? undefined : rate,
    proteinPerWeight: positiveOrUndefined(draft.proteinPerWeight),
    dietStyle: draft.dietStyle || undefined,
    checkInDay: draft.checkInDay === '' ? undefined : Number(draft.checkInDay),
  }
  // Losing or gaining needs a pace; without one the "budget" would just be maintenance, which is not what was asked for.
  const needsRate = (candidate.direction === 'lose' || candidate.direction === 'gain') && candidate.weeklyRate === undefined
  const budget = candidate.direction && !needsRate && expenditure.kind === 'ok' ? budgetFor(candidate, unit, expenditure.kcalPerDay, trendWeight) : undefined
  // The protein target only needs a body weight, so it shows before there is enough data for a budget.
  const proteinTarget = candidate.proteinPerWeight !== undefined && trendWeight !== undefined ? Math.round(candidate.proteinPerWeight * trendWeight) : budget?.protein
  const progress = trendWeight !== undefined ? goalProgress(candidate, trendWeight, todayISO()) : undefined
  // One percent of body weight a week is the usual ceiling for a steady loss.
  const fast = trendWeight !== undefined && rate !== undefined && candidate.direction === 'lose' && rate > trendWeight * 0.01

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const rateShown = draft.direction !== '' && draft.direction !== 'maintain'
    const found = firstNumberProblem([
      { id: 'program-goal-weight', text: draft.goalWeight, message: 'Goal weight must be a number greater than zero.', positive: true },
      ...(rateShown ? [{ id: 'program-rate', text: draft.weeklyRate, message: 'Choose a weekly rate greater than zero.', required: true, positive: true }] : []),
      { id: 'program-protein', text: draft.proteinPerWeight, message: 'Protein target must be a number greater than zero.', positive: true },
    ])
    if (found) { setProblem(found); setError(''); document.getElementById(found.field)?.focus(); return }
    setProblem(undefined)
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
          <input id="program-goal-weight" aria-invalid={problem?.field === 'program-goal-weight' ? true : undefined} aria-describedby={problem?.field === 'program-goal-weight' ? 'program-goal-weight-error' : undefined} inputMode="decimal" placeholder="e.g. 170" type="text" value={draft.goalWeight} onChange={(event) => setDraft({ ...draft, goalWeight: event.target.value })} />{problem?.field === 'program-goal-weight' && <p className="field-error" id="program-goal-weight-error" role="alert">{problem.message}</p>}
        </div>
        {draft.direction && draft.direction !== 'maintain' && (
          <div className="form-field full">
            <label htmlFor="program-rate">Rate <span>{unit} per week</span></label>
            <div className="grams-stepper">
              <button className="icon-button" type="button" aria-label="Slower" disabled={rate === undefined || rate <= step} onClick={() => setRate((rate ?? step) - step)}>−</button>
              <div className="input-with-suffix wide"><input id="program-rate" aria-invalid={problem?.field === 'program-rate' ? true : undefined} aria-describedby={problem?.field === 'program-rate' ? 'program-rate-error' : undefined} inputMode="decimal" type="text" value={draft.weeklyRate} onChange={(event) => setDraft({ ...draft, weeklyRate: event.target.value })} /><span>{unit}</span></div>
              <button className="icon-button" type="button" aria-label="Faster" disabled={rate !== undefined && rate >= maxRate} onClick={() => setRate((rate ?? 0) + step)}>+</button>
            </div>
            {problem?.field === 'program-rate' && <p className="field-error" id="program-rate-error" role="alert">{problem.message}</p>}
            {fast && <p className="field-hint warn">That is faster than one percent of your body weight a week. Slower is easier to keep and protects muscle.</p>}
          </div>
        )}
        <div className="form-field full">
          <label htmlFor="program-protein">Protein target <span>g per {unit}</span></label>
          <input id="program-protein" aria-invalid={problem?.field === 'program-protein' ? true : undefined} aria-describedby={problem?.field === 'program-protein' ? 'program-protein-error' : undefined} inputMode="decimal" placeholder={unit === 'lb' ? 'e.g. 0.8' : 'e.g. 1.8'} type="text" value={draft.proteinPerWeight} onChange={(event) => setDraft({ ...draft, proteinPerWeight: event.target.value })} />{problem?.field === 'program-protein' && <p className="field-error" id="program-protein-error" role="alert">{problem.message}</p>}
        </div>
        <div className="form-field full">
          <label htmlFor="program-diet-style">Diet style</label>
          <select id="program-diet-style" value={draft.dietStyle} onChange={(event) => setDraft({ ...draft, dietStyle: event.target.value as DietStyle | '' })}>
            <option value="">Balanced (30% fat)</option>
            {(Object.keys(DIET_STYLES) as DietStyle[]).filter((key) => key !== 'balanced').map((key) => <option key={key} value={key}>{DIET_STYLES[key].label} ({Math.round(DIET_STYLES[key].fatShare * 100)}% fat)</option>)}
          </select>
          <p className="field-hint">Sets how the budget splits between fat and carbs once a protein target is set.</p>
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
        <div className="stat-row"><span>Protein target</span><strong>{proteinTarget !== undefined ? `${formatNumber(proteinTarget)} g` : '—'}</strong></div>
      </div>
      {needsRate && <p className="field-hint">Choose a weekly rate to see your budget.</p>}
      {budget?.nudge !== undefined && <p className="field-hint">Includes a {Math.abs(budget.nudge)} kcal nudge {budget.nudge > 0 ? 'up' : 'down'} to bring your trend back toward your goal weight.</p>}
      {budget?.floored && <p className="field-hint warn">That rate would go below {formatNumber(1200)} kcal a day, so the budget is held at {formatNumber(1200)}. Choose a slower rate.</p>}
      {expenditure.kind !== 'ok' && candidate.direction && <p className="form-note"><Icon name="info" size={15} />A budget appears once there is enough logged food and weight data to estimate your expenditure. {expenditure.reason}</p>}
      {budget && (
        <button className="button secondary full-width apply-budget" type="button" onClick={() => { void onApplyBudget(budget) }}>Set my daily budget to {formatNumber(budget.calories)} kcal</button>
      )}
    </section>
  )
}
