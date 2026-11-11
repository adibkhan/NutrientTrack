import { useEffect, useState } from 'react'
import { ambiguityMessage, inputText, parseDecimalDetailed } from '../lib/decimal'
import { dayTargets, deltaFromTarget, effectiveTargets, higherWeekends, MAX_DAY_KCAL, MIN_DAY_KCAL, rebalance, SHIFT_STEP, shiftProblem, sum, WEEKDAY_NAMES, weeklyTotal } from '../lib/calorieShift'
import { formatNumber } from '../lib/utils'
import { Icon } from './Icon'

interface CalorieShiftPanelProps {
  /** The daily calorie goal as typed above, when it is a usable number. */
  goal: number | undefined
  /** Seven deltas, Sunday first. */
  value: number[]
  /** Called with the new deltas whenever the person changes them here. */
  onChange: (next: number[]) => void
  /** Show the save-time problem even if the person has not touched anything since. */
  showProblem?: boolean
  /** A one-line note, such as "reduced to keep every day at 1,200 kcal or more". */
  notice?: string
}

/** "Shift calories across the week": the daily goal stays the average, individual days go up or down. */
export function CalorieShiftPanel({ goal, value, onChange, showProblem, notice }: CalorieShiftPanelProps) {
  const [texts, setTexts] = useState<Record<number, string>>({})
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({})
  const [open, setOpen] = useState(() => value.some((delta) => delta !== 0))
  // The spoken total changes when a step, preset or field commit finishes, not on every keystroke.
  const [spoken, setSpoken] = useState('')
  const [pending, setPending] = useState(false)
  const active = value.some((delta) => delta !== 0)
  const usable = goal !== undefined && goal > 0
  const problem = shiftProblem(goal, value)
  const exact = sum(value)
  const targets = usable ? effectiveTargets(goal, value) : []
  const weekTotal = sum(targets)
  const balanced = usable && weekTotal === weeklyTotal(goal)
  const floored = usable && exact === 0 && !balanced
  const totalText = !usable ? '' : balanced ? `Weekly total unchanged: ${formatNumber(weeklyTotal(goal))} kcal` : floored
    ? `Weekly total is ${formatNumber(weekTotal)} kcal with the ${formatNumber(MIN_DAY_KCAL)} kcal floor, not ${formatNumber(weeklyTotal(goal))}`
    : `Weekly total is ${formatNumber(weeklyTotal(goal) + exact)} kcal, not ${formatNumber(weeklyTotal(goal))}`
  const canPreset = usable && goal >= MIN_DAY_KCAL + 10

  useEffect(() => {
    if (!pending) return
    setPending(false)
    setSpoken(usable ? `Week adds up to ${formatNumber(weekTotal)} kcal${balanced ? ', the same as your goal.' : `, not ${formatNumber(weeklyTotal(goal))}.`}` : '')
  }, [pending, usable, weekTotal, balanced, goal])

  const setDelta = (day: number, delta: number) => {
    if (!usable) return
    const bounded = Math.min(MAX_DAY_KCAL - goal, Math.max(-goal, delta))
    onChange(value.map((current, index) => (index === day ? bounded : current)))
  }
  const step = (day: number, by: number) => { setRowErrors({}); setTexts({}); setDelta(day, value[day] + by); setPending(true) }
  const replaceAll = (next: number[]) => { setTexts({}); setRowErrors({}); onChange(next); setPending(true) }
  const type = (day: number, text: string) => {
    setTexts({ ...texts, [day]: text })
    const { value: parsed, reason } = parseDecimalDetailed(text)
    if (text.trim() === '') { setRowErrors({ ...rowErrors, [day]: 'Enter the kcal for this day.' }); return }
    if (reason || !Number.isFinite(parsed) || parsed < 0) {
      setRowErrors({ ...rowErrors, [day]: ambiguityMessage(text) ?? 'Enter a number of kcal.' })
      return
    }
    const { [day]: _cleared, ...rest } = rowErrors
    setRowErrors(rest)
    setDelta(day, deltaFromTarget(goal as number, parsed))
  }
  const commit = (day: number) => {
    setTexts((current) => { const { [day]: _drop, ...rest } = current; return rest })
    setRowErrors((current) => { const { [day]: _drop, ...rest } = current; return rest })
    setPending(true)
  }

  return (
    <details className="shift-panel" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Shift calories across the week</summary>
      <p className="field-hint">Eat more on some days and less on others. Your daily goal stays the average, so the week adds up the same. Macro goals stay the same every day.</p>
      {!usable && <p className="field-hint">Enter a calorie goal above to shift it.</p>}
      {notice && <p className="field-hint warn">{notice}</p>}
      {usable && (
        <>
          <ul className="shift-rows">
            {WEEKDAY_NAMES.map((name, day) => {
              const low = dayTargets(goal, value)[day] < MIN_DAY_KCAL
              return (
                <li key={name} className="shift-row">
                  <span className="shift-day"><label htmlFor={`shift-${day}`}>{name}</label>
                    <small className={`shift-delta ${value[day] === 0 ? '' : value[day] > 0 ? 'up' : 'down'}`}>{value[day] === 0 ? 'At goal' : `${value[day] > 0 ? '+' : '−'}${formatNumber(Math.abs(value[day]))} kcal`}</small></span>
                  <button className="icon-button" type="button" aria-label={`${SHIFT_STEP} fewer kcal on ${name}`} onClick={() => step(day, -SHIFT_STEP)}>−</button>
                  <input id={`shift-${day}`} inputMode="decimal" type="text" aria-label={`${name} kcal`} aria-invalid={low || rowErrors[day] ? true : undefined} aria-describedby={rowErrors[day] ? `shift-${day}-error` : undefined} value={texts[day] ?? inputText(dayTargets(goal, value)[day])} onChange={(event) => type(day, event.target.value)} onBlur={() => commit(day)} />
                  <button className="icon-button" type="button" aria-label={`${SHIFT_STEP} more kcal on ${name}`} onClick={() => step(day, SHIFT_STEP)}>+</button>
                  {rowErrors[day] && <p className="field-error shift-row-error" id={`shift-${day}-error`}>{rowErrors[day]}</p>}
                </li>
              )
            })}
          </ul>
          <p className={`shift-total ${balanced ? 'ok' : 'off'}`}>{totalText}</p>
          <p className="visually-hidden" role="status">{spoken}</p>
          {(showProblem || exact !== 0 || dayTargets(goal, value).some((target) => target < MIN_DAY_KCAL)) && problem && <p className="field-error" id="shift-error">{problem}</p>}
          <div className="shift-actions">
            <button className="button secondary compact" type="button" disabled={!canPreset} onClick={() => replaceAll(higherWeekends(goal))}>Higher weekends</button>
            <button className="button secondary compact" type="button" disabled={exact === 0} onClick={() => replaceAll(rebalance(goal, value))}><Icon name="check" size={14} />Balance</button>
            <button className="button secondary compact" type="button" disabled={!active} onClick={() => replaceAll(Array(7).fill(0))}>Reset</button>
          </div>
          {!canPreset && <p className="field-hint">Higher weekends needs a goal above {formatNumber(MIN_DAY_KCAL)} kcal.</p>}
        </>
      )}
    </details>
  )
}
