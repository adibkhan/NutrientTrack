export type MacroKey = 'protein' | 'carbs' | 'fat'

export type View = 'diary' | 'trends' | 'foods' | 'settings'

export type MealCategory = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other'

export interface DiaryEntry {
  id: string
  date: string
  meal: MealCategory
  name: string
  calories: number
  protein: number
  carbs: number
  fat: number
  foodId?: string
  /** Optional local wall-clock time, kept separate from the ISO audit timestamps. */
  time?: string
  /** Snapshot metadata for entries created from the bundled catalog. */
  grams?: number
  catalogId?: string
  catalogSource?: 'USDA SR Legacy' | 'USDA Foundation'
  createdAt: string
  updatedAt: string
}

export interface Food {
  id: string
  name: string
  serving: string
  calories: number
  protein: number
  carbs: number
  fat: number
  createdAt: string
  updatedAt: string
}

export interface WeightEntry {
  id: string
  date: string
  weight: number
  unit: 'lb' | 'kg'
  note?: string
  createdAt: string
}

export interface Goals {
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
  weightUnit: 'lb' | 'kg'
}

export interface Settings {
  id: 'profile'
  goals: Goals
  updatedAt: string
}

export interface BackupPayload {
  format: 'nutrienttrack-backup'
  version: 1
  exportedAt: string
  entries: DiaryEntry[]
  foods: Food[]
  weights: WeightEntry[]
  settings: Settings[]
}

export interface MacroTotals {
  calories: number
  protein: number
  carbs: number
  fat: number
}
