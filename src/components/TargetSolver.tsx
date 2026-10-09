import { useState } from 'react'
import { solveAmount } from '../lib/solve'
import { formatNumber } from '../lib/utils'

export interface TargetOption {
  key: string
  label: string
  /** Amount of this nutrient in one unit of the food (one serving, or one gram). */
  perUnit: number
}

interface TargetSolverProps {
  options: TargetOption[]
  /** What is being solved for: 'servings' or 'g'. */
  unit: string
  /** Decimals kept in the answer. */
  digits?: number
  onApply: (amount: number) => void
}

/** "I want 30 g of protein from this": work out the amount of the food that gives a target, and set it. */
export function TargetSolver({ options, unit, digits = 2, onApply }: TargetSolverProps) {
  const usable = options.filter((option) => option.perUnit > 0)
  const [key, setKey] = useState(usable[0]?.key ?? '')
  const [target, setTarget] = useState('')
  if (usable.length === 0) return null
  const chosen = usable.find((option) => option.key === key) ?? usable[0]
  const amount = solveAmount(Number(target), chosen.perUnit, digits)
  return (
    <div className="target-solver">
      <span className="field-label">Log by target</span>
      <div className="target-solver-row">
        <select aria-label="Log by target nutrient" value={chosen.key} onChange={(event) => setKey(event.target.value)}>
          {usable.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
        </select>
        <input aria-label="Target amount" inputMode="decimal" min="0" placeholder="e.g. 30" step="any" type="number" value={target} onChange={(event) => setTarget(event.target.value)} />
        <button className="button secondary compact" disabled={amount === undefined} type="button" onClick={() => { if (amount !== undefined) onApply(amount) }}>Set amount</button>
      </div>
      <p className="field-hint" aria-live="polite">{amount === undefined ? 'Enter how much you want, and the amount of this food is worked out for you.' : `That is ${formatNumber(amount, digits)} ${unit}.`}</p>
    </div>
  )
}
