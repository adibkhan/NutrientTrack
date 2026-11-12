/** USDA FoodData Central nutrition values are per 100 g of edible food. */
export interface CatalogFood {
  id: string
  fdcId: number
  name: string
  category: string
  source: 'USDA SR Legacy' | 'USDA Foundation' | 'USDA Branded'
  per100g: {
    calories: number
    protein: number
    carbs: number
    fat: number
  }
  /** USDA household measures as [label, grams], e.g. ["1 medium (7\" to 7-7/8\" long)", 118]. Catalog v2 and later. */
  portions?: Array<[string, number]>
  /** Branded foods only (src/catalog/branded.ts): the brand and the 14-digit GTIN. */
  brand?: string
  gtin?: string
  /** Branded liquids: per100g means per 100 ml and portions are millilitres. */
  unit?: 'ml'
  /** Branded: the label rounds a serving to zero calories, so per 100 g is not reliable. */
  labelRounded?: boolean
}
