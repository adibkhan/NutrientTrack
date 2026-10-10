/** USDA FoodData Central nutrition values are per 100 g of edible food. */
export interface CatalogFood {
  id: string
  fdcId: number
  name: string
  category: string
  source: 'USDA SR Legacy' | 'USDA Foundation'
  per100g: {
    calories: number
    protein: number
    carbs: number
    fat: number
  }
  /** USDA household measures as [label, grams], e.g. ["1 medium (7\" to 7-7/8\" long)", 118]. Catalog v2 and later. */
  portions?: Array<[string, number]>
}
