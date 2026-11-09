import { useState, type FormEvent } from 'react'
import { ambiguityMessage, parseDecimalDetailed } from '../lib/decimal'
import { PipFigure } from './Mascot'
import { Icon } from './Icon'

export interface WelcomeChoice {
  weightUnit: 'lb' | 'kg'
  calories?: number
  protein?: number
}

interface WelcomeCardProps {
  onFinish: (choice: WelcomeChoice) => void
  onSkip: () => void
  /** Carries what was typed so far, so the estimator in Settings starts from it. */
  onEstimate: (choice: WelcomeChoice) => void
}

/** First run only: three optional answers, then straight to logging. Nothing here is required to use the app. */
export function WelcomeCard({ onFinish, onSkip, onEstimate }: WelcomeCardProps) {
  const [unit, setUnit] = useState<'lb' | 'kg'>(() => (typeof navigator !== 'undefined' && /^en-(US|LR|MM)\b/.test(navigator.language) ? 'lb' : 'kg'))
  const [calories, setCalories] = useState('')
  const [protein, setProtein] = useState('')
  const [errors, setErrors] = useState<{ calories?: string; protein?: string }>({})
  /** Blank or zero is "no goal"; anything else must be a clear number, and the message says what to fix. */
  const check = (value: string, label: string): { goal?: number; error?: string } => {
    if (value.trim() === '') return {}
    const { value: number } = parseDecimalDetailed(value)
    const unclear = ambiguityMessage(value)
    if (unclear) return { error: unclear }
    if (!Number.isFinite(number) || number < 0) return { error: `${label} must be a number, zero or greater.` }
    return number > 0 ? { goal: number } : {}
  }
  const read = () => {
    const energy = check(calories, 'Daily energy goal')
    const protein_ = check(protein, 'Daily protein goal')
    const next = { calories: energy.error, protein: protein_.error }
    setErrors(next)
    const failed = next.calories ? 'welcome-calories' : next.protein ? 'welcome-protein' : undefined
    if (failed) document.getElementById(failed)?.focus()
    return failed ? undefined : { weightUnit: unit, calories: energy.goal, protein: protein_.goal }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const choice = read()
    if (choice) onFinish(choice)
  }
  return (
    <section className="welcome-card" aria-labelledby="welcome-title">
      <div className="welcome-hero">
        <div className="welcome-pip"><PipFigure mood="wave" size={72} /></div>
        <div>
          <h2 id="welcome-title">Hi, I’m Pip!</h2>
          <p>Let’s set you up in 20 seconds. Everything stays on this device, and you can skip any of it.</p>
        </div>
      </div>
      <form className="welcome-form" onSubmit={submit}>
        <div className="welcome-row">
          <span className="welcome-label" id="welcome-units">Units</span>
          <div className="range-toggle" role="group" aria-labelledby="welcome-units">
            {(['lb', 'kg'] as const).map((option) => <button key={option} type="button" aria-pressed={unit === option} className={unit === option ? 'active' : ''} onClick={() => setUnit(option)}>{option === 'lb' ? 'lb, fl oz' : 'kg, ml'}</button>)}
          </div>
        </div>
        <div className="welcome-fields">
          <div className="form-field"><label htmlFor="welcome-calories">Daily energy goal <span>kcal, optional</span></label><input id="welcome-calories" inputMode="decimal" placeholder="e.g. 2000" type="text" value={calories} aria-invalid={errors.calories ? true : undefined} aria-describedby={errors.calories ? 'welcome-calories-error' : undefined} onChange={(event) => { setCalories(event.target.value); setErrors({ ...errors, calories: undefined }) }} />{errors.calories && <p className="field-error" id="welcome-calories-error" role="alert">{errors.calories}</p>}</div>
          <div className="form-field"><label htmlFor="welcome-protein">Daily protein goal <span>g, optional</span></label><input id="welcome-protein" inputMode="decimal" placeholder="e.g. 120" type="text" value={protein} aria-invalid={errors.protein ? true : undefined} aria-describedby={errors.protein ? 'welcome-protein-error' : undefined} onChange={(event) => { setProtein(event.target.value); setErrors({ ...errors, protein: undefined }) }} />{errors.protein && <p className="field-error" id="welcome-protein-error" role="alert">{errors.protein}</p>}</div>
        </div>
        <button className="text-button welcome-estimate" type="button" onClick={() => { const choice = read(); if (choice) onEstimate(choice) }}>Not sure? Estimate a starting target<Icon name="arrow-right" size={15} /></button>
        <div className="welcome-actions">
          <button className="text-button welcome-skip" type="button" onClick={onSkip}>Skip setup</button>
          <button className="button primary" type="submit">Start logging</button>
        </div>
      </form>
    </section>
  )
}
