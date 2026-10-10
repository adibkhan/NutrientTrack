import { useState } from 'react'
import { formatNumber } from '../lib/utils'

interface PortionPickerProps {
  portions: Array<[string, number]>
  grams: number
  /** Called with the new gram amount and a serving label such as "2 × 1 large". */
  onPick: (grams: number, label: string) => void
}

/** Shorter chip text: drop USDA's long size notes in parentheses ("1 medium (7\" to 7-7/8\" long)" becomes "1 medium"). */
export const portionChipLabel = (label: string): string => label.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim()

const roundGrams = (value: number) => Math.round(value * 10) / 10

/**
 * USDA household measures as chips. Tapping a chip sets one of it; tapping the same chip again adds another,
 * so "1 large egg" becomes two eggs in two taps. Typing grams by hand clears the selection.
 */
export function PortionPicker({ portions, grams, onPick }: PortionPickerProps) {
  const [picked, setPicked] = useState<{ index: number; count: number } | null>(null)
  const shown = portions.slice(0, 6)
  const active = picked && roundGrams(shown[picked.index]?.[1] * picked.count) === roundGrams(grams) ? picked : null
  if (shown.length === 0) return null
  return (
    <div className="portion-chips" role="group" aria-label="Household measures">
      {shown.map(([label, portionGrams], index) => {
        const isActive = active?.index === index
        const count = isActive ? active.count : 0
        return (
          <button
            key={label}
            type="button"
            className={`amount-chip portion-chip ${isActive ? 'selected' : ''}`}
            aria-pressed={isActive}
            title={`${label} = ${formatNumber(portionGrams, 1)} g`}
            onClick={() => {
              const nextCount = isActive ? count + 1 : 1
              setPicked({ index, count: nextCount })
              const chip = portionChipLabel(label)
              onPick(roundGrams(portionGrams * nextCount), nextCount > 1 ? `${nextCount} × ${chip}` : chip)
            }}
          >
            {isActive && count > 1 && <b className="portion-count">{count}×</b>}
            {portionChipLabel(label)}
            <small>{formatNumber(portionGrams, 0)} g</small>
          </button>
        )
      })}
    </div>
  )
}
