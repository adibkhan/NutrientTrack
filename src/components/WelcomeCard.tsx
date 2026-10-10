import { useState, type FormEvent } from 'react'
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
  onEstimate: () => void
}

/** First run only: three optional answers, then straight to logging. Nothing here is required to use the app. */
export function WelcomeCard({ onFinish, onSkip, onEstimate }: WelcomeCardProps) {
  const [unit, setUnit] = useState<'lb' | 'kg'>(() => (typeof navigator !== 'undefined' && /^en-(US|LR|MM)\b/.test(navigator.language) ? 'lb' : 'kg'))
  const [calories, setCalories] = useState('')
  const [protein, setProtein] = useState('')
  const positive = (value: string) => {
    const number = Number(value)
    return value.trim() && Number.isFinite(number) && number > 0 ? number : undefined
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onFinish({ weightUnit: unit, calories: positive(calories), protein: positive(protein) })
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
          <div className="form-field"><label htmlFor="welcome-calories">Daily energy goal <span>kcal, optional</span></label><input id="welcome-calories" inputMode="decimal" min="0" placeholder="e.g. 2,000" type="number" value={calories} onChange={(event) => setCalories(event.target.value)} /></div>
          <div className="form-field"><label htmlFor="welcome-protein">Daily protein goal <span>g, optional</span></label><input id="welcome-protein" inputMode="decimal" min="0" placeholder="e.g. 120" type="number" value={protein} onChange={(event) => setProtein(event.target.value)} /></div>
        </div>
        <button className="text-button welcome-estimate" type="button" onClick={onEstimate}>Not sure? Estimate a starting target<Icon name="arrow-right" size={15} /></button>
        <div className="welcome-actions">
          <button className="button secondary" type="button" onClick={onSkip}>Skip setup</button>
          <button className="button primary" type="submit"><Icon name="check" size={16} />Start logging</button>
        </div>
      </form>
    </section>
  )
}
