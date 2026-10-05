import type { DiaryEntry, Food, WeightEntry } from '../types'

type Cell = string | number | boolean | undefined | null

/**
 * One CSV cell, quoted when needed. Text that a spreadsheet would run as a formula (starting with = + - @ or a
 * control character) gets a leading apostrophe so an imported food name can never execute. Numbers are written as is.
 */
export const csvCell = (value: Cell): string => {
  if (value === undefined || value === null) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** Rows as CSV with a header, CRLF line ends and a byte-order mark so Excel reads UTF-8 names correctly. */
export const toCsv = <T extends object>(rows: T[], columns: Array<{ key: string; header: string }>): string => {
  const lines = [columns.map((column) => csvCell(column.header)).join(',')]
  for (const row of rows) lines.push(columns.map((column) => csvCell((row as Record<string, unknown>)[column.key] as Cell)).join(','))
  return `﻿${lines.join('\r\n')}\r\n`
}

const byDateThenTime = (a: { date: string; time?: string }, b: { date: string; time?: string }) =>
  a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '')

export const entriesCsv = (entries: DiaryEntry[]): string =>
  toCsv(entries.slice().sort(byDateThenTime), [
    { key: 'date', header: 'Date' },
    { key: 'time', header: 'Time' },
    { key: 'meal', header: 'Meal' },
    { key: 'name', header: 'Food' },
    { key: 'grams', header: 'Grams' },
    { key: 'calories', header: 'Calories' },
    { key: 'protein', header: 'Protein (g)' },
    { key: 'carbs', header: 'Carbs (g)' },
    { key: 'fat', header: 'Fat (g)' },
    { key: 'fiber', header: 'Fiber (g)' },
    { key: 'sodium', header: 'Sodium (mg)' },
    { key: 'sugar', header: 'Sugar (g)' },
    { key: 'satFat', header: 'Saturated fat (g)' },
    { key: 'cholesterol', header: 'Cholesterol (mg)' },
    { key: 'planned', header: 'Planned' },
  ])

export const weightsCsv = (weights: WeightEntry[]): string =>
  toCsv(weights.slice().sort((a, b) => a.date.localeCompare(b.date)), [
    { key: 'date', header: 'Date' },
    { key: 'weight', header: 'Weight' },
    { key: 'unit', header: 'Unit' },
    { key: 'bodyFat', header: 'Body fat (%)' },
    { key: 'note', header: 'Note' },
  ])

export const foodsCsv = (foods: Food[]): string =>
  toCsv(foods.slice().sort((a, b) => a.name.localeCompare(b.name)), [
    { key: 'name', header: 'Food' },
    { key: 'serving', header: 'Serving' },
    { key: 'calories', header: 'Calories' },
    { key: 'protein', header: 'Protein (g)' },
    { key: 'carbs', header: 'Carbs (g)' },
    { key: 'fat', header: 'Fat (g)' },
    { key: 'fiber', header: 'Fiber (g)' },
    { key: 'sodium', header: 'Sodium (mg)' },
    { key: 'sugar', header: 'Sugar (g)' },
    { key: 'satFat', header: 'Saturated fat (g)' },
    { key: 'cholesterol', header: 'Cholesterol (mg)' },
    { key: 'favorite', header: 'Favorite' },
  ])

/** Hand a text file to the browser's download flow. */
export const downloadTextFile = (filename: string, text: string, type = 'text/csv;charset=utf-8'): void => {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
