import type { DiaryEntry } from '../types'
import { NUTRIENTS, sumNutrients, type NutrientKey } from '../lib/nutrients'
import { percentOfDv } from '../lib/nutrientTrends'
import { formatNumber, todayISO } from '../lib/utils'

/** The few nutrients worth a glance each day, most useful first. */
export const DAY_NUTRIENT_KEYS: NutrientKey[] = ['fiber', 'sodium', 'potassium', 'calcium', 'iron', 'vitaminD']

/** A compact "Nutrients today" disclosure under the day summary. Hidden when no food that day recorded any of them. */
export default function DayNutrients({ date, entries }: { date: string; entries: DiaryEntry[] }) {
  const totals = sumNutrients(entries)
  const rows = DAY_NUTRIENT_KEYS.flatMap((key) => {
    const total = totals[key]
    const info = NUTRIENTS.find((nutrient) => nutrient.key === key)
    return total && info ? [{ info, total: total.total, foods: total.foods }] : []
  })
  if (rows.length === 0) return null
  const eaten = entries.filter((entry) => !entry.planned).length
  return (
    <details className="day-nutrients">
      <summary>{date === todayISO() ? 'Nutrients today' : 'Nutrients'}</summary>
      <ul className="day-nutrient-list">
        {rows.map(({ info, total, foods }) => {
          const share = info.dv === undefined ? undefined : total / info.dv
          const over = info.kind === 'limit' && share !== undefined && share > 1
          return (
            <li key={info.key}>
              <span className="day-nutrient-top"><span>{info.label}</span><strong>{formatNumber(total, info.decimals)} {info.unit}{info.dv !== undefined ? <small> · {percentOfDv(total, info.dv)}%</small> : null}</strong></span>
              {share !== undefined && <span className="progress-track day-nutrient-bar" aria-hidden="true"><span className={`progress-fill ${over ? 'over' : 'protein'}`} style={{ width: `${Math.min(100, Math.max(share > 0 ? 2 : 0, share * 100))}%` }} /></span>}
              {foods < eaten && <small className="day-nutrient-note">{foods} of {eaten} foods recorded this</small>}
            </li>
          )
        })}
      </ul>
      <p className="muted-footnote">Percent of the FDA Daily Value. Counts only foods that recorded each nutrient.</p>
    </details>
  )
}
