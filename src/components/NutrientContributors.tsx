import { useMemo, useState } from 'react'
import type { DiaryEntry, Goals } from '../types'
import { averageOnRecordedDays, CONTRIBUTOR_METRICS, goalFor, summarizeNutrient, type ContributorMetric, type ContributorRange } from '../lib/contributors'
import { recordedAverages } from '../lib/nutrientTrends'
import { formatNumber, todayISO } from '../lib/utils'

interface NutrientContributorsProps {
  entries: DiaryEntry[]
  goals?: Goals
  /** When the parent picks the nutrient (the Trends nutrients card), it drives the selector; otherwise the panel keeps its own. */
  metric?: ContributorMetric
  onMetricChange?: (metric: ContributorMetric) => void
  /** Range chosen in the parent, with its setter, so the card and this view stay on one range. */
  range?: ContributorRange
  onRangeChange?: (range: ContributorRange) => void
}

const RANGES: ContributorRange[] = [7, 30, 90]
const mealLabel: Record<string, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks', other: 'Other' }

/** What drove a nutrient: the average per logged day, the foods that contributed most, and when it was eaten. */
export function NutrientContributors({ entries, goals, metric: givenMetric, onMetricChange, range: givenRange, onRangeChange }: NutrientContributorsProps) {
  const [ownRange, setOwnRange] = useState<ContributorRange>(30)
  const [ownMetric, setOwnMetric] = useState<ContributorMetric>('calories')
  const range = givenRange ?? ownRange
  const metric = givenMetric ?? ownMetric
  const setRange = (next: ContributorRange) => { setOwnRange(next); onRangeChange?.(next) }
  const setMetric = (next: ContributorMetric) => { setOwnMetric(next); onMetricChange?.(next) }
  const endDate = todayISO()
  const info = CONTRIBUTOR_METRICS.find((item) => item.key === metric) ?? CONTRIBUTOR_METRICS[0]
  const summary = useMemo(() => summarizeNutrient(entries, metric, endDate, range), [entries, metric, endDate, range])
  // The every-nutrient table is only worked out while it is open, in one pass over the range.
  const [tableOpen, setTableOpen] = useState(false)
  const averages = useMemo(() => (tableOpen ? recordedAverages(entries, endDate, range) : undefined), [tableOpen, entries, endDate, range])
  const goal = goalFor(goals, metric)
  const fmt = (value: number) => formatNumber(value, info.digits)
  const average = averageOnRecordedDays(summary)

  return (
    <section className="panel contributors-panel" aria-labelledby="contributors-heading">
      <div className="panel-header">
        <div><h2 id="contributors-heading">Nutrient contributors</h2></div>
        <div className="range-toggle" role="group" aria-label="Contributor range">
          {RANGES.map((days) => <button aria-label={`Contributors, last ${days} days`} aria-pressed={range === days} className={range === days ? 'active' : ''} key={days} type="button" onClick={() => setRange(days)}>{days}d</button>)}
        </div>
      </div>
      <div className="form-field full">
        <label htmlFor="contributor-metric">Nutrient</label>
        <select id="contributor-metric" value={metric} onChange={(event) => setMetric(event.target.value as ContributorMetric)}>
          {CONTRIBUTOR_METRICS.map((item) => <option key={item.key} value={item.key}>{item.label} ({item.unit})</option>)}
        </select>
      </div>

      {average === undefined ? (
        <p className="muted-footnote">{summary.loggedDays === 0 ? `No food logged in the last ${range} days.` : `None of the foods logged in the last ${range} days recorded ${info.label.toLowerCase()}.`}</p>
      ) : (
        <>
          <p className="contributor-average">{fmt(average)} <small>{info.unit} per logged day</small></p>
          <p className="metric-subtext">
            {goal !== undefined ? `Goal ${formatNumber(goal)} ${info.unit}. ` : ''}{summary.recordedDays < summary.loggedDays ? `Based on ${summary.recordedDays} of ${summary.loggedDays} logged days.` : `Over ${summary.loggedDays} logged ${summary.loggedDays === 1 ? 'day' : 'days'}.`}
            {summary.recordedFoods < summary.foods ? ` Counts the ${summary.recordedFoods} of ${summary.foods} foods that recorded ${info.label.toLowerCase()}.` : ''}
          </p>
          <div className="contributor-list" aria-label={`Top sources of ${info.label.toLowerCase()}`}>
            {summary.top.map((item) => (
              <div className="contributor-row" key={item.name}>
                <div className="contributor-top"><span>{item.name}</span><strong>{Math.round(item.share * 100)}%</strong></div>
                <div className="progress-track" aria-hidden="true"><span className="progress-fill protein" style={{ width: `${Math.max(2, item.share * 100)}%` }} /></div>
              </div>
            ))}
          </div>
          {summary.byMeal.length > 0 && (
            <div className="stat-list">
              {summary.byMeal.map((item) => <div className="stat-row" key={item.meal}><span>{mealLabel[item.meal]}</span><strong>{Math.round(item.share * 100)}%</strong></div>)}
            </div>
          )}
        </>
      )}

      <details className="nutrition-details" onToggle={(event) => setTableOpen(event.currentTarget.open)}>
        <summary>Averages for every nutrient</summary>
        <div className="nutrition-table-wrap">
          <table>
            <caption>Average per logged day over the last {range} days</caption>
            <thead><tr><th scope="col">Nutrient</th><th scope="col">Average</th><th scope="col">Goal</th></tr></thead>
            <tbody>
              {averages && CONTRIBUTOR_METRICS.map((item) => {
                const rowGoal = goalFor(goals, item.key)
                const rowAverage = averages.get(item.key)
                return (
                  <tr key={item.key}>
                    <th scope="row">{item.label}</th>
                    <td>{rowAverage === undefined ? '—' : <>{formatNumber(rowAverage, item.digits)}<small> {item.unit}</small></>}</td>
                    <td>{rowGoal === undefined ? '—' : <>{formatNumber(rowGoal)}<small> {item.unit}</small></>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}
