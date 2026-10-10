import { useRef, useState } from 'react'
import { FORMAT_SOURCE, NEEDS_WEIGHT_UNIT, parseImport, SOURCE_LABELS, type ImportFormat, type ImportedEntry, type ImportedWeight } from '../lib/importers'
import { formatShortDate } from '../lib/utils'
import { Icon } from './Icon'

interface ParsedFile {
  name: string
  text: string
  format?: ImportFormat
}

interface ImportPanelProps {
  defaultUnit: 'lb' | 'kg'
  /** Saves what was read; resolves with how many entries and weigh-ins were new. */
  onImport: (entries: ImportedEntry[], weights: ImportedWeight[]) => Promise<{ entries: number; weights: number }>
}

const FORMAT_LABELS: Record<ImportFormat, [string, string]> = {
  'mfp-nutrition': ['meal total', 'meal totals'], 'mfp-measurements': ['weigh-in', 'weigh-ins'], 'cronometer-servings': ['food', 'foods'], 'cronometer-biometrics': ['weigh-in', 'weigh-ins'],
  'loseit-food': ['food', 'foods'], 'loseit-weights': ['weigh-in', 'weigh-ins'], 'macrofactor-food': ['food', 'foods'],
}
const counted = (count: number, [one, many]: [string, string]) => `${count} ${count === 1 ? one : many}`

/** Bring a diary over from another tracker. Files are read on this device and never uploaded. */
export function ImportPanel({ defaultUnit, onImport }: ImportPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<ParsedFile[]>([])
  const [unit, setUnit] = useState<'lb' | 'kg'>(defaultUnit)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')

  const parsed = files.map((file) => ({ file, data: parseImport(file.text, unit) }))
  const entries = parsed.flatMap(({ data }) => data?.entries ?? [])
  const weights = parsed.flatMap(({ data }) => data?.weights ?? [])
  const needsUnit = parsed.some(({ data }) => data && NEEDS_WEIGHT_UNIT.includes(data.format) && data.weights.length > 0)
  const dates = [...entries, ...weights].map((item) => item.date).sort()

  const choose = async (list: FileList | null) => {
    setResult('')
    if (!list) return
    const read = await Promise.all([...list].slice(0, 10).map(async (file) => ({ name: file.name, text: file.size > 30_000_000 ? '' : await file.text() })))
    setFiles(read)
  }

  const run = async () => {
    setBusy(true)
    try {
      const saved = await onImport(entries, weights)
      setResult(`Imported ${saved.entries} ${saved.entries === 1 ? 'entry' : 'entries'} and ${saved.weights} ${saved.weights === 1 ? 'weigh-in' : 'weigh-ins'}.${saved.entries < entries.length || saved.weights < weights.length ? ' Anything already here was skipped.' : ''}`)
      setFiles([])
      if (inputRef.current) inputRef.current.value = ''
    } catch {
      setResult('The import could not be saved. Nothing was changed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel import-panel" aria-labelledby="import-heading">
      <div className="panel-header"><div><h2 id="import-heading">Import from another app</h2></div><span className="summary-badge">On this device</span></div>
      <p className="page-description">Bring your history from MyFitnessPal, Cronometer, Lose It! or MacroFactor. Choose their CSV export files; they are read here and never uploaded.</p>
      <details className="import-help">
        <summary>Which files do I need?</summary>
        <ul>
          <li><strong>MyFitnessPal</strong>: Nutrition-Summary and Measurement-Summary CSVs from the export zip. It holds meal totals, so each meal comes in as one entry.</li>
          <li><strong>Cronometer</strong>: servings.csv (Export Food &amp; Recipe Entries) and biometrics.csv.</li>
          <li><strong>Lose It!</strong>: food-logs.csv and weights.csv from the data export zip.</li>
          <li><strong>MacroFactor</strong>: the Food Log CSV from a granular export.</li>
        </ul>
      </details>
      <label className="button secondary import-choose" htmlFor="import-files"><Icon name="upload" size={16} />Choose CSV files</label>
      <input ref={inputRef} id="import-files" className="visually-hidden" type="file" accept=".csv,text/csv" multiple onChange={(event) => { void choose(event.target.files) }} />
      {parsed.length > 0 && (
        <div className="import-summary" aria-live="polite">
          <ul>
            {parsed.map(({ file, data }) => <li key={file.name} className={data ? '' : 'unknown'}>
              <Icon name={data ? 'check' : 'info'} size={15} />
              <span><strong>{file.name}</strong>{data
                ? <small>{SOURCE_LABELS[FORMAT_SOURCE[data.format]]} · {counted(data.entries.length || data.weights.length, FORMAT_LABELS[data.format])}{data.skipped ? ` · ${data.skipped} skipped` : ''}</small>
                : <small>Not a file we recognize. Choose one of the CSVs listed above.</small>}</span>
            </li>)}
          </ul>
          {needsUnit && <div className="form-field full"><label htmlFor="import-unit">Weights in those files are in</label><select id="import-unit" value={unit} onChange={(event) => setUnit(event.target.value as 'lb' | 'kg')}><option value="lb">Pounds (lb)</option><option value="kg">Kilograms (kg)</option></select></div>}
          {dates.length > 0 && <p className="field-hint">{dates[0] === dates[dates.length - 1] ? formatShortDate(dates[0]) : `${formatShortDate(dates[0])} to ${formatShortDate(dates[dates.length - 1])}`}. Days already in your diary keep their entries; the import only adds.</p>}
          <button className="button primary" type="button" disabled={busy || (entries.length === 0 && weights.length === 0)} onClick={() => { void run() }}><Icon name="download" size={16} />{busy ? 'Importing…' : `Import ${entries.length + weights.length} ${entries.length + weights.length === 1 ? 'item' : 'items'}`}</button>
        </div>
      )}
      {result && <p className="form-note" role="status"><Icon name="info" size={15} />{result}</p>}
    </section>
  )
}
