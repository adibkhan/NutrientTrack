import { useEffect, useRef, useState } from 'react'
import { inputText } from '../lib/decimal'
import { labelName, labelToFill, labelUnit, type LabelCheck, type LabelFill } from '../lib/labelDraft'
import { LABEL_KEYS, type LabelKey, type ParsedLabel } from '../lib/labelParse'
import { Icon } from './Icon'
import './label-scan.css'

interface LabelScanProps {
  /** The parsed form values and the photo (kept by the form for the review crop). */
  onUse: (fill: LabelFill, photo: Blob) => void
  onBack: () => void
  /** For tests and tooling: replaces the real photo reader. */
  read?: (file: Blob, onProgress: (progress: ReadProgress) => void) => Promise<ParsedLabel>
}

/** Where the reader is: fetching its files (first use only), starting, or reading text. */
export interface ReadProgress { stage: 'download' | 'start' | 'read'; percent: number }
type Stage = 'pick' | 'reading' | 'done' | 'failed' | 'error'
type Problem = 'download' | 'unreadable' | 'offline' | 'start'

export const MESSAGES: Record<Problem, string> = {
  download: "Couldn't download the label reader. Check your connection and try again.",
  unreadable: "This file isn't a photo we can open. Try a JPEG or PNG, or take the photo here.",
  offline: "The label reader isn't available offline yet. Open it once while online.",
  start: 'The label reader could not start on this device. Try again, or type the label in.',
}

const defaultRead = async (file: Blob, onProgress: (progress: ReadProgress) => void): Promise<ParsedLabel> => {
  const { readLabelPhoto } = await import('../lib/labelRead').catch(() => { throw new ReaderUnavailable() })
  const reading = await readLabelPhoto(file, (progress) => {
    if (progress.status === 'recognizing text') onProgress({ stage: 'read', percent: Math.round(progress.progress * 100) })
    else if (progress.status.startsWith('loading')) onProgress({ stage: 'download', percent: Math.round(progress.progress * 100) })
    else onProgress({ stage: 'start', percent: 0 })
  })
  return reading.parsed
}

/** The reader's code could not be fetched (offline before it was ever opened). */
class ReaderUnavailable extends Error {}

const problemFor = (error: unknown): Problem => {
  if (error instanceof ReaderUnavailable) return 'offline'
  const name = error instanceof Error ? error.name : ''
  if (name === 'UnreadableImageError') return 'unreadable'
  if (name === 'OcrLoadError') return 'download'
  return 'start'
}

const progressText = ({ stage, percent }: ReadProgress): string =>
  stage === 'download' ? `Downloading the reader, one time, 4 MB…${percent > 0 ? ` ${percent}%` : ''}` : stage === 'start' ? 'Starting the reader…' : `Reading label…${percent > 0 ? ` ${percent}%` : ''}`

/** Photograph a Nutrition Facts label; the numbers are read on the device and handed to the entry form for review. Nothing is saved here. */
export function LabelScan({ onUse, onBack, read = defaultRead }: LabelScanProps) {
  const [stage, setStage] = useState<Stage>('pick')
  const [photo, setPhoto] = useState('')
  const [progress, setProgress] = useState<ReadProgress>({ stage: 'start', percent: 0 })
  const [problem, setProblem] = useState<Problem>('start')
  const [photoBroken, setPhotoBroken] = useState(false)
  const chosen = useRef<Blob | undefined>()
  const [parsed, setParsed] = useState<ParsedLabel | undefined>()
  const run = useRef(0)

  // The photo lives only as an object URL while this screen is open; it is never written anywhere.
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo) }, [photo])
  useEffect(() => () => {
    run.current += 1
    void import('../lib/labelOcr').then((ocr) => ocr.releaseOcr()).catch(() => undefined)
  }, [])

  const choose = async (file: File | undefined) => {
    if (!file) return
    const id = (run.current += 1)
    setPhoto(URL.createObjectURL(file))
    setPhotoBroken(false)
    chosen.current = file
    setProgress({ stage: 'start', percent: 0 })
    setStage('reading')
    try {
      const result = await read(file, (value) => { if (run.current === id) setProgress(value) })
      if (run.current !== id) return
      setParsed(result)
      setStage(result.usable ? 'done' : 'failed')
    } catch (error) {
      if (run.current !== id) return
      setProblem(problemFor(error))
      setStage('error')
    }
  }

  const inputs = (
    <div className="label-scan-actions">
      <label className="button primary">
        <Icon name="scan" size={16} />Take a photo
        <input className="label-file-input" type="file" accept="image/*" capture="environment" aria-label="Take a photo of the label" onChange={(event) => { void choose(event.target.files?.[0]); event.target.value = '' }} />
      </label>
      <label className="button secondary">
        Choose a photo
        <input className="label-file-input" type="file" accept="image/*" aria-label="Choose a photo of the label" onChange={(event) => { void choose(event.target.files?.[0]); event.target.value = '' }} />
      </label>
    </div>
  )

  return (
    <div className="label-scan">
      <button className="logger-back" type="button" onClick={onBack}><Icon name="arrow-left" size={15} />Back</button>
      {stage === 'pick' && <>
        <p className="label-scan-note">Photograph the Nutrition Facts panel, flat and close, in good light. It is read on this device: the photo is never uploaded or saved.</p>
        {inputs}
      </>}
      {stage !== 'pick' && photo && !photoBroken && <img className="label-scan-photo" src={photo} alt="Your label photo" onError={() => setPhotoBroken(true)} />}
      {stage === 'reading' && <p className="label-scan-status" role="status"><span className="loading-spinner" />{progressText(progress)}</p>}
      {stage === 'failed' && <>
        <p className="form-error" role="alert"><Icon name="info" size={15} />Couldn't read this label. Try a flatter, closer photo, or type it in.</p>
        {inputs}
        <button className="button secondary" type="button" onClick={onBack}>Type it in</button>
      </>}
      {stage === 'error' && <>
        <p className="form-error" role="alert"><Icon name="info" size={15} />{MESSAGES[problem]}</p>
        {inputs}
      </>}
      {stage === 'done' && parsed && <>
        <p className="label-scan-status" role="status"><Icon name="check" size={16} />Label read. Review the numbers next; nothing is saved yet.</p>
        <ParsedSummary parsed={parsed} />
        <div className="label-scan-actions">
          <button className="button primary" type="button" onClick={() => { if (chosen.current) onUse(labelToFill(parsed), chosen.current) }}><Icon name="check" size={16} />Use these values</button>
        </div>
        {inputs}
      </>}
    </div>
  )
}

