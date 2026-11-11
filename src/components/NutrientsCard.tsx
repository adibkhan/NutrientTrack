import { useMemo, useState } from 'react'
import type { DiaryEntry } from '../types'
import type { ContributorMetric, ContributorRange } from '../lib/contributors'
import { coverageNote, MIN_DAY_KCAL, MIN_RECORDED_DAYS, MIN_RECORDED_SHARE, percentOfDv, summarizeNutrientTrends, type NutrientTrendRow } from '../lib/nutrientTrends'
import { formatNumber, todayISO } from '../lib/utils'

interface NutrientsCardProps {
  entries: DiaryEntry[]
  range: ContributorRange
  onRangeChange: (range: ContributorRange) => void
  /** Open the top sources of a nutrient. */
  onSelect: (metric: ContributorMetric) => void
}

const RANGES: ContributorRange[] = [7, 30, 90]
/** "Aim for" shows the biggest shortfalls first and folds the rest behind a button. */
const AIM_ROWS_SHOWN = 8

function Row({ row, onSelect }: { row: NutrientTrendRow; onSelect: (metric: ContributorMetric) => void }) {
  const { info, average, share } = row
  const percent = share === undefined || info.dv === undefined ? undefined : percentOfDv(average, info.dv)
  const over = info.kind === 'limit' && share !== undefined && share > 1
  const note = coverageNote(row)
  const amount = `${formatNumber(average, info.decimals)} ${info.unit}`
  return (
    <li>
      <button className={`nutrient-row${row.thin ? ' thin' : ''}`} type="button" aria-label={`${info.label}, ${amount} per logged day${percent !== undefined ? `, ${percent}% of daily value` : ''}. Show top sources.`} onClick={() => onSelect(info.key)}>
        <span className="nutrient-row-top"><span className="nutrient-row-name">{info.label}</span><strong>{percent !== undefined ? `${percent}%` : amount}</strong></span>
        {share !== undefined && <span className="progress-track nutrient-row-bar" aria-hidden="true"><span className={`progress-fill ${over ? 'over' : 'protein'}`} style={{ width: `${Math.min(100, Math.max(share > 0 ? 2 : 0, share * 100))}%` }} /></span>}
        <span className="nutrient-row-sub">{share !== undefined && info.dv !== undefined ? `${amount} of ${formatNumber(info.dv, info.dv < 10 ? 1 : 0)} ${info.unit}` : 'No daily value'}{row.thin ? ' · Not enough data yet' : ''}{note ? ` · ${note}` : ''}</span>
      </button>
    </li>
  )
}

/** Average of each nutrient per logged day against its FDA Daily Value, biggest shortfalls and overages first. Tap a row for its top sources. */
export default function NutrientsCard({ entries, range, onRangeChange, onSelect }: NutrientsCardProps) {
  const endDate = todayISO()
  const [showAllAim, setShowAllAim] = useState(false)
  const trends = useMemo(() => summarizeNutrientTrends(entries, endDate, range), [entries, endDate, range])
  const hasRows = trends.aim.length + trends.limit.length + trends.other.length > 0
  return (
    <section className="panel nutrients-card" aria-labelledby="nutrients-card-heading">
      <div className="panel-header">
        <div><h2 id="nutrients-card-heading">Nutrients</h2></div>
        <div className="range-toggle" role="group" aria-label="Nutrients range">
          {RANGES.map((days) => <button aria-label={`Nutrients, last ${days} days`} aria-pressed={range === days} className={range === days ? 'active' : ''} key={days} type="button" onClick={() => onRangeChange(days)}>{days}d</button>)}
        </div>
      </div>
      {!hasRows ? (
        <p className="muted-footnote">{trends.loggedDays === 0 ? `No food logged in the last ${range} days.` : 'Not enough data yet. Foods from the USDA catalog record vitamins and minerals; manual and older entries may not.'}</p>
      ) : (
        <>
          <p className="metric-subtext">Average per fully recorded day against the FDA Daily Value.</p>
          {trends.notEnoughYet && <p className="metric-subtext nutrient-thin-note" role="status">Not enough data yet. Averages firm up after a few days of logging foods with nutrients.</p>}
          {trends.aim.length > 0 && (
            <>
              <h3 className="nutrient-list-title">Aim for</h3>
              <ul className="nutrient-list" aria-label="Nutrients to aim for">{(showAllAim ? trends.aim : trends.aim.slice(0, AIM_ROWS_SHOWN)).map((row) => <Row key={row.info.key} row={row} onSelect={onSelect} />)}</ul>
              {trends.aim.length > AIM_ROWS_SHOWN && <button className="text-button show-all" type="button" aria-expanded={showAllAim} onClick={() => setShowAllAim(!showAllAim)}>{showAllAim ? 'Show fewer' : `Show all ${trends.aim.length}`}</button>}
            </>
          )}
          {trends.limit.length > 0 && <><h3 className="nutrient-list-title">Keep under</h3><ul className="nutrient-list" aria-label="Nutrients to keep under">{trends.limit.map((row) => <Row key={row.info.key} row={row} onSelect={onSelect} />)}</ul></>}
          {trends.other.length > 0 && <details className="nutrition-details"><summary>Without a daily value</summary><ul className="nutrient-list" aria-label="Nutrients without a daily value">{trends.other.map((row) => <Row key={row.info.key} row={row} onSelect={onSelect} />)}</ul></details>}
          <p className="muted-footnote">A day counts toward a nutrient only when foods that recorded it make up at least {Math.round(MIN_RECORDED_SHARE * 100)}% of that day's calories, and days under {MIN_DAY_KCAL} kcal are left out{trends.skippedDays > 0 ? ` (${trends.skippedDays} ${trends.skippedDays === 1 ? 'day' : 'days'} here)` : ''}. A nutrient needs {MIN_RECORDED_DAYS} such days before its average is more than a hint.</p>
        </>
      )}
    </section>
  )
}
