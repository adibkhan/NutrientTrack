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
}