function ParsedSummary({ parsed }: { parsed: ParsedLabel }) {
  const keys = LABEL_KEYS.filter((key) => parsed.values[key])
  return (
    <>
      <dl className="label-scan-values" aria-label="Values read from the label">
        {parsed.servingText && <div><dt>Serving size</dt><dd>{parsed.servingText}</dd></div>}
        {parsed.basis !== 'per serving' && <div><dt>Values are</dt><dd>{parsed.basis}</dd></div>}
        {keys.map((key: LabelKey) => {
          const entry = parsed.values[key]
          if (!entry) return null
          return <div key={key}><dt>{labelName(key)}</dt><dd>{inputText(entry.value)} {labelUnit(key)}{entry.confidence === 'check' && <span className="check-badge" title={entry.note}>Check</span>}</dd></div>
        })}
      </dl>
      {parsed.checkNumbers && <p className="form-error" role="alert"><Icon name="info" size={15} />Check these numbers: the calories do not match the protein, carbs and fat.</p>}
    </>
  )
}

/** Above the form after a label was read: the photo, what the numbers cover, and each thing the reader was unsure of. Nothing saves until they are edited or confirmed. */
export function LabelReviewNote({ fill, photo, open, onConfirm, eaten, onEaten }: {
  fill: LabelFill
  photo?: string
  /** The checks still to resolve. */
  open: LabelCheck[]
  onConfirm: (id: string) => void
  eaten: string
  onEaten: (value: string) => void
}) {
  const [broken, setBroken] = useState(false)
  const unit = fill.per100?.unit
  return (
    <div className="label-review" role="note" aria-label="About the scanned label">
      <strong>From your label photo</strong>
      {photo && !broken && <img className="label-review-photo" src={photo} alt="Crop of your label photo, for comparing" onError={() => setBroken(true)} />}
      <p>{unit ? `The label gives values per 100 ${unit}.` : `Values are for one serving (${fill.fields.serving}).`}{fill.servingsPerContainer ? ` The package has about ${inputText(fill.servingsPerContainer)}.` : ''} The name could not be read: type it.</p>
      {unit && <div className="form-field full label-eaten">
        <label htmlFor="label-eaten">{unit === 'ml' ? 'Millilitres you drank' : 'Grams you ate'} <span>required</span></label>
        <input id="label-eaten" inputMode="decimal" type="text" required aria-required="true" value={eaten} onChange={(event) => onEaten(event.target.value)} />
      </div>}
      {open.length > 0 && <div className="label-checks" role="group" aria-label="Things to check against the package">
        <p className="label-review-check">Check each of these against the package. Edit the box, or confirm it as read.</p>
        {open.map((check) => (
          <div className="label-check" key={check.id} data-check={check.id}>
            <div><span className="check-badge">Check</span> <strong>{check.name}</strong>: photo read <b>{check.read}</b></div>
            <small>{check.why}</small>
            {check.read !== 'not read' && <button className="button secondary label-confirm" type="button" aria-label={`Looks right: ${check.name} ${check.read}`} onClick={() => onConfirm(check.id)}>Looks right</button>}
          </div>
        ))}
      </div>}
      {fill.notes.map((note) => <p key={note}>{note}</p>)}
    </div>
  )
}
export { per100Fields } from '../lib/labelDraft'
