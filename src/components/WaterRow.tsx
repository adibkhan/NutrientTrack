import { formatWater, waterStep } from '../lib/water'
import { Icon } from './Icon'

interface WaterRowProps {
  ml: number
  unit: 'lb' | 'kg'
  onAdjust: (deltaMl: number) => void
}

export function WaterRow({ ml, unit, onAdjust }: WaterRowProps) {
  const step = waterStep(unit)
  return (
    <div className="water-row">
      <span className="water-label">Water</span>
      <strong className="water-value" aria-live="polite">{formatWater(ml, unit)}</strong>
      <div className="water-actions">
        <button className="icon-button" type="button" aria-label={`Remove ${step.label} of water`} disabled={ml <= 0} onClick={() => onAdjust(-step.ml)}>−</button>
        <button className="button secondary compact" type="button" aria-label={`Add ${step.label} of water`} onClick={() => onAdjust(step.ml)}><Icon name="plus" size={15} />{step.label}</button>
      </div>
    </div>
  )
}
