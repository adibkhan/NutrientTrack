import { useMemo, useRef, useState } from 'react'
import type { DiaryEntry, WeightEntry } from '../types'
import { FORMAT_SOURCE, NEEDS_WEIGHT_UNIT, parseImport, SOURCE_LABELS, type ImportFormat, type ImportedEntry, type ImportedWeight, type ParsedImport } from '../lib/importers'
import { dropCoveredDayTotals, MACROFACTOR_DAY_TOTAL, planImport } from '../lib/importPlan'
import type * as MacroFactorModule from '../lib/macrofactorImport'
import type { DateOrder, MacroFactorParse, SheetReport } from '../lib/macrofactorImport'
import type { Sheet } from '../lib/xlsx'
import { Icon } from './Icon'

type Source = { kind: 'csv'; text: string } | { kind: 'xlsx'; sheets: Sheet[]; date1904: boolean } | { kind: 'error'; message: string }
interface ParsedFile {
  name: string
  source: Source
}

interface ImportPanelProps {
  defaultUnit: 'lb' | 'kg'
  /** What the diary and weight log hold now, so the preview shows what will really be written. */
  entries: DiaryEntry[]
  weights: WeightEntry[]
  /** Saves what was read; resolves with how many entries and weigh-ins were new. */
  onImport: (entries: ImportedEntry[], weights: ImportedWeight[]) => Promise<{ entries: number; weights: number; duplicates?: number; duplicateWeights?: number; coveredDays?: number; replaced?: number }>
}

const FORMAT_LABELS: Record<ImportFormat, [string, string]> = {
  'mfp-nutrition': ['meal total', 'meal totals'], 'mfp-measurements': ['weigh-in', 'weigh-ins'], 'cronometer-servings': ['food', 'foods'], 'cronometer-biometrics': ['weigh-in', 'weigh-ins'],
  'loseit-food': ['food', 'foods'], 'loseit-weights': ['weigh-in', 'weigh-ins'], 'macrofactor-food': ['food', 'foods'],
}
const KIND_LABELS: Record<SheetReport['kind'], [string, string]> = { food: ['food', 'foods'], daily: ['day total', 'day totals'], weight: ['weigh-in', 'weigh-ins'], trend: ['row', 'rows'], skipped: ['row', 'rows'], unknown: ['row', 'rows'] }
const counted = (count: number, [one, many]: [string, string]) => `${count} ${count === 1 ? one : many}`
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
const READER_FAILED = "The Excel reader couldn't load. Connect to the internet once and try again."
const longDate = (iso: string) => new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(`${iso}T12:00:00`))
const sheetLine = (sheet: SheetReport) => {
  if (sheet.kind === 'trend' || sheet.kind === 'skipped') return 'Not imported'
  if (sheet.kind === 'unknown') return sheet.note ?? 'Not imported'
  const parts = [sheet.imported || !sheet.alsoWeights ? counted(sheet.imported, KIND_LABELS[sheet.kind]) : '', sheet.alsoWeights ? counted(sheet.alsoWeights, KIND_LABELS.weight) : ''].filter(Boolean)
  return `${parts.join(' · ')}${sheet.skipped ? ` · ${sheet.skipped} couldn't be read` : ''}${sheet.note ? ` · ${sheet.note}` : ''}`
}

type Parsed = { file: ParsedFile; legacy?: ParsedImport; mf?: MacroFactorParse; error?: string }

const readSource = async (file: File): Promise<ParsedFile> => {
  if (file.size > 30_000_000) return { name: file.name, source: { kind: 'error', message: 'That file is too large to read here.' } }
  if (/\.xlsx$/i.test(file.name) || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    let reader: typeof import('../lib/xlsx')
    try {
      // The unzip library is fetched only now, when someone picks a spreadsheet.
      reader = await import('../lib/xlsx')
    } catch {
      throw new Error(READER_FAILED)
    }
    try {
      const workbook = await reader.readXlsx(await file.arrayBuffer())
      return { name: file.name, source: { kind: 'xlsx', sheets: workbook.sheets, date1904: workbook.date1904 } }
    } catch (error) {
      return { name: file.name, source: { kind: 'error', message: error instanceof Error && error.name === 'XlsxError' ? error.message : 'We could not open that Excel file. Export it again from the app, or choose its CSV.' } }
    }
  }
  return { name: file.name, source: { kind: 'csv', text: await file.text() } }
}

/** Before the MacroFactor reader has loaded only the older CSV formats can be read. */
const legacyOnly = (file: ParsedFile, unit: 'lb' | 'kg'): Parsed => {
  const legacy = file.source.kind === 'csv' ? parseImport(file.source.text, unit) : undefined
  return legacy ? { file, legacy } : { file }
}

