import { useId, useMemo, useState } from 'react'
import type { DiaryEntry, Goals } from '../types'
import { formatNumber, formatShortDate, shiftDate, todayISO } from '../lib/utils'
import './nutrition-insights.css'

type RangeDays = 7 | 30
type MetricKey = 'calories' | 'protein'

interface NutritionInsightsProps {
  entries: DiaryEntry[]
  goals?: Goals
}

interface DaySummary {
  date: string
  entryCount: number
  calories: number
  protein: number
}

interface MetricCardProps {
  metric: MetricKey
  points: DaySummary[]
  goal?: number
  rangeDays: RangeDays
  endDate: string
  loggedDays: number
}

const numericValue = (value: number): number => (Number.isFinite(value) ? value : 0)

const metricLabel = (metric: MetricKey): string => (metric === 'calories' ? 'Energy' : 'Protein')

const metricUnit = (metric: MetricKey): string => (metric === 'calories' ? 'kcal' : 'g')

const metricColorClass = (metric: MetricKey): string => (metric === 'calories' ? 'energy' : 'protein')

const metricValue = (metric: MetricKey, value: number | null): string => {
  if (value === null) return '—'
  return formatNumber(value, metric === 'protein' ? 1 : 0)
}

const niceScaleMax = (value: number): number => {
  const safeValue = Math.max(1, value)
  const magnitude = 10 ** Math.floor(Math.log10(safeValue))
  return Math.ceil(safeValue / magnitude) * magnitude
}

const buildDays = (entries: DiaryEntry[], rangeDays: RangeDays, endDate: string): DaySummary[] => {
  const days = Array.from({ length: rangeDays }, (_, index) => shiftDate(endDate, index - rangeDays + 1))
  const byDate = new Map<string, DaySummary>(
    days.map((date) => [date, { date, entryCount: 0, calories: 0, protein: 0 }]),
  )

  entries.forEach((entry) => {
    const day = byDate.get(entry.date)
    if (!day) return
    day.entryCount += 1
    day.calories += numericValue(entry.calories)
    day.protein += numericValue(entry.protein)
  })

  return days.map((date) => byDate.get(date) as DaySummary)
}

