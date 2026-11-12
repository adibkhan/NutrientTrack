import { useEffect, useRef, type ReactNode } from 'react'
import type { MealCategory } from '../types'
import { MAX_PLATE_QTY, plateAmounts, plateTotals, type PlateItem } from '../lib/plate'
import { formatNumber } from '../lib/utils'
import { Icon } from './Icon'

export const PLATE_MEALS: Array<{ key: MealCategory; label: string }> = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'dinner', label: 'Dinner' },
  { key: 'snack', label: 'Snacks' },
  { key: 'other', label: 'Other' },
]

const foodsText = (count: number) => `${count} ${count === 1 ? 'food' : 'foods'}`

/** Keep the search box focused (and the phone keyboard up) when a button is pressed. Keyboard activation is unaffected. */
const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault()

/** The round "+" at the end of a result row. It becomes a check with the count once the food is on the plate. */
export function PlateAddButton({ name, count, onAdd }: { name: string; count: number; onAdd: () => void }) {
  return <button className={`plate-add ${count > 0 ? 'in-plate' : ''}`} type="button" aria-label={count > 0 ? `Add ${name} to plate, ${count} on plate` : `Add ${name} to plate`} onMouseDown={keepFocus} onClick={onAdd}>
    {count > 0 ? <><Icon name="check" size={count > 1 ? 15 : 18} />{count > 1 && <span className="plate-add-count" aria-hidden="true">{count}</span>}</> : <Icon name="plus" size={18} />}
  </button>
}

interface FoodRowProps {
  /** Avatar (recent clock, saved bookmark, catalog glyph) and the copy of the row body, which opens the detail form. */
  lead: ReactNode
  copy: ReactNode
  trail?: ReactNode
  /** Name used in the button labels; it carries the calories when two rows share a name. */
  name: string
  count: number
  onOpen: () => void
  onPlate: () => void
  /** One tap log. Passed only while the plate is empty. */
  onQuick?: () => void
  quickDisabled?: boolean
  className?: string
  /** Full text for a tooltip when the visible name is clamped. */
  title?: string
  /** The food is still being loaded: the row looks busy and keeps taps (the plate button queues them). */
  pending?: boolean
}

/** One result row: the body opens the food; the round buttons at the end log it now (empty plate only) or put it on the plate. */
export function FoodRow({ lead, copy, trail, name, count, onOpen, onPlate, onQuick, quickDisabled, className, title, pending }: FoodRowProps) {
  return <div className={`quick-result ${onQuick ? 'has-quick' : ''} ${pending ? 'is-pending' : ''}`}>
    <button className={`catalog-result ${className ?? ''}`} type="button" title={title} aria-busy={pending ? true : undefined} onClick={onOpen}>{lead}{copy}{trail}</button>
    {onQuick && <button className="quick-add" type="button" disabled={quickDisabled} aria-label={`Log ${name} now`} onClick={onQuick}><Icon name="check" size={18} /></button>}
    <PlateAddButton name={name} count={count} onAdd={onPlate} />
  </div>
}

/** Always mounted, so a screen reader hears the plate change even when its first food appears or its last one goes. */
export function PlateLive({ items, meal }: { items: PlateItem[]; meal: MealCategory }) {
  const totals = plateTotals(items)
  const mealLabel = PLATE_MEALS.find((option) => option.key === meal)?.label ?? 'Other'
  return <p className="visually-hidden" role="status" aria-live="polite">{items.length === 0 ? '' : `${foodsText(totals.foods)} on your plate, ${formatNumber(totals.calories)} kilocalories, logging to ${mealLabel}`}</p>
}

interface TrayProps {
  items: PlateItem[]
  meal: MealCategory
  expanded: boolean
  saving: boolean
  error: string
  confirmDiscard: boolean
  onToggle: () => void
  onMeal: (meal: MealCategory) => void
  onMore: (key: string) => void
  onFewer: (key: string) => void
  onLog: () => void
  onKeep: () => void
  onDiscard: () => void
}

/** The plate pinned to the bottom of the Log food sheet. */
export function PlateTray({ items, meal, expanded, saving, error, confirmDiscard, onToggle, onMeal, onMore, onFewer, onLog, onKeep, onDiscard }: TrayProps) {
  const keepRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (confirmDiscard) keepRef.current?.focus() }, [confirmDiscard])
  if (items.length === 0) return null
  const totals = plateTotals(items)
  return <section className="plate-tray" role="region" aria-label="Plate">
    {confirmDiscard
      ? <div className="plate-discard" role="group" aria-label="Discard plate">
        <strong>Discard {foodsText(totals.foods)}?</strong>
        <div className="plate-discard-actions">
          <button ref={keepRef} className="button secondary" type="button" onClick={onKeep}>Keep plate</button>
          <button className="button danger" type="button" onClick={onDiscard}>Discard</button>
        </div>
      </div>
      : <>
        {expanded && <div className="plate-detail" id="plate-detail">
          <ul className="plate-list" aria-label="Foods on your plate">
            {items.map((line) => <li className="plate-line" key={line.key}>
              <div className="plate-line-copy"><strong>{line.name}</strong><small>{formatNumber(plateAmounts(line).calories)} kcal</small>{line.qty >= MAX_PLATE_QTY && <small className="plate-max">{MAX_PLATE_QTY} is the most per food here</small>}</div>
              <div className="plate-stepper" role="group" aria-label={`Servings of ${line.name}`}>
                <button type="button" aria-label={line.qty > 1 ? `Fewer ${line.name}` : `Remove ${line.name} from plate`} onMouseDown={keepFocus} onClick={() => onFewer(line.key)}>{line.qty > 1 ? '−' : <Icon name="trash" size={15} />}</button>
                <span><span aria-hidden="true">×{line.qty}</span><span className="visually-hidden">{line.qty} on plate</span></span>
                <button type="button" aria-label={`More ${line.name}`} disabled={line.qty >= MAX_PLATE_QTY} onMouseDown={keepFocus} onClick={() => onMore(line.key)}>+</button>
              </div>
            </li>)}
          </ul>
          <p className="plate-macros">Protein {formatNumber(totals.protein, 1)} g · Carbs {formatNumber(totals.carbs, 1)} g · Fat {formatNumber(totals.fat, 1)} g</p>
        </div>}
        <div className="plate-bar">
          <button className="plate-summary" type="button" aria-expanded={expanded} aria-controls={expanded ? 'plate-detail' : undefined} onMouseDown={keepFocus} onClick={onToggle}>
            <span className="plate-summary-text"><strong>{foodsText(totals.foods)}</strong> · {formatNumber(totals.calories)} kcal</span>
            <Icon name="chevron-down" size={16} className={expanded ? 'flip' : ''} />
          </button>
          <label className="plate-meal"><span className="visually-hidden">Log to meal</span>
            <select value={meal} onChange={(event) => onMeal(event.target.value as MealCategory)}>
              {PLATE_MEALS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
            </select>
          </label>
        </div>
        {error && <p className="form-error" role="alert"><Icon name="info" size={15} />{error}</p>}
        <button className="button primary plate-log" type="button" disabled={saving} onClick={onLog}><Icon name="check" size={16} />{saving ? 'Saving…' : `Log ${foodsText(totals.foods)}`}</button>
      </>}
  </section>
}