/** Bring a diary over from another tracker. Files are read on this device and never uploaded. */
export function ImportPanel({ defaultUnit, entries: existingEntries, weights: existingWeights, onImport }: ImportPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<ParsedFile[]>([])
  const [unit, setUnit] = useState<'lb' | 'kg'>(defaultUnit)
  const [dateOrder, setDateOrder] = useState<DateOrder | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(false)
  const [result, setResult] = useState('')
  // The MacroFactor reader is fetched the first time a file needs it, so it never loads with the app and CSV import works offline.
  const [reader, setReader] = useState<typeof MacroFactorModule | null>(null)

  const parsed = useMemo<Parsed[]>(() => files.map((file) => {
    const { source } = file
    if (source.kind === 'error') return { file, error: source.message }
    const options = { targetUnit: defaultUnit, assumedUnit: unit, dateOrder }
    if (!reader) return legacyOnly(file, unit)
    if (source.kind === 'xlsx') return { file, mf: reader.parseMacroFactorSheets(source.sheets, { ...options, date1904: source.date1904 }) }
    const legacy = parseImport(source.text, unit)
    if (legacy) return { file, legacy }
    const mf = reader.parseMacroFactorCsv(source.text, file.name, options)
    return mf.sheets.some((sheet) => sheet.kind !== 'unknown') ? { file, mf } : { file }
  }), [files, unit, defaultUnit, reader, dateOrder])

  const allEntries = parsed.flatMap(({ legacy, mf }) => [...(legacy?.entries ?? []), ...(mf?.entries ?? [])])
  const allWeights = parsed.flatMap(({ legacy, mf }) => [...(legacy?.weights ?? []), ...(mf?.weights ?? [])])
  const { kept: entries } = dropCoveredDayTotals(allEntries)
  // The same planning the save does, run against the diary as it is now, so the counts are what will be written.
  const plan = useMemo(() => planImport(entries, allWeights, { entries: existingEntries, weights: existingWeights }, new Date().toISOString()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parsed, existingEntries, existingWeights])
  const needsUnit = parsed.some(({ legacy, mf }) => (legacy && NEEDS_WEIGHT_UNIT.includes(legacy.format) && legacy.weights.length > 0) || mf?.sheets.some((sheet) => sheet.assumedUnit))
  const askDate = parsed.flatMap(({ mf }) => mf?.sheets.flatMap((sheet) => (sheet.askDateOrder ? [sheet.askDateOrder] : [])) ?? [])[0]
  const dates = [...plan.entries, ...plan.weights].map((item) => item.date).sort()
  const foods = plan.entries.filter((entry) => entry.importedKind !== 'day-total' && !(entry.importedFrom === 'macrofactor' && entry.name === MACROFACTOR_DAY_TOTAL)).length
  const dayTotals = plan.entries.length - foods
  const unreadable = parsed.reduce((total, { legacy, mf }) => total + (legacy?.skipped ?? 0) + (mf?.skipped ?? 0), 0) + plan.rejected
  const alreadyHere = plan.duplicates + plan.duplicateWeights
  const nothingNew = plan.entries.length === 0 && plan.weights.length === 0
  const total = plan.entries.length + plan.weights.length

  const choose = async (list: FileList | null) => {
    setResult('')
    if (!list) return
    setReading(true)
    try {
      const read = await Promise.all([...list].slice(0, 10).map(readSource))
      const needsReader = read.some(({ source }) => source.kind === 'xlsx' || (source.kind === 'csv' && !parseImport(source.text)))
      if (needsReader && !reader) {
        try { setReader(await import('../lib/macrofactorImport')) } catch { throw new Error(READER_FAILED) }
      }
      setFiles(read)
    } catch (error) {
      setFiles([])
      setResult(error instanceof Error ? error.message : READER_FAILED)
      if (inputRef.current) inputRef.current.value = ''
    } finally {
      setReading(false)
    }
  }

  const run = async () => {
    setBusy(true)
    try {
      const saved = await onImport(entries, allWeights)
      const notes = [
        saved.replaced ? `Replaced ${plural(saved.replaced, 'day total', 'day totals')} with their food logs.` : '',
        saved.duplicates || saved.duplicateWeights ? `Skipped ${plural((saved.duplicates ?? 0) + (saved.duplicateWeights ?? 0), 'item', 'items')} already in your diary.` : '',
        saved.coveredDays ? `Skipped ${plural(saved.coveredDays, 'day total', 'day totals')} for days that already have foods.` : '',
      ].filter(Boolean)
      setResult(`Imported ${plural(saved.entries, 'entry', 'entries')} and ${plural(saved.weights, 'weigh-in', 'weigh-ins')}.${notes.length ? ` ${notes.join(' ')}` : ''}`)
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
      <p className="page-description">Bring your history from MyFitnessPal, Cronometer, Lose It! or MacroFactor. Choose their export files (CSV, or Excel for MacroFactor); they are read here and never uploaded.</p>
      <details className="import-help">
        <summary>Which files do I need?</summary>
        <ul>
          <li><strong>MyFitnessPal</strong>: Nutrition-Summary and Measurement-Summary CSVs from the export zip. It holds meal totals, so each meal comes in as one entry.</li>
          <li><strong>Cronometer</strong>: servings.csv (Export Food &amp; Recipe Entries) and biometrics.csv.</li>
          <li><strong>Lose It!</strong>: food-logs.csv and weights.csv from the data export zip.</li>
          <li><strong>MacroFactor</strong>: the .xlsx from More &gt; Data Management &gt; Data Export, or a CSV of one sheet. We find foods, scale weight and daily totals by their column names, since exports differ between versions. Tell us if a sheet didn&rsquo;t import. Reading an Excel file needs a one-time download, so connect to the internet the first time.</li>
        </ul>
      </details>
      <label className="button secondary import-choose" htmlFor="import-files"><Icon name="upload" size={16} />Choose CSV or Excel files</label>
      <input ref={inputRef} id="import-files" className="visually-hidden" type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" multiple onChange={(event) => { void choose(event.target.files) }} />
      {reading && <p className="field-hint" role="status">Reading…</p>}
      {parsed.length > 0 && !reading && (
        <div className="import-summary" aria-live="polite">
          <ul>
            {parsed.map(({ file, legacy, mf, error }) => {
              const recognised = Boolean(legacy) || Boolean(mf?.sheets.some((sheet) => sheet.kind !== 'unknown'))
              return <li key={file.name} className={recognised ? '' : 'unknown'}>
                <Icon name={recognised ? 'check' : 'info'} size={15} />
                <span><strong>{file.name}</strong>
                  {legacy && <small>{SOURCE_LABELS[FORMAT_SOURCE[legacy.format]]} · {counted(legacy.entries.length || legacy.weights.length, FORMAT_LABELS[legacy.format])}{legacy.skipped ? ` · ${legacy.skipped} couldn't be read` : ''}</small>}
                  {mf?.sheets.map((sheet) => <small key={sheet.name}>{sheet.name} · {sheetLine(sheet)}</small>)}
                  {error && <small>{error}</small>}
                  {!legacy && !mf && !error && <small>Not a file we recognize. Choose one of the exports listed above, and tell us if it should have worked.</small>}
                </span>
              </li>
            })}
          </ul>
          {needsUnit && <div className="form-field full"><label htmlFor="import-unit">Weights in those files are in</label><select id="import-unit" value={unit} onChange={(event) => setUnit(event.target.value as 'lb' | 'kg')}><option value="lb">Pounds (lb)</option><option value="kg">Kilograms (kg)</option></select></div>}
          {askDate && <div className="form-field full"><label htmlFor="import-date-order">Dates like {askDate.example} are written</label><select id="import-date-order" value={dateOrder ?? askDate.used} onChange={(event) => setDateOrder(event.target.value as DateOrder)}><option value="mdy">Month first (01/05 is January 5)</option><option value="dmy">Day first (01/05 is 1 May)</option></select></div>}
          <p className="import-counts">{nothingNew ? 'Nothing new to import.' : [foods ? plural(foods, 'food', 'foods') : '', dayTotals ? plural(dayTotals, 'day total', 'day totals') : '', plan.weights.length ? plural(plan.weights.length, 'weigh-in', 'weigh-ins') : ''].filter(Boolean).join(' · ') + ' will be added.'}</p>
          {(alreadyHere > 0 || unreadable > 0) && <p className="field-hint">{[alreadyHere ? `${alreadyHere} already here` : '', unreadable ? `${unreadable} couldn't be read` : ''].filter(Boolean).join(' · ')}</p>}
          {dates.length > 0 && <p className="field-hint">{dates[0] === dates[dates.length - 1] ? longDate(dates[0]) : `${longDate(dates[0])} to ${longDate(dates[dates.length - 1])}`}. Days already in your diary keep their entries; the import only adds.</p>}
          {plan.replaced.length > 0 && <p className="field-hint">{plural(plan.replaced.length, 'day total', 'day totals')} will be replaced by their food logs.</p>}
          {plan.coveredDays > 0 && <p className="field-hint">{plural(plan.coveredDays, 'day total', 'day totals')} left out because the day already has foods or another total.</p>}
          {parsed.some(({ mf }) => mf?.sheets.some((sheet) => sheet.kind === 'trend')) && <p className="field-hint">Expenditure history isn&rsquo;t imported; NutrientTrack recalculates it from your weights and food.</p>}
          <button className="button primary" type="button" disabled={busy || nothingNew} onClick={() => { void run() }}><Icon name="download" size={16} />{busy ? 'Importing…' : `Import ${total} ${total === 1 ? 'item' : 'items'}`}</button>
        </div>
      )}
      {result && <p className="form-note" role="status"><Icon name="info" size={15} />{result}</p>}
    </section>
  )
}
