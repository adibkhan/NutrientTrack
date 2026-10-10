// @vitest-environment node
// The static food pages (scripts/build-food-pages.mjs): one page per catalog food, safe HTML, and links back into the app.
import { describe, expect, it } from 'vitest'

type Food = { id: string; fdcId: number; name: string; category: string; source: string; per100g: { calories: number; protein: number; carbs: number; fat: number }; portions?: Array<[string, number]> }
type PagesModule = { buildPages: (catalog: Food[]) => Map<string, string>; slugify: (value: string) => string; sitemapFor: (paths: string[]) => string }
const scriptPath = '../scripts/build-food-pages.mjs'
const load = () => import(/* @vite-ignore */ scriptPath) as Promise<PagesModule>

const food = (over: Partial<Food>): Food => ({ id: 'usda-sr-1', fdcId: 1, name: 'Bananas, raw', category: 'Fruits and Fruit Juices', source: 'USDA SR Legacy', per100g: { calories: 89, protein: 1.09, carbs: 22.84, fat: 0.33 }, ...over })

describe('static food pages', () => {
  it('slugs_names_for_urls', async () => {
    const { slugify } = await load()
    expect(slugify('Bananas, raw')).toBe('bananas-raw')
    expect(slugify('Milk, reduced fat, 2% milkfat')).toBe('milk-reduced-fat-2-percent-milkfat')
    expect(slugify('Crème fraîche')).toBe('creme-fraiche')
  })

  it('writes_a_food_page_per_food_plus_category_and_directory_pages_with_unique_paths', async () => {
    const { buildPages } = await load()
    const pages = buildPages([
      food({ portions: [['1 cup, mashed', 225], ['1 medium (7" to 7-7/8" long)', 118]] }),
      food({ id: 'usda-sr-2', fdcId: 2, name: 'Bananas, raw' }),
      food({ id: 'usda-sr-3', fdcId: 3, name: 'Beef, <script>alert(1)</script>', category: 'Beef Products' }),
    ])
    expect([...pages.keys()].sort()).toEqual([
      '/foods/',
      '/foods/beef-products/',
      '/foods/beef-products/beef-script-alert-1-script/',
      '/foods/fruits-and-fruit-juices/',
      '/foods/fruits-and-fruit-juices/bananas-raw-2/',
      '/foods/fruits-and-fruit-juices/bananas-raw/',
    ])
    const banana = pages.get('/foods/fruits-and-fruit-juices/bananas-raw/') as string
    expect(banana).toContain('<h1>Calories in Bananas, raw</h1>')
    expect(banana).toContain('Per medium (118 g)')
    expect(banana).toContain('href="/?log=usda-sr-1"')
    expect(banana).toContain('<link rel="canonical" href="https://nutrienttrack.com/foods/fruits-and-fruit-juices/bananas-raw/">')
    expect(banana).not.toMatch(/<script(?! type="application\/ld\+json")/)
    const beef = pages.get('/foods/beef-products/beef-script-alert-1-script/') as string
    expect(beef).not.toContain('<script>alert')
    expect(beef).toContain('&lt;script&gt;')
  })

  it('lists_every_page_in_the_sitemap', async () => {
    const { sitemapFor } = await load()
    const xml = sitemapFor(['/foods/', '/foods/a/'])
    expect(xml).toContain('<loc>https://nutrienttrack.com/</loc>')
    expect(xml).toContain('<loc>https://nutrienttrack.com/foods/a/</loc>')
    expect(xml).toContain('<loc>https://nutrienttrack.com/recipe-calories/</loc>')
  })
})
