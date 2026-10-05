import { useEffect, useRef, useState } from 'react'
import { lookupBarcode, normalizeBarcode, scaleProduct, type BarcodeProduct, type BarcodeResult } from '../lib/barcode'
import { cameraAvailable, startScanning, type ScanSession } from '../lib/scanner'
import { formatNumber } from '../lib/utils'
import { Icon } from './Icon'

interface BarcodeLookupProps {
  /** Whether the person has opted in to sending barcode numbers to Open Food Facts. */
  enabled: boolean
  onEnable: () => void
  onUse: (product: BarcodeProduct, grams: number) => void
  onBack: () => void
}

type CameraState = 'idle' | 'starting' | 'scanning' | 'unavailable' | 'blocked'

export function BarcodeLookup({ enabled, onEnable, onUse, onBack }: BarcodeLookupProps) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<BarcodeResult | undefined>()
  const [problem, setProblem] = useState('')
  const [grams, setGrams] = useState('100')
  const [camera, setCamera] = useState<CameraState>(() => (cameraAvailable() ? 'idle' : 'unavailable'))
  const videoRef = useRef<HTMLVideoElement>(null)
  const sessionRef = useRef<ScanSession | null>(null)

  const stopCamera = () => {
    sessionRef.current?.stop()
    sessionRef.current = null
    setCamera((state) => (state === 'scanning' || state === 'starting' ? 'idle' : state))
  }

  const search = async (raw: string) => {
    const code = normalizeBarcode(raw)
    if (!code) {
      setProblem('That is not a valid barcode number. Check the digits under the bars: 8, 12, 13 or 14 of them.')
      setResult(undefined)
      return
    }
    setProblem('')
    setBusy(true)
    const found = await lookupBarcode(code)
    setBusy(false)
    setResult(found)
    if (found.kind === 'found') setGrams(String(found.product.servingGrams ?? 100))
  }

  const startCamera = async () => {
    const video = videoRef.current
    if (!video || sessionRef.current) return
    setProblem('')
    setResult(undefined)
    setCamera('starting')
    try {
      const session = await startScanning(video, (code) => {
        sessionRef.current = null
        setCamera('idle')
        setText(code)
        void search(code)
      })
      sessionRef.current = session
      setCamera('scanning')
    } catch (error) {
      sessionRef.current = null
      const name = error instanceof Error ? error.name : ''
      setCamera(name === 'NotAllowedError' || name === 'SecurityError' ? 'blocked' : 'idle')
      setProblem(name === 'NotAllowedError' || name === 'SecurityError'
        ? 'Camera access is blocked for this site. Allow the camera in your browser settings, or type the number instead.'
        : name === 'NotFoundError' || name === 'OverconstrainedError'
          ? 'No camera was found on this device. Type the number under the bars instead.'
          : 'The camera could not be started. Try again, or type the number instead.')
    }
  }

  // The camera opens as soon as the scanner is allowed to, and always closes when this screen goes away.
  useEffect(() => {
    if (enabled && camera === 'idle' && !sessionRef.current && result === undefined && !problem) void startCamera()
    return () => { sessionRef.current?.stop(); sessionRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  const amount = Number(grams)
  const scaled = result?.kind === 'found' && amount > 0 ? scaleProduct(result.product, amount) : undefined
  const live = camera === 'scanning' || camera === 'starting'

  if (!enabled) {
    return (
      <div className="logger-search barcode-lookup">
        <button className="logger-back" type="button" onClick={onBack}><Icon name="arrow-left" size={15} />Back to food search</button>
        <div className="privacy-card">
          <span className="privacy-card-icon"><Icon name="info" size={19} /></span>
          <div>
            <strong>Barcode lookup is off</strong>
            <p>Looking up a barcode sends its number to Open Food Facts, a public food database, and your device address goes with the request. Nothing else is sent. NutrientTrack never sends your diary.</p>
          </div>
        </div>
        <button className="button primary" type="button" onClick={onEnable}>Turn on barcode lookup</button>
        <p className="form-note">You can turn this off again in Settings.</p>
      </div>
    )
  }

  return (
    <div className="logger-search barcode-lookup">
      <button className="logger-back" type="button" onClick={() => { stopCamera(); onBack() }}><Icon name="arrow-left" size={15} />Back to food search</button>
      <div className={`barcode-viewfinder ${live ? 'live' : ''}`} hidden={!live && camera !== 'idle'}>
        <video ref={videoRef} className="barcode-video" muted playsInline aria-label="Camera preview" />
        {live && <div className="barcode-guide" aria-hidden="true" />}
        <p className="barcode-status" role="status">
          {camera === 'starting' ? 'Opening the camera…' : camera === 'scanning' ? 'Point the camera at the barcode. It reads by itself.' : 'Camera is off.'}
        </p>
      </div>
      <p className="field-hint">{camera === 'unavailable' ? 'This browser cannot use the camera, so type the number printed under the bars.' : 'If the camera cannot read the bars, type the number printed under them.'}</p>
      <div className="barcode-actions">
        {camera === 'idle' && <button className="button primary" type="button" onClick={() => { void startCamera() }}><Icon name="search" size={16} />Scan with camera</button>}
        {live && <button className="button secondary" type="button" onClick={stopCamera}>Stop camera</button>}
        {camera === 'blocked' && <button className="button secondary" type="button" onClick={() => { setCamera('idle'); setProblem('') }}>Try the camera again</button>}
      </div>
      <form className="barcode-form" onSubmit={(event) => { event.preventDefault(); stopCamera(); void search(text) }}>
        <div className="form-field full">
          <label htmlFor="barcode-number">Barcode number</label>
          <input id="barcode-number" inputMode="numeric" placeholder="e.g. 3017620422003" value={text} onChange={(event) => setText(event.target.value)} />
        </div>
        <button className="button secondary" disabled={busy || !text.trim()} type="submit">{busy ? 'Looking up…' : 'Look up'}</button>
      </form>
      {problem && <p className="form-error" role="alert"><Icon name="info" size={15} />{problem}</p>}
      {busy && <div className="logger-loading"><span className="loading-spinner" />Looking the product up…</div>}
      {result?.kind === 'not-found' && <div className="logger-message"><Icon name="info" size={17} /><div><strong>No product found</strong><p>The database does not know this barcode. Enter the food by hand instead.</p></div></div>}
      {result?.kind === 'no-nutrition' && <div className="logger-message"><Icon name="info" size={17} /><div><strong>No nutrition information</strong><p>This product is listed without calories. Enter the food by hand instead.</p></div></div>}
      {result?.kind === 'error' && <div className="logger-message error"><Icon name="info" size={17} /><div><strong>Lookup failed</strong><p>{result.message}</p></div></div>}
      {result?.kind === 'found' && (
        <div className="barcode-result">
          <div className="logger-selected"><span className="result-avatar catalog"><Icon name="food" size={18} /></span><div><strong>{result.product.name}</strong><span>{result.product.brand ?? 'Open Food Facts'} · {formatNumber(result.product.per100g.calories, 0)} kcal / 100 g</span></div></div>
          <div className="grams-field">
            <label htmlFor="barcode-grams"><Icon name="scale" size={15} />Amount</label>
            <div className="input-with-suffix"><input id="barcode-grams" inputMode="decimal" min="0" step="any" type="number" value={grams} onChange={(event) => setGrams(event.target.value)} /><span>g</span></div>
          </div>
          {result.product.servingGrams && <p className="field-hint">One labelled serving is {formatNumber(result.product.servingGrams, 1)} g.</p>}
          {scaled && <div className="nutrition-preview"><div><span>Calories</span><strong>{formatNumber(scaled.calories, 1)}<small>kcal</small></strong></div><div><span><i className="macro-dot protein" />Protein</span><strong>{formatNumber(scaled.protein, 1)}<small>g</small></strong></div><div><span><i className="macro-dot carbs" />Carbs</span><strong>{formatNumber(scaled.carbs, 1)}<small>g</small></strong></div><div><span><i className="macro-dot fat" />Fat</span><strong>{formatNumber(scaled.fat, 1)}<small>g</small></strong></div></div>}
          <div className="barcode-actions">
            <button className="button secondary" type="button" onClick={() => { setResult(undefined); setText(''); setCamera('idle'); void startCamera() }}>Scan another</button>
            <button className="button primary" disabled={!scaled} type="button" onClick={() => onUse(result.product, amount)}><Icon name="check" size={16} />Use this food</button>
          </div>
        </div>
      )}
    </div>
  )
}
