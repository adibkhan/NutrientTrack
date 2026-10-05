import type { CheckIn } from '../lib/program'
import { formatNumber, formatShortDate } from '../lib/utils'
import { Icon } from './Icon'

interface CheckInCardProps {
  checkIn: CheckIn
  onAccept: () => Promise<void>
  onKeep: () => Promise<void>
}

const signed = (value: number, digits = 1) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatNumber(Math.abs(value), digits)}`

export function CheckInCard({ checkIn, onAccept, onKeep }: CheckInCardProps) {
  const { newBudget, currentBudget } = checkIn
  const changes = newBudget !== undefined && newBudget.calories !== currentBudget
  return (
    <section className="panel checkin-card" aria-labelledby="checkin-heading">
      <div className="panel-header"><div><h2 id="checkin-heading">Weekly check-in</h2></div><span className="summary-badge">Week ending {formatShortDate(checkIn.weekEnding)}</span></div>
      <p className="checkin-headline">{checkIn.headline}</p>
      <div className="stat-grid">
        <div><span>Trend change</span><strong>{checkIn.trendChange === undefined ? '—' : `${signed(checkIn.trendChange)} ${checkIn.unit}`}</strong></div>
        <div><span>Average intake</span><strong>{checkIn.avgIntake === undefined ? '—' : `${formatNumber(checkIn.avgIntake)} kcal`}</strong></div>
        <div><span>Expenditure</span><strong>{checkIn.expenditure.kind === 'ok' ? `${formatNumber(checkIn.expenditure.kcalPerDay)} kcal` : '—'}</strong></div>
        <div><span>Days logged</span><strong>{checkIn.daysLogged} / 7</strong></div>
      </div>
      {newBudget && (
        <div className="stat-list">
          <div className="stat-row"><span>Current budget</span><strong>{currentBudget === undefined ? 'Not set' : `${formatNumber(currentBudget)} kcal`}</strong></div>
          <div className="stat-row"><span>New budget</span><strong className="accent-text">{formatNumber(newBudget.calories)} kcal</strong></div>
          {newBudget.protein !== undefined && <div className="stat-row"><span>Protein / carbs / fat</span><strong>{newBudget.protein} / {newBudget.carbs} / {newBudget.fat} g</strong></div>}
        </div>
      )}
      {newBudget?.floored && <p className="field-hint warn">This week's rate would go below the 1,200 kcal safety floor, so the new budget is held there.</p>}
      <div className="checkin-actions">
        <button className="button secondary" type="button" onClick={() => { void onKeep() }}>Keep current budget</button>
        <button className="button primary" type="button" disabled={!newBudget || !changes} onClick={() => { void onAccept() }}><Icon name="check" size={16} />Accept new budget</button>
      </div>
    </section>
  )
}
