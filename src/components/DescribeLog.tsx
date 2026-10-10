import { useEffect, useState } from 'react'
import { loadCatalog } from '../catalog'
import type { CatalogFood } from '../catalog/types'
import { resolveDescription, type ResolvedItem } from '../lib/describe'
import { formatNumber } from '../lib/utils'
import { FoodGlyph } from './FoodGlyph'
import { Icon } from './Icon'

interface DescribeLogProps {
  text: string
  saving: boolean
  onAdd: (items: ResolvedItem[]) => void
}

const kcal = (item: ResolvedItem) => (item.food.per100g.calories * item.grams) / 100

/** "2 eggs, toast and a coffee" as a list to check, then one tap to log them all. Matching happens on the device. */
export function DescribeLog({ text, saving, onAdd }: DescribeLogProps) {
  const [catalog, setCatalog] = useState<CatalogFood[] | null>(null)
  const [removed, setRemoved] = useState<Set<number>>(new Set())
  useEffect(() => {
    let live = true
    void loadCatalog().then((loaded) => { if (live) setCatalog(loaded) }).catch(() => undefined)
    return () => { live = false }
  }, [])
  useEffect(() => { setRemoved(new Set()) }, [text])
  if (!catalog) return null
  const { resolved, unmatched } = resolveDescription(text, catalog)
  const items = resolved.filter((_, index) => !removed.has(index))
  if (resolved.length === 0) return null
  const total = items.reduce((sum, item) => sum + kcal(item), 0)
  return (
    <section className="describe-log" aria-label="Log as a meal">
      <div className="logger-section-title"><span>Log as a meal</span><small>Check each match</small></div>
      <ul>
        {resolved.map((item, index) => removed.has(index) ? null : (
          <li key={`${index}-${item.food.id}`}>
            <FoodGlyph name={item.food.name} category={item.food.category} />
            <span className="describe-copy"><strong>{item.food.name}</strong><small>{item.amountLabel} · {formatNumber(item.grams, 0)} g · {formatNumber(kcal(item))} kcal</small></span>
            <button className="icon-button quiet" type="button" aria-label={`Remove ${item.food.name}`} onClick={() => setRemoved(new Set([...removed, index]))}><Icon name="x" size={15} /></button>
          </li>
        ))}
      </ul>
      {unmatched.length > 0 && <p className="field-hint">No match for {unmatched.map((item) => `“${item.query}”`).join(', ')}. Search for it below or add it by hand.</p>}
      <button className="button primary describe-add" type="button" disabled={saving || items.length === 0} onClick={() => onAdd(items)}><Icon name="plus" size={16} />{saving ? 'Adding…' : `Add ${items.length} ${items.length === 1 ? 'food' : 'foods'} · ${formatNumber(total)} kcal`}</button>
    </section>
  )
}
