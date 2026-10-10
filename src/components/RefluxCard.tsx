import type { DiaryEntry, Symptom } from '../types'
import { MIN_FLARES_FOR_PATTERNS, refluxReport } from '../lib/reflux'
import { Icon } from './Icon'

interface RefluxCardProps {
  entries: DiaryEntry[]
  symptoms: Symptom[]
  today: string
}

const PERIODS: Array<{ key: 'morning' | 'afternoon' | 'evening' | 'night'; label: string }> = [
  { key: 'morning', label: 'Morning' },
  { key: 'afternoon', label: 'Afternoon' },
  { key: 'evening', label: 'Evening' },
  { key: 'night', label: 'Night' },
]

const percent = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 100))

/**
 * The trigger finder: which common reflux triggers were eaten in the hours before this person's own flares more often
 * than on their ordinary days. It waits for enough flares to say anything, and says "came before", never "caused".
 */
export function RefluxCard({ entries, symptoms, today }: RefluxCardProps) {
  const report = refluxReport(entries, symptoms, today)
  const peak = PERIODS.reduce((best, period) => (report.byPeriod[period.key] > report.byPeriod[best.key] ? period : best), PERIODS[0])
  return (
    <section className="panel reflux-panel" aria-label="Heartburn over the last 30 days">
      <div className="panel-header"><div><h2>Heartburn</h2><p className="muted-footnote reflux-window">Last {report.days} days</p></div><span className="summary-badge">{report.flares} {report.flares === 1 ? 'flare' : 'flares'}</span></div>
      {report.flares === 0 ? (
        <p className="muted-footnote">No heartburn logged. When it strikes, tap “Log heartburn” under the water line on the diary and Pip will start looking for patterns in what came before.</p>
      ) : (
        <>
          <div className="reflux-periods" aria-label="Flares by time of day">
            {PERIODS.map((period) => <div className={`reflux-period ${report.byPeriod[period.key] > 0 && period.key === peak.key ? 'is-peak' : ''}`} key={period.key}><strong>{report.byPeriod[period.key]}</strong><span>{period.label}</span></div>)}
          </div>
          {!report.enough ? (
            <p className="muted-footnote">Patterns show after {MIN_FLARES_FOR_PATTERNS} flares and a week of logged food. {report.flares < MIN_FLARES_FOR_PATTERNS ? `${MIN_FLARES_FOR_PATTERNS - report.flares} more ${MIN_FLARES_FOR_PATTERNS - report.flares === 1 ? 'flare' : 'flares'} to go.` : 'Keep logging what you eat.'}</p>
          ) : report.findings.length === 0 ? (
            <p className="muted-footnote">None of the common triggers shows up before your flares more than on ordinary days. Timing may matter more than food: {report.byPeriod[peak.key]} of {report.flares} came in the {peak.label.toLowerCase()}.</p>
          ) : (
            <ul className="reflux-findings">
              {report.findings.map((finding) => (
                <li key={finding.label}>
                  <Icon name="flame" size={16} className="reflux-finding-icon" />
                  <div>
                    <strong>{finding.label[0].toUpperCase() + finding.label.slice(1)}</strong> came before {finding.flaresWithTrigger} of {finding.flares} flares
                    <small>You have it on {percent(finding.daysWithTrigger, finding.loggedDays)}% of logged days</small>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="muted-footnote">A pattern in your own log, not a diagnosis. Worth mentioning to your doctor.</p>
        </>
      )}
    </section>
  )
}
