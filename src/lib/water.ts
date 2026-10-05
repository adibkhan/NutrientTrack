import { formatNumber } from './utils'

export const ML_PER_FL_OZ = 29.5735

/** One tap of the water button: a glass in the unit the person uses for weight (pounds mean US ounces). */
export const waterStep = (unit: 'lb' | 'kg'): { ml: number; label: string } =>
  unit === 'lb' ? { ml: 237, label: '8 fl oz' } : { ml: 250, label: '250 ml' }

export const formatWater = (ml: number, unit: 'lb' | 'kg'): string => {
  const safe = Number.isFinite(ml) && ml > 0 ? ml : 0
  if (unit === 'lb') return `${formatNumber(safe / ML_PER_FL_OZ, 0)} fl oz`
  return safe >= 1000 ? `${formatNumber(safe / 1000, 2)} L` : `${formatNumber(safe, 0)} ml`
}

/** The new daily total after adding or removing some water. Never below zero. */
export const adjustedWater = (current: number, delta: number): number =>
  Math.max(0, Math.round((Number.isFinite(current) ? current : 0) + delta))
