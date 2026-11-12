import { useEffect, useRef, useState } from 'react'
import { ambiguityMessage, inputText, parseDecimal } from '../lib/decimal'
import type { BrandedProduct } from '../catalog/branded'
import { findBarcode, isUnreachable } from '../lib/brandedApp'
import { lookupBarcode, normalizeBarcode, scaleProduct, type BarcodeProduct, type BarcodeResult } from '../lib/barcode'
import { cameraAvailable, startScanning, type ScanSession } from '../lib/scanner'
import { formatNumber } from '../lib/utils'
import { Icon } from './Icon'

interface BarcodeLookupProps {
  /** Whether the person has opted in to sending barcode numbers to Open Food Facts. The self-hosted brand list needs no opt-in. */
  enabled: boolean
  onEnable: () => void
  onUse: (product: BarcodeProduct, grams: number) => void
  /** A product from the self-hosted USDA Branded list: the logger opens its detail form on the label serving. */
  onBranded: (product: BrandedProduct) => void
  /** Hand over to the nutrition label scanner. */
  onLabel: () => void
  /** Hand over to the manual form. */
  onManual: () => void
  onBack: () => void
}

/** A code the brand list does not have, while the online lookup is off. */
interface Unlisted { kind: 'unlisted'; code: string; unreachable: boolean }

type CameraState = 'idle' | 'starting' | 'scanning' | 'unavailable' | 'blocked'

export function BarcodeLookup({ enabled, onEnable, onUse, onBranded, onLabel, onManual, onBack }: BarcodeLookupProps) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<BarcodeResult | Unlisted | undefined>()
  const [problem, setProblem] = useState('')
  const [grams, setGrams] = useState('100')
  const [camera, setCamera] = useState<CameraState>(() => (cameraAvailable() ? 'idle' : 'unavailable'))
  const videoRef = useRef<HTMLVideoElement>(null)
  const sessionRef = useRef<ScanSession | null>(null)
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  // Counts camera starts, so a start that finishes after the screen was closed or stopped can release itself.
  const startId = useRef(0)

  const stopCamera = () => {
    startId.current += 1
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
    setResult(undefined)
    setBusy(true)
    // First the self-hosted USDA Branded list: no opt-in, nothing leaves this site. Only a miss goes on to Open Food Facts, and only when the person turned that on.
    const own = await findBarcode(code)
    if (own.product) {
      setBusy(false)
      stopCamera()
      onBranded(own.product)
      return
    }
    if (!enabledRef.current) {
      setBusy(false)
      setResult({ kind: 'unlisted', code, unreachable: isUnreachable(own.reason) })
      return
    }
    const found = await lookupBarcode(code)
    setBusy(false)
    setResult(found)
    if (found.kind === 'found') setGrams(inputText(found.product.servingGrams ?? 100))
  }

  const startCamera = async () => {
    const video = videoRef.current
    if (!video || sessionRef.current) return
    setProblem('')
    setResult(undefined)
    setCamera('starting')
    const id = (startId.current += 1)
    try {
      const session = await startScanning(video, (code) => {
        sessionRef.current = null
        setCamera('idle')
        setText(code)
        void search(code)
      })
      if (id !== startId.current) {
        // Closed or stopped while the camera was opening: release it now.
        session.stop()
        return
      }
      sessionRef.current = session
      setCamera('scanning')
    } catch (error) {
      if (id !== startId.current) return
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

  // The camera opens as soon as the screen does (reading a barcode happens on this device), and always closes when this screen goes away.
  useEffect(() => {
    if (camera === 'idle' && !sessionRef.current && result === undefined && !problem) void startCamera()
    return () => { startId.current += 1; sessionRef.current?.stop(); sessionRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Turning the online lookup on from the prompt below tries the same code again.
  useEffect(() => {
    if (enabled && result?.kind === 'unlisted') void search(result.code)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  const amount = parseDecimal(grams)
  const gramsProblem = ambiguityMessage(grams)
  const scaled = result?.kind === 'found' && amount > 0 ? scaleProduct(result.product, amount) : undefined
  const live = camera === 'scanning' || camera === 'starting'

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
      {result?.kind === 'unlisted' && (
        <div className="barcode-unlisted">
          <div className="logger-message"><Icon name="info" size={17} /><div><strong>{result.unreachable ? 'Brand list not reachable' : 'Not in the brand list'}</strong><p>{result.unreachable ? 'The packaged food list needs a connection the first time.' : `Barcode ${result.code} is not in the offline packaged food list.`} You can look it up online, read its nutrition label, or enter it by hand.</p></div></div>
          <div className="barcode-actions">
            <button className="button primary" type="button" onClick={onEnable}>Turn on online lookup</button>
            <button className="button secondary" type="button" onClick={onLabel}><Icon name="label" size={16} />Scan the nutrition label instead</button>
            <button className="button secondary" type="button" onClick={onManual}><Icon name="edit" size={16} />Enter it by hand</button>
          </div>
          <div className="privacy-card">
            <span className="privacy-card-icon"><Icon name="info" size={19} /></span>
            <div>
              <strong>Online lookup is off</strong>
              <p>Looking up a barcode online sends its number to Open Food Facts, a public food database, and your device address goes with the request. Nothing else is sent. NutrientTrack never sends your diary. You can turn this off again in Settings.</p>
            </div>
          </div>
        </div>
      )}
      {result?.kind === 'not-found' && <div className="logger-message"><Icon name="info" size={17} /><div><strong>No product found</strong><p>The database does not know this barcode. Enter the food by hand instead.</p></div></div>}
      {result?.kind === 'no-nutrition' && <div className="logger-message"><Icon name="info" size={17} /><div><strong>No nutrition information</strong><p>This product is listed without calories. Enter the food by hand instead.</p></div></div>}
      {result?.kind === 'error' && <div className="logger-message error"><Icon name="info" size={17} /><div><strong>Lookup failed</strong><p>{result.message}</p></div></div>}
      {result?.kind === 'found' && (
        <div className="barcode-result">
          <div className="logger-selected"><span className="result-avatar catalog"><Icon name="food" size={18} /></span><div><strong>{result.product.name}</strong><span>{result.product.brand ?? 'Open Food Facts'} · {formatNumber(result.product.per100g.calories, 0)} kcal / 100 g</span></div></div>
          <div className="grams-field">
            <label htmlFor="barcode-grams"><Icon name="scale" size={15} />Amount</label>
            <div className="input-with-suffix"><input id="barcode-grams" inputMode="decimal" type="text" aria-invalid={gramsProblem ? true : undefined} aria-describedby={gramsProblem ? 'barcode-grams-error' : undefined} value={grams} onChange={(event) => setGrams(event.target.value)} /><span>g</span></div>
            {gramsProblem && <p className="field-error" id="barcode-grams-error" role="alert">{gramsProblem}</p>}
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
