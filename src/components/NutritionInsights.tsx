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

interface ChartPoint {
  date: string
  value: number | null
  entryCount: number
  x: number
  y: number | null
}

interface MetricCardProps {
  metric: MetricKey
  points: DaySummary[]
  goal?: number
  rangeDays: RangeDays
  endDate: string
  loggedDays: number
}

const CHART_WIDTH = 720
const CHART_HEIGHT = 218
const PLOT_LEFT = 46
const PLOT_RIGHT = 17
const PLOT_TOP = 24
const PLOT_BOTTOM = 39

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

const contiguousSegments = (points: ChartPoint[]): ChartPoint[][] => {
  const segments: ChartPoint[][] = []
  let current: ChartPoint[] = []

  points.forEach((point) => {
    if (point.value === null) {
      if (current.length > 0) segments.push(current)
      current = []
      return
    }
    current.push(point)
  })

  if (current.length > 0) segments.push(current)
  return segments
}

function MetricCard({ metric, points, goal, rangeDays, endDate, loggedDays }: MetricCardProps) {
  const instanceId = useId().replace(/:/g, '')
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
  const safeGoal = goal !== undefined && Number.isFinite(goal) ? Math.max(0, goal) : undefined
  const maxValue = Math.max(safeGoal ?? 0, ...loggedValues, 0)
  const scaleMax = niceScaleMax(maxValue)
  const plotWidth = CHART_WIDTH - PLOT_LEFT - PLOT_RIGHT
  const plotHeight = CHART_HEIGHT - PLOT_TOP - PLOT_BOTTOM
  const chartPoints: ChartPoint[] = points.map((point, index) => {
    const value = values[index]
    const x = PLOT_LEFT + (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth)
    const y = value === null ? null : PLOT_TOP + plotHeight - (Math.max(0, value) / scaleMax) * plotHeight
    return { date: point.date, value, entryCount: point.entryCount, x, y }
  })
  const segments = contiguousSegments(chartPoints)
  const goalY = safeGoal === undefined ? null : PLOT_TOP + plotHeight - (safeGoal / scaleMax) * plotHeight
  const firstDate = points[0]?.date ?? shiftDate(endDate, -rangeDays + 1)
  const middleDate = points[Math.floor(Math.max(0, points.length - 1) / 2)]?.date ?? firstDate
  const lastDate = points.at(-1)?.date ?? endDate
  const hasData = loggedDays > 0
  const accessibleSummary = chartPoints
    .map((point) => `${formatShortDate(point.date)}: ${point.value === null ? 'no food logged' : `${metricValue(metric, point.value)} ${unit}`}`)
    .join('. ')

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
        <svg
          aria-describedby={chartDescriptionId}
          aria-labelledby={chartTitleId}
          className="nutrition-chart"
          role="img"
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        >
          <title id={chartTitleId}>{label} over the last {rangeDays} days</title>
          <desc id={chartDescriptionId}>{accessibleSummary}. Empty dates are shown as gaps; a logged day may be partial.</desc>
          {[0, 0.5, 1].map((position) => {
            const y = PLOT_TOP + plotHeight * position
            const labelValue = scaleMax * (1 - position)
            return (
              <g key={position}>
                <line className="nutrition-grid-line" x1={PLOT_LEFT} x2={CHART_WIDTH - PLOT_RIGHT} y1={y} y2={y} />
                {(hasData || safeGoal !== undefined) && <text className="nutrition-y-label" x={PLOT_LEFT - 10} y={y + 3} textAnchor="end">{formatNumber(labelValue, metric === 'protein' ? 1 : 0)}</text>}
              </g>
            )
          })}
          {chartPoints.map((point) => (
            <line
              className={point.value === null ? 'nutrition-slot-empty' : 'nutrition-slot-tick'}
              key={`${point.date}-slot`}
              x1={point.x}
              x2={point.x}
              y1={CHART_HEIGHT - PLOT_BOTTOM}
              y2={CHART_HEIGHT - PLOT_BOTTOM + 5}
            />
          ))}
          {goalY !== null && (
            <g className="nutrition-goal-guide">
              <line x1={PLOT_LEFT} x2={CHART_WIDTH - PLOT_RIGHT} y1={goalY} y2={goalY} />
              <text x={CHART_WIDTH - PLOT_RIGHT - 2} y={goalY - 6} textAnchor="end">Goal</text>
            </g>
          )}
          {segments.map((segment, index) => (
            segment.length > 1 && <polyline className="nutrition-chart-line" key={`segment-${index}`} fill="none" points={segment.map((point) => `${point.x},${point.y}`).join(' ')} />
          ))}
          {chartPoints.map((point) => point.value !== null && point.y !== null && (
            <circle
              className="nutrition-chart-point"
              cx={point.x}
              cy={point.y}
              key={point.date}
              r="5"
              tabIndex={0}
            >
              <title>{formatShortDate(point.date)}: {metricValue(metric, point.value)} {unit}</title>
            </circle>
          ))}
        </svg>
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
          <p className="nutrition-eyebrow">Patterns in your local log</p>
          <h2 id={insightsTitleId}>Nutrition insights</h2>
          <p className="nutrition-description">A compact view of what you have recorded, with quiet gaps where no food was logged.</p>
        </div>
        <div className="nutrition-range-control" role="group" aria-label="Nutrition insight range">
          <span className="nutrition-range-label">Window</span>
          {([7, 30] as const).map((days) => (
            <button aria-pressed={rangeDays === days} className={rangeDays === days ? 'nutrition-is-active' : ''} key={days} onClick={() => setRangeDays(days)} type="button">
              {days} days
            </button>
          ))}
        </div>
      </div>
      <div className="nutrition-insights-context" role="status">
        <span className="nutrition-local-badge"><i aria-hidden="true" />Local data</span>
        <span>{loggedDays} of {rangeDays} days include food entries</span>
        <span>{formatShortDate(rangeStart)} – {formatShortDate(endDate)}</span>
      </div>
      <div className="nutrition-chart-grid">
        <MetricCard metric="calories" points={points} goal={goals?.calories} rangeDays={rangeDays} endDate={endDate} loggedDays={loggedDays} />
        <MetricCard metric="protein" points={points} goal={goals?.protein} rangeDays={rangeDays} endDate={endDate} loggedDays={loggedDays} />
      </div>
    </section>
  )
}
