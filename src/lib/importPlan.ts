import type { DiaryEntry, WeightEntry } from '../types'
import { dropExistingDuplicates } from './foodSearch'
import type { ImportedEntry, ImportedWeight } from './importers'
import { isValidSyncRecord } from './backup'

/** Name given to a day's total when it comes from a per-day summary instead of individual foods. */
export const MACROFACTOR_DAY_TOTAL = 'MacroFactor day total'
type Marked = { name: string; importedFrom?: string; importedKind?: string }
const isDayTotal = (entry: Marked) => entry.importedFrom === 'macrofactor' && (entry.importedKind === 'day-total' || entry.name === MACROFACTOR_DAY_TOTAL)

/**
 * A day total never joins a day that has foods: drop totals for days that have a food entry in `entries`
 * or on one of the `busyDays` (days already logged in the diary), and keep only the first total of a day.
 * Returns what is left and how many totals were dropped.
 */
export const dropCoveredDayTotals = <T extends { date: string } & Marked>(entries: T[], busyDays: Set<string> = new Set()): { kept: T[]; dropped: number } => {
  const foodDays = new Set(entries.filter((entry) => !isDayTotal(entry)).map((entry) => entry.date))
  const totalDays = new Set<string>()
  let dropped = 0
  const kept = entries.filter((entry) => {
    if (!isDayTotal(entry)) return true
    if (foodDays.has(entry.date) || busyDays.has(entry.date) || totalDays.has(entry.date)) { dropped += 1; return false }
    totalDays.add(entry.date)
    return true
  })
  return { kept, dropped }
}

export interface ImportPlan {
  entries: DiaryEntry[]
  weights: WeightEntry[]
  /** Imported foods that are already in the diary. */
  duplicates: number
  /** Weigh-ins dropped because that day already has one. */
  duplicateWeights: number
  /** MacroFactor day totals dropped because the day already has foods or another total. */
  coveredDays: number
  /** Earlier imported day totals that the foods now being added replace; deleted in the same save. */
  replaced: DiaryEntry[]
  /** Records the sync rules reject (for example a name that is too long); counted as unreadable, not as duplicates. */
  rejected: number
}

/** A day whose only eaten entries are untouched day totals from an earlier import: foods for that day replace them. */
const replaceableTotals = (existing: DiaryEntry[], foodDays: Set<string>): DiaryEntry[] => {
  const byDay = new Map<string, DiaryEntry[]>()
  for (const entry of existing) if (!entry.planned) byDay.set(entry.date, [...(byDay.get(entry.date) ?? []), entry])
  const out: DiaryEntry[] = []
  for (const day of foodDays) {
    const entries = byDay.get(day)
    // Only totals this importer wrote and the person has not edited since; anything they logged themselves stays.
    if (entries?.length && entries.every((entry) => isDayTotal(entry) && entry.updatedAt === entry.createdAt)) out.push(...entries)
  }
  return out
}

/**
 * What an import will actually add. Never overwrites what the person logged: ids and entries already here are set aside (one for one),
 * the first weigh-in of a day wins and an existing weigh-in keeps its day, and a day total never joins a day that has foods.
 * The one exception is an earlier imported day total, which the same day's foods replace.
 */
export const planImport = (imported: ImportedEntry[], importedWeights: ImportedWeight[], existing: { entries: DiaryEntry[]; weights: WeightEntry[] }, timestamp: string): ImportPlan => {
  const { fresh, duplicates } = dropExistingDuplicates(imported, existing.entries)
  const incomingFoodDays = new Set(fresh.filter((entry) => !isDayTotal(entry)).map((entry) => entry.date))
  const replaced = replaceableTotals(existing.entries, incomingFoodDays)
  const replacedIds = new Set(replaced.map((entry) => entry.id))
  const busyDays = new Set(existing.entries.filter((entry) => !entry.planned && !replacedIds.has(entry.id)).map((entry) => entry.date))
  const { kept, dropped } = dropCoveredDayTotals(fresh, busyDays)
  const entries = kept
    .map((entry): DiaryEntry => ({ ...entry, createdAt: timestamp, updatedAt: timestamp }))
    .filter((entry) => isValidSyncRecord('entries', entry, entry.id))
  const weighedDays = new Set(existing.weights.map((weight) => weight.date))
  const weights: WeightEntry[] = []
  let duplicateWeights = 0
  let rejectedWeights = 0
  for (const weight of importedWeights) {
    if (weighedDays.has(weight.date)) { duplicateWeights += 1; continue }
    weighedDays.add(weight.date)
    const record: WeightEntry = { ...weight, createdAt: timestamp, updatedAt: timestamp }
    if (isValidSyncRecord('weights', record, record.id)) weights.push(record)
    else rejectedWeights += 1
  }
  // A replaced total only goes when something now takes its place.
  const keptDays = new Set(entries.map((entry) => entry.date))
  const replacedFinal = replaced.filter((entry) => keptDays.has(entry.date))
  return { entries, weights, duplicates, duplicateWeights, coveredDays: dropped, replaced: replacedFinal, rejected: kept.length - entries.length + rejectedWeights }
}
