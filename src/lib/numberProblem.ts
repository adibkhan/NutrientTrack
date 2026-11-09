import { ambiguityMessage, parseDecimal } from './decimal'
import type { LimitProblem } from './limits'

export interface NumberCheck {
  /** The element id of the box. */
  id: string
  text: string
  /** Shown when the text is not a number of zero or more (or more than zero with `positive`), and when a `required` box is blank. */
  message: string
  required?: boolean
  positive?: boolean
}

/**
 * The first box whose text is not usable, with its message: ambiguous text ("2,000") gets the readings message, and anything
 * non-blank that does not parse (or is negative) gets the box's own message. Non-blank text is never read as blank or zero.
 */
export const firstNumberProblem = (checks: NumberCheck[]): LimitProblem | undefined => {
  for (const check of checks) {
    if (check.text.trim() === '') {
      if (check.required) return { field: check.id, message: check.message }
      continue
    }
    const ambiguous = ambiguityMessage(check.text)
    if (ambiguous) return { field: check.id, message: ambiguous }
    const value = parseDecimal(check.text)
    if (!Number.isFinite(value) || value < 0 || (check.positive === true && value <= 0)) return { field: check.id, message: check.message }
  }
  return undefined
}
