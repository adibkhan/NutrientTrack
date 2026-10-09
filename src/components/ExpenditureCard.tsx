import { useMemo } from 'react'
import type { DiaryEntry, WeightEntry } from '../types'
import { estimateExpenditure } from '../lib/expenditure'
import { LB_PER_KG } from '../lib/trend'
import { formatNumber, shiftDate, todayISO } from '../lib/utils'

interface ExpenditureCardProps {
  entries: DiaryEntry[]
  weights: WeightEntry[]
  unit: 'lb' | 'kg'
}

const confidenceLabel = { low: 'Low confidence', medium: 'Medium confidence', high: 'High confidence' } as const

export function ExpenditureCard({ entries, weights, unit }: ExpenditureCardProps) {
  const today = todayISO()
  // Through yesterday: today is not finished, so it must not count as a light day.
  const estimate = useMemo(() => estimateExpenditure(entries, weights, shiftDate(today, -1)), [entries, weights, today])
  const change = estimate.kind === 'ok' ? (unit === 'kg' ? estimate.trendChangeLb / LB_PER_KG : estimate.trendChangeLb) : 0
  const signed = (value: number, digits: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatNumber(Math.abs(value), digits)}`
  return (
    <section className="panel expenditure-card" aria-labelledby="expenditure-heading">
      <div className="panel-header">
        <div><h2 id="expenditure-heading">Expenditure</h2></div>
        {estimate.kind === 'ok' && <span className={`summary-badge confidence-${estimate.confidence}`}>{confidenceLabel[estimate.confidence]}</span>}
      </div>
      {estimate.kind === 'ok' ? (
        <>
          <p className="metric-value">{formatNumber(estimate.kcalPerDay)} <small>kcal / day</small></p>
          <p className="metric-subtext">Inferred from {estimate.loggedDays} logged days and {estimate.weighIns} weigh-ins in the last {estimate.windowDays} days. Steps and watch calories are not used.</p>
          <div className="stat-list">
            <div className="stat-row"><span>Average intake</span><strong>{formatNumber(estimate.avgIntake)} kcal</strong></div>
            <div className="stat-row"><span>Trend change</span><strong>{signed(change, 1)} {unit}</strong></div>
            <div className="stat-row"><span>Implied balance</span><strong>{signed(estimate.impliedBalance, 0)} kcal / day</strong></div>
          </div>
        </>
      ) : (
        <>
          <p className="metric-value">Not enough data yet</p>
          <p className="metric-subtext">{estimate.reason}</p>
          <div className="stat-list">
            <div className="stat-row"><span>Days with food logged</span><strong>{estimate.loggedDays} of 28</strong></div>
            <div className="stat-row"><span>Weigh-ins</span><strong>{estimate.weighIns}</strong></div>
          </div>
        </>
      )}
    </section>
  )
}
