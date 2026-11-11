import { useEffect, useState, type ComponentProps } from 'react'
import { Icon } from './Icon'

/**
 * Loads the label screen on demand, like the barcode decoder, and keeps the rest of the logger working when the
 * download fails (offline before it was ever opened). Not React.lazy: a failed lazy import throws into the whole app.
 */
type LabelModule = typeof import('./LabelScan')
let loading: Promise<LabelModule> | undefined

export const loadLabelModule = (): Promise<LabelModule> => {
  loading ??= import('./LabelScan').catch((error: unknown) => { loading = undefined; throw error })
  return loading
}

export const LABEL_OFFLINE_MESSAGE = "The label reader isn't available offline yet. Open it once while online."

/** The label module once it has loaded; `failed` when it could not be fetched. */
export function useLabelModule(enabled: boolean): { module?: LabelModule; failed: boolean } {
  const [state, setState] = useState<{ module?: LabelModule; failed: boolean }>({ failed: false })
  useEffect(() => {
    if (!enabled || state.module) return
    let live = true
    loadLabelModule().then((module) => { if (live) setState({ module, failed: false }) }, () => { if (live) setState({ failed: true }) })
    return () => { live = false }
  }, [enabled, state.module])
  return state
}

export function LabelScreen({ onBack, onUse }: Pick<ComponentProps<LabelModule['LabelScan']>, 'onBack' | 'onUse'>) {
  const { module, failed } = useLabelModule(true)
  if (failed) {
    return (
      <div className="label-scan">
        <button className="logger-back" type="button" onClick={onBack}><Icon name="arrow-left" size={15} />Back</button>
        <p className="form-error" role="alert"><Icon name="info" size={15} />{LABEL_OFFLINE_MESSAGE}</p>
      </div>
    )
  }
  if (!module) return <p className="label-scan-status" role="status">Loading…</p>
  return <module.LabelScan onBack={onBack} onUse={onUse} />
}

/** The review note above the form; renders nothing until the label module is in (it always is by then). */
export function LabelReview(props: Omit<ComponentProps<LabelModule['LabelReviewNote']>, never>) {
  const { module } = useLabelModule(true)
  return module ? <module.LabelReviewNote {...props} /> : null
}