function MetricCard({ metric, points, goal, rangeDays, endDate, loggedDays }: MetricCardProps) {
  const instanceId = useId().replace(/:/g, '')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const label = metricLabel(metric)
  const unit = metricUnit(metric)
  const colorClass = metricColorClass(metric)
  const titleId = `${instanceId}-${metric}-title`
  const chartTitleId = `${instanceId}-${metric}-chart-title`
  const chartDescriptionId = `${instanceId}-${metric}-chart-description`
  const valueKey = metric === 'calories' ? 'calories' : 'protein'
  const values = points.map((point) => (point.entryCount > 0 ? point[valueKey] : null))
  const loggedValues = values.filter((value): value is number => value !== null)
  const average = loggedValues.length > 0 ? loggedValues.reduce((sum, value) => sum + value, 0) / loggedValues.length : null
  const safeGoal = goal !== undefined && Number.isFinite(goal) && goal > 0 ? goal : undefined
  const maxValue = Math.max(safeGoal ?? 0, ...loggedValues, 0)
  const scaleMax = niceScaleMax(maxValue)
  const goalPercent = safeGoal === undefined ? null : Math.min(100, (safeGoal / scaleMax) * 100)
  const firstDate = points[0]?.date ?? shiftDate(endDate, -rangeDays + 1)
  const middleDate = points[Math.floor(Math.max(0, points.length - 1) / 2)]?.date ?? firstDate
  const lastDate = points.at(-1)?.date ?? endDate
  const hasData = loggedDays > 0
  const accessibleSummary = points
    .map((point, index) => `${formatShortDate(point.date)}: ${values[index] === null ? 'no food logged' : `${metricValue(metric, values[index])} ${unit}`}`)
    .join('. ')
  const selectedIndex = points.findIndex((point) => point.date === selectedDate)
  const readout = selectedIndex === -1
    ? 'Tap or hover a bar for that day’s value.'
    : `${formatShortDate(points[selectedIndex].date)} · ${values[selectedIndex] === null ? 'No food logged' : `${metricValue(metric, values[selectedIndex])} ${unit}`}`

  return (
    <section className={`nutrition-card nutrition-card-${colorClass}`} aria-labelledby={titleId}>
      <header className="nutrition-card-header">
        <div className="nutrition-card-title">
          <span className="nutrition-metric-mark" aria-hidden="true" />
          <div>
            <p className="nutrition-eyebrow">{label}</p>
            <h3 id={titleId}>Daily {label.toLowerCase()}</h3>
          </div>
        </div>
        <div className="nutrition-card-average">
          <strong>{metricValue(metric, average)}</strong>
          <span>average {unit}</span>
        </div>
      </header>

      <div className="nutrition-card-meta">
        <span>{hasData ? `${loggedDays} of ${rangeDays} days with food logged` : `No food logged in the last ${rangeDays} days`}</span>
        {safeGoal !== undefined && <span className="nutrition-goal-key"><i aria-hidden="true" />Goal {metricValue(metric, safeGoal)} {unit}</span>}
      </div>

      <div className="nutrition-chart-shell">
        <p className={`nutrition-readout ${selectedIndex === -1 ? 'hint' : ''}`} aria-hidden="true">{readout}</p>
        <div
          aria-describedby={chartDescriptionId}
          aria-labelledby={chartTitleId}
          className={`bar-plot bar-plot-${rangeDays}`}
          role="img"
        >
          <span hidden id={chartTitleId}>{label} over the last {rangeDays} days</span>
          <span hidden id={chartDescriptionId}>{accessibleSummary}. Empty dates are shown as gaps; a logged day may be partial.</span>
          {goalPercent !== null && <div className="bar-goal" style={{ bottom: `${goalPercent}%` }}><span>Goal</span></div>}
          {points.map((point, index) => {
            const value = values[index]
            const height = value === null ? 0 : Math.max(2, (Math.max(0, value) / scaleMax) * 100)
            return (
              <span
                className={`bar-col ${point.date === selectedDate ? 'selected' : ''}`}
                key={point.date}
                onClick={() => setSelectedDate(point.date)}
                onPointerEnter={() => setSelectedDate(point.date)}
                title={`${formatShortDate(point.date)}: ${value === null ? 'no food logged' : `${metricValue(metric, value)} ${unit}`}`}
              >
                <span className={`bar ${value === null ? 'empty' : ''}`} style={value === null ? undefined : { height: `${height}%` }} />
              </span>
            )
          })}
        </div>
        <div className="nutrition-chart-axis" aria-hidden="true">
          <span>{formatShortDate(firstDate)}</span>
          <span>{formatShortDate(middleDate)}</span>
          <span>{formatShortDate(lastDate)}</span>
        </div>
      </div>

      <p className="nutrition-card-note">
        {hasData ? 'Average uses logged days only.' : 'Start logging food to see your pattern here.'}
        <span>A logged day may be partial.</span>
      </p>

      <details className="nutrition-details">
        <summary>View daily values</summary>
        <div className="nutrition-table-wrap">
          <table>
            <caption>{label} day-by-day values for the last {rangeDays} days</caption>
            <thead><tr><th scope="col">Date</th><th scope="col">{label}</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {points.map((point) => {
                const value = point.entryCount > 0 ? point[valueKey] : null
                return (
                  <tr key={point.date}>
                    <th scope="row">{formatShortDate(point.date)}</th>
                    <td>{metricValue(metric, value)}{value !== null && <small> {unit}</small>}</td>
                    <td>{point.entryCount > 0 ? `${point.entryCount} ${point.entryCount === 1 ? 'entry' : 'entries'}` : 'No food logged'}</td>
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

export default function NutritionInsights({ entries, goals }: NutritionInsightsProps): JSX.Element {
  const [rangeDays, setRangeDays] = useState<RangeDays>(7)
  const instanceId = useId().replace(/:/g, '')
  const insightsTitleId = `nutrition-insights-${instanceId}`
  const endDate = todayISO()
  const points = useMemo(() => buildDays(entries, rangeDays, endDate), [entries, endDate, rangeDays])
  const loggedDays = points.filter((point) => point.entryCount > 0).length
  const rangeStart = points[0]?.date ?? shiftDate(endDate, -rangeDays + 1)

  return (
    <section className="nutrition-insights" aria-labelledby={insightsTitleId}>
      <div className="nutrition-insights-header">
        <div>
          <h2 id={insightsTitleId}>Nutrition insights</h2>
          <p className="nutrition-insights-context" role="status">
            {loggedDays} of {rangeDays} days logged · {formatShortDate(rangeStart)} – {formatShortDate(endDate)}
          </p>
        </div>
        <div className="nutrition-range-control" role="group" aria-label="Nutrition insight range">
          {([7, 30] as const).map((days) => (
            <button aria-pressed={rangeDays === days} className={rangeDays === days ? 'nutrition-is-active' : ''} key={days} onClick={() => setRangeDays(days)} type="button">
              {days} days
            </button>
          ))}
        </div>
      </div>
      <div className="nutrition-chart-grid">
        <MetricCard metric="calories" points={points} goal={goals?.calories} rangeDays={rangeDays} endDate={endDate} loggedDays={loggedDays} />
        <MetricCard metric="protein" points={points} goal={goals?.protein} rangeDays={rangeDays} endDate={endDate} loggedDays={loggedDays} />
      </div>
    </section>
  )
}
