import { useState } from 'react'
import type { LimitProblem } from './limits'

/**
 * One field-level message for a form (`{ field, message }`, field being the element id). The message belongs to the text it was
 * raised for, so it goes away by itself as soon as that box is edited.
 */
export function useFieldProblem(textOf: (id: string) => string): [LimitProblem | undefined, (problem: LimitProblem | undefined) => void] {
  const [raised, setRaised] = useState<(LimitProblem & { text: string }) | undefined>()
  const shown = raised && textOf(raised.field) === raised.text ? { field: raised.field, message: raised.message } : undefined
  return [shown, (problem) => setRaised(problem ? { ...problem, text: textOf(problem.field) } : undefined)]
}
