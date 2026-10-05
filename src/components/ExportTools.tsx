import type { DiaryEntry, Food, WeightEntry } from '../types'
import { downloadTextFile, entriesCsv, foodsCsv, weightsCsv } from '../lib/csv'
import { todayISO } from '../lib/utils'
import { Icon } from './Icon'

interface ExportToolsProps {
  entries: DiaryEntry[]
  foods: Food[]
  weights: WeightEntry[]
  onExported: (message: string) => void
}

export function ExportTools({ entries, foods, weights, onExported }: ExportToolsProps) {
  const stamp = todayISO()
  const files = [
    { label: 'Food diary', count: entries.length, file: `nutrienttrack-diary-${stamp}.csv`, build: () => entriesCsv(entries) },
    { label: 'Weight log', count: weights.length, file: `nutrienttrack-weights-${stamp}.csv`, build: () => weightsCsv(weights) },
    { label: 'Saved foods', count: foods.length, file: `nutrienttrack-foods-${stamp}.csv`, build: () => foodsCsv(foods) },
  ]
  return (
    <section className="panel" aria-labelledby="export-heading">
      <div className="panel-header"><div><h2 id="export-heading">Export spreadsheets</h2></div></div>
      <p className="panel-copy">Download your data as CSV files that open in Excel, Numbers or Google Sheets. The JSON backup above is the one to use for restoring.</p>
      <div className="data-tools">
        {files.map((item) => (
          <div className="tool-row" key={item.label}>
            <div><strong>{item.label}</strong><p>{item.count === 0 ? 'Nothing here yet.' : `${item.count} ${item.count === 1 ? 'row' : 'rows'}`}</p></div>
            <button className="button secondary compact" disabled={item.count === 0} type="button" onClick={() => { downloadTextFile(item.file, item.build()); onExported(`${item.label} exported as CSV.`) }}>
              <Icon name="download" size={15} />CSV
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
