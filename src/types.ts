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
  /** Logged ahead of time and not eaten yet. Missing means eaten; planned entries never count toward totals. */
  planned?: boolean
  /** How many servings the nutrition snapshot below already covers. Missing means one. */
  servings?: number
  /** Extra nutrients. Missing means "not recorded", never zero. Fiber, sugar and saturated fat are grams; sodium and cholesterol are milligrams. */
  fiber?: number
  sodium?: number
  sugar?: number
  satFat?: number
  cholesterol?: number
  createdAt: string
  updatedAt: string
}

/** One line of a recipe: the nutrition of the quantity used, as a snapshot, so later edits to a saved food never change the recipe. */
export interface RecipeIngredient {
  name: string
  calories: number
  protein: number
  carbs: number
  fat: number
  /** Servings of the source food, when the line came from one. */
  quantity?: number
  foodId?: string
}

export interface Food {
  id: string
  name: string
  serving: string
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber?: number
  sodium?: number
  sugar?: number
  satFat?: number
  cholesterol?: number
  /** Pinned to the top of quick lists. Missing means not a favorite. */
  favorite?: boolean
  /** Present on a recipe: how it was built. The macros above are per serving. */
  ingredients?: RecipeIngredient[]
  /** How many servings the recipe's ingredients make. */
  recipeServings?: number
  createdAt: string
  updatedAt: string
}

export interface WeightEntry {
  id: string
  date: string
  weight: number
  unit: 'lb' | 'kg'
  note?: string
  /** Body fat percentage from a scale or caliper. Missing means not recorded. */
  bodyFat?: number
  createdAt: string
  /** Added for sync conflict resolution; absent on weights saved before cloud sync existed. */
  updatedAt?: string
}

export interface Goals {
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
  weightUnit: 'lb' | 'kg'
}

/** Display choices. Every field is optional: a missing value means the default, never a stored zero. */
export interface Preferences {
  theme?: 'system' | 'light' | 'dark'
  macroDisplay?: 'grams' | 'percent'
  /** Reminder times as "HH:MM". A missing kind means that reminder is off. */
  reminders?: Partial<Record<'logFood' | 'weighIn', string>>
  /** Opt-in: look barcodes up on Open Food Facts, which sends the number to a third party. Missing means off. */
  barcodeLookup?: boolean
}

/** The goal behind the daily budget. Every field is optional: missing means "not set". */
export interface Program {
  direction?: 'lose' | 'maintain' | 'gain'
  goalWeight?: number
  /** Weight change per week, as a positive amount in the goal weight's unit. */
  weeklyRate?: number
  /** Grams of protein per pound of body weight (or per kilogram when the weight unit is kg). */
  proteinPerWeight?: number
  /** 0 = Sunday ... 6 = Saturday. */
  checkInDay?: number
  /** Date of the last accepted weekly check-in. */
  lastCheckIn?: string
}

export interface Settings {
  id: 'profile'
  goals: Goals
  /** Added after the first release; absent on older records and ignored by older builds. */
  preferences?: Preferences
  program?: Program
  updatedAt: string
}

/** Water drunk on one day, in millilitres. One record per day; its id is the date. Local and backup only: not synced yet. */
export interface WaterLog {
  id: string
  date: string
  ml: number
  createdAt: string
  updatedAt: string
}

/** Body measurements taken on one day. Each is optional: missing means not measured. One record per day; its id is the date. */
export interface BodyMeasurement {
  id: string
  date: string
  unit: 'in' | 'cm'
  waist?: number
  hips?: number
  chest?: number
  arm?: number
  thigh?: number
  createdAt: string
  updatedAt: string
}

export interface BackupPayload {
  format: 'nutrienttrack-backup'
  version: 2
  exportedAt: string
  entries: DiaryEntry[]
  foods: Food[]
  weights: WeightEntry[]
  settings: Settings[]
  water: WaterLog[]
  measurements: BodyMeasurement[]
}

export interface MacroTotals {
  calories: number
  protein: number
  carbs: number
  fat: number
}
