import type { BackupPayload, DiaryEntry, Goals, MealCategory, Settings, WeightEntry } from '../types'
import { isoFromDate } from './utils'

/** Current backup format. Bump it only together with a new BACKUP_MIGRATIONS step and a fixture test. */
export const BACKUP_VERSION = 1

type BackupRecord = Record<string, unknown>

/**
 * Step N upgrades a version N backup to version N + 1. Never edit or remove a shipped step, so a file
 * exported by any earlier release still restores.
 */
const BACKUP_MIGRATIONS: Array<(backup: BackupRecord) => BackupRecord> = []

export type BackupReadResult =
  | { ok: true; backup: BackupPayload }
  | { ok: false; reason: 'invalid' | 'newer' }

/** Check an imported file, upgrading older backup versions to the current one before validating. */
export const readBackup = (value: unknown): BackupReadResult => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'invalid' }
  const candidate = value as BackupRecord
  const version = candidate.version
  if (candidate.format !== 'nutrienttrack-backup' || typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, reason: 'invalid' }
  }
  if (version > BACKUP_VERSION) return { ok: false, reason: 'newer' }
  let upgraded = candidate
  for (let from = version; from < BACKUP_VERSION; from += 1) upgraded = { ...BACKUP_MIGRATIONS[from - 1](upgraded), version: from + 1 }
  return validateBackup(upgraded) ? { ok: true, backup: upgraded } : { ok: false, reason: 'invalid' }
}

export const validateBackup = (value: unknown): value is BackupPayload => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<BackupPayload>
  if (candidate.format !== 'nutrienttrack-backup' || candidate.version !== BACKUP_VERSION) return false
  if (!Array.isArray(candidate.entries) || !Array.isArray(candidate.foods) || !Array.isArray(candidate.weights) || !Array.isArray(candidate.settings)) return false
  const isISODate = (value: unknown) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    const parsed = new Date(`${value}T12:00:00`)
    return !Number.isNaN(parsed.getTime()) && isoFromDate(parsed) === value
  }
  const isNonNegativeNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0
  const isOptionalNonNegativeNumber = (item: unknown, key: string) => {
    const value = item && typeof item === 'object' ? (item as Record<string, unknown>)[key] : undefined
    return value === undefined || isNonNegativeNumber(value)
  }
  const isOptionalIdentifier = (item: unknown, key: string) => {
    const value = item && typeof item === 'object' ? (item as Record<string, unknown>)[key] : undefined
    return value === undefined || (typeof value === 'string' && value.trim().length > 0)
  }
  const isOptionalCatalogSource = (item: unknown) => {
    const value = item && typeof item === 'object' ? (item as Record<string, unknown>).catalogSource : undefined
    return value === undefined || value === 'USDA SR Legacy' || value === 'USDA Foundation'
  }
  const isOptionalTime = (item: unknown) => {
    const value = item && typeof item === 'object' ? (item as Record<string, unknown>).time : undefined
    return value === undefined || (typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value))
  }
  const hasStrings = (item: unknown, keys: string[]) =>
    Boolean(item && typeof item === 'object' && keys.every((key) => typeof (item as Record<string, unknown>)[key] === 'string'))
  const hasNumbers = (item: unknown, keys: string[]) =>
    Boolean(item && typeof item === 'object' && keys.every((key) => isNonNegativeNumber((item as Record<string, unknown>)[key])))
  const validMeal = (value: unknown): value is MealCategory => ['breakfast', 'lunch', 'dinner', 'snack', 'other'].includes(String(value))
  const validUnit = (value: unknown): value is 'lb' | 'kg' => value === 'lb' || value === 'kg'
  const validGoals = (value: unknown) => {
    if (!value || typeof value !== 'object' || !validUnit((value as Goals).weightUnit)) return false
    return ['calories', 'protein', 'carbs', 'fat'].every((key) => {
      const goal = (value as Record<string, unknown>)[key]
      return goal === undefined || isNonNegativeNumber(goal)
    })
  }
  const hasUniqueIds = (items: unknown[]) => {
    const ids = items.map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>).id : undefined))
    return ids.every((id): id is string => typeof id === 'string' && id.trim().length > 0) && new Set(ids).size === ids.length
  }
  return hasUniqueIds(candidate.entries) && hasUniqueIds(candidate.foods) && hasUniqueIds(candidate.weights) && hasUniqueIds(candidate.settings) &&
    candidate.entries.every((item) => hasStrings(item, ['id', 'date', 'name', 'createdAt', 'updatedAt']) && isISODate((item as DiaryEntry).date) && validMeal((item as DiaryEntry).meal) && hasNumbers(item, ['calories', 'protein', 'carbs', 'fat']) && isOptionalTime(item) && isOptionalNonNegativeNumber(item, 'grams') && isOptionalIdentifier(item, 'foodId') && isOptionalIdentifier(item, 'catalogId') && isOptionalCatalogSource(item)) &&
    candidate.foods.every((item) => hasStrings(item, ['id', 'name', 'serving', 'createdAt', 'updatedAt']) && hasNumbers(item, ['calories', 'protein', 'carbs', 'fat'])) &&
    candidate.weights.every((item) => hasStrings(item, ['id', 'date', 'unit', 'createdAt']) && isISODate((item as WeightEntry).date) && validUnit((item as WeightEntry).unit) && Number.isFinite((item as WeightEntry).weight) && (item as WeightEntry).weight > 0) &&
    candidate.settings.length <= 1 && candidate.settings.every((item) => hasStrings(item, ['id', 'updatedAt']) && (item as Settings).id === 'profile' && validGoals((item as Settings).goals))
}
