// Branded foods in the logger: the Brands group, stale results, the offline note, the detail form on the label serving, the plate,
// what is saved, a typed barcode, a deep link, and re-logging offline from history. The branded client is faked; the app runs for real.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import catalogText from '../public/data/usda-common-v2.json?raw'
import tableText from '../public/data/usda-nutrients-v1.json?raw'
import type { BrandedProduct, BrandedSummary } from './catalog/branded'
import type { DiaryEntry, Settings } from './types'
import { NUTRIENT_KEYS } from './lib/nutrients'
import { resetCatalogNutrients } from './catalog/nutrients'

const hoisted = vi.hoisted(() => ({
  client: { searchBranded: vi.fn(), lookupBarcode: vi.fn(), getProduct: vi.fn(), loadManifest: vi.fn(), lastReason: vi.fn(), reset: vi.fn(), stats: { requests: 0, bytes: 0, fullPackFallbacks: 0 } },
}))
vi.mock('./catalog/branded', async (importOriginal) => ({ ...(await importOriginal<typeof import('./catalog/branded')>()), createBrandedClient: () => hoisted.client }))
vi.mock('./lib/db', () => ({
  getWaterLogs: vi.fn(() => Promise.resolve([])), getSymptoms: vi.fn(() => Promise.resolve([])), saveSymptom: vi.fn(), deleteSymptom: vi.fn(), getMeasurements: vi.fn(() => Promise.resolve([])), saveWaterLog: vi.fn(), deleteWaterLog: vi.fn(), saveMeasurement: vi.fn(), deleteMeasurement: vi.fn(),
  deleteEntry: vi.fn(), deleteEntries: vi.fn(), deleteFood: vi.fn(), deleteWeight: vi.fn(), exportBackup: vi.fn(), clearAllData: vi.fn(),
  getEntries: vi.fn(), getFoods: vi.fn(), getSettings: vi.fn(), getWeights: vi.fn(), importBackup: vi.fn(),
  requestPersistentStorage: vi.fn(), onDatabaseEvent: vi.fn(() => () => undefined), onLocalChange: vi.fn(() => () => undefined),
  saveEntries: vi.fn(), saveEntry: vi.fn(), saveFood: vi.fn(), saveSettings: vi.fn(), saveWeight: vi.fn(),
}))

import * as db from './lib/db'
import App from './App'

const m = vi.mocked(db)
const search = hoisted.client.searchBranded
const lookup = hoisted.client.lookupBarcode
const getProduct = hoisted.client.getProduct
vi.setConfig({ testTimeout: 30000 })
const stamp = '2026-01-01T00:00:00.000Z'
const welcomed: Settings = { id: 'profile', goals: { weightUnit: 'lb' }, preferences: { welcomed: true }, updatedAt: stamp }
const respond = (body: string) => new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } })
let entries: DiaryEntry[]

const CHOBANI: BrandedProduct = {
  gtin: '00012345678905', fdcId: 1001, name: 'Vanilla Greek Yogurt', brand: 'Chobani', category: 'Yogurt',
  serving: { size: 150, unit: 'g', household: '1 container', label: '1 container (150 g)' },
  per100: { calories: 80, protein: 9.3, fat: 0, carbs: 10 },
  nutrients: { sugar: 8, sodium: 40, calcium: 120, cholesterol: 2 },
  addedSugar: 5.3,
}
const OREO: BrandedProduct = {
  gtin: '00044000032029', fdcId: 1002, name: 'Chocolate Sandwich Cookies', brand: 'Oreo', category: 'Cookies',
  serving: { size: 34, unit: 'g', household: '3 cookies', label: '3 cookies (34 g)' },
  per100: { calories: 471, protein: 4.4, fat: 20.6, carbs: 70.6 },
  nutrients: { sodium: 382, sugar: 38.2 },
}
const summary = (p: BrandedProduct, query = ''): BrandedSummary => ({ gtin: p.gtin, name: p.name, brand: p.brand, kcal: p.per100.calories, serving: p.serving?.label ?? '', query, ...(p.serving?.unit === 'ml' ? { unit: 'ml' as const } : {}) })
/** The client answers with rows that carry the query they answer. */
const echo = (rows: Array<Omit<BrandedSummary, 'query'>>) => async (query: string) => rows.map((row) => ({ ...row, query }))
const PRODUCTS = [CHOBANI, OREO]
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }

beforeEach(() => {
  resetCatalogNutrients()
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: () => Promise.resolve(false) } })
  localStorage.clear()
  window.history.replaceState(null, '', '/')
  entries = []
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(respond(String(url).includes('usda-nutrients') ? tableText : catalogText))))
  m.getEntries.mockImplementation(async () => entries)
  m.getFoods.mockResolvedValue([])
  m.getWeights.mockResolvedValue([])
  m.getSettings.mockResolvedValue(welcomed)
  m.saveEntry.mockResolvedValue(undefined)
  m.saveEntries.mockImplementation(async (copies) => { entries = [...entries, ...copies] })
  m.onDatabaseEvent.mockImplementation(() => () => undefined)
  m.onLocalChange.mockImplementation(() => () => undefined)
  search.mockImplementation(async (query: string) => PRODUCTS.filter((p) => `${p.brand} ${p.name}`.toLowerCase().includes(query.trim().toLowerCase().split(' ')[0])).map((p) => summary(p, query)))
  lookup.mockImplementation(async (code: string) => PRODUCTS.find((p) => p.gtin.endsWith(String(code).replace(/\D/g, ''))))
  getProduct.mockImplementation(async (gtin: string) => PRODUCTS.find((p) => p.gtin === gtin))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  search.mockReset(); lookup.mockReset(); getProduct.mockReset()
  vi.resetAllMocks()
})

async function openLogger() {
  const user = userEvent.setup()
  render(<App />)
  await user.click((await screen.findAllByRole('button', { name: 'Log food' }))[0])
  await screen.findByRole('dialog')
  return user
}
const dialog = () => screen.getByRole('dialog')
async function typeQuery(user: ReturnType<typeof userEvent.setup>, text: string) {
  const box = within(dialog()).getByRole('textbox', { name: 'Search foods' })
  await user.clear(box)
  await user.type(box, text)
}
const brandsGroup = () => dialog().querySelector('.branded-result-group') as HTMLElement | null
const catalogGroup = () => dialog().querySelector('.catalog-result-group') as HTMLElement
/** Where a result group sits on screen: the Brands group is rendered once and moved with CSS order, so it never remounts. */
const order = (element: HTMLElement) => Number(element.style.order)
const saved = () => m.saveEntry.mock.calls[0][0] as DiaryEntry & Record<string, unknown>

describe('the Brands group', () => {
  it('shows brand rows with name, brand and kcal per serving under the generic USDA results', async () => {
    const user = await openLogger()
    await typeQuery(user, 'yogurt')
    // "yogurt" is not a brand word and the catalog has yogurt, so generic foods stay above the brands.
    search.mockImplementation(echo([summary(CHOBANI)]))
    await typeQuery(user, 'yogurt')
    const group = await waitFor(() => { const g = brandsGroup(); expect(g).not.toBeNull(); expect(within(g as HTMLElement).getByText('Vanilla Greek Yogurt')).toBeTruthy(); return g as HTMLElement })
    expect(within(group).getByText('Chobani')).toBeTruthy()
    expect(within(group).getByText('120 kcal per serving · 1 container (150 g)')).toBeTruthy()
    await waitFor(() => expect(within(catalogGroup()).getAllByRole('button').length).toBeGreaterThan(0))
    expect(order(catalogGroup())).toBeLessThan(order(group))
  })

  it('says per 100 g when the label has no serving', async () => {
    search.mockImplementation(echo([{ gtin: '00000000012345', name: 'Mystery Powder', brand: 'Acme', kcal: 380, serving: '' }]))
    const user = await openLogger()
    await typeQuery(user, 'mystery')
    expect(await within(dialog()).findByText('380 kcal per 100 g')).toBeTruthy()
  })

  it('puts the brands above weak generic results when the first word typed is a brand', async () => {
    const user = await openLogger()
    await typeQuery(user, 'chobani vanilla')
    await waitFor(() => expect(brandsGroup()).not.toBeNull())
    await within(dialog()).findByText('Vanilla Greek Yogurt')
    await waitFor(() => expect(catalogGroup().querySelector('.loading-spinner')).toBeNull())
    expect(order(brandsGroup()!)).toBeLessThan(order(catalogGroup()))
  })

  it('does not search brands under three characters and shows nothing for them', async () => {
    const user = await openLogger()
    await typeQuery(user, 'ch')
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(search).not.toHaveBeenCalled()
    expect(brandsGroup()).toBeNull()
  })

  it('debounces: one search for a fast burst of typing, with the final text', async () => {
    const user = await openLogger()
    await user.type(within(dialog()).getByRole('textbox', { name: 'Search foods' }), 'chobani')
    await waitFor(() => expect(search).toHaveBeenCalled())
    expect(search).toHaveBeenCalledTimes(1)
    expect(search.mock.calls[0][0]).toBe('chobani')
    expect(search.mock.calls[0][1]).toMatchObject({ latestOnly: true })
  })

  it('never renders the answer to an earlier keystroke, and aborts that search', async () => {
    const slow = deferred<BrandedSummary[]>()
    const fast = deferred<BrandedSummary[]>()
    search.mockReset()
    search.mockImplementationOnce(() => slow.promise).mockImplementationOnce(() => fast.promise)
    const user = await openLogger()
    const box = within(dialog()).getByRole('textbox', { name: 'Search foods' })
    await user.type(box, 'chob')
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1))
    await user.type(box, 'ani')
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2))
    expect((search.mock.calls[0][1] as { signal: AbortSignal }).signal.aborted).toBe(true)
    fast.resolve([summary(CHOBANI, 'chobani')])
    expect(await within(dialog()).findByText('Vanilla Greek Yogurt')).toBeTruthy()
    slow.resolve([{ gtin: '00000000000099', name: 'STALE ROW', brand: 'Old', kcal: 1, serving: '', query: 'chob' }])
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(within(dialog()).queryByText('STALE ROW')).toBeNull()
    expect(within(dialog()).getByText('Vanilla Greek Yogurt')).toBeTruthy()
  })

  it('lists 8 rows, then Show more up to 30', async () => {
    const many = Array.from({ length: 40 }, (_, i): Omit<BrandedSummary, 'query'> => ({ gtin: String(1000 + i).padStart(14, '0'), name: `Granola ${i}`, brand: 'Bear', kcal: 400, serving: '1 cup (50 g)' }))
    search.mockImplementation(echo(many.slice(0, 30)))
    const user = await openLogger()
    await typeQuery(user, 'granola')
    await within(dialog()).findByText('Granola 0')
    expect(within(brandsGroup()!).getAllByRole('button', { name: /^Add Bear Granola/ })).toHaveLength(8)
    await user.click(within(brandsGroup()!).getByRole('button', { name: 'Show 22 more' }))
    expect(within(brandsGroup()!).getAllByRole('button', { name: /^Add Bear Granola/ })).toHaveLength(30)
  })

  it('offline: one quiet note in the group, generic results keep working, no alert and no blocking spinner', async () => {
    search.mockImplementation(async (_query: string, options?: { onReason?: (reason: string) => void }) => { options?.onReason?.('offline'); return [] })
    const user = await openLogger()
    await typeQuery(user, 'banana')
    expect(await within(dialog()).findByText('Brand search needs a connection')).toBeTruthy()
    await waitFor(() => expect(within(catalogGroup()).getAllByRole('button').length).toBeGreaterThan(0))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(brandsGroup()!.querySelector('.loading-spinner')).toBeNull()
  })

  it('a connection that cannot do range requests says so, above the generic results', async () => {
    search.mockImplementation(async (_query: string, options?: { onReason?: (reason: string) => void }) => { options?.onReason?.('range-unsupported'); return [] })
    const user = await openLogger()
    await typeQuery(user, 'banana')
    expect(await within(dialog()).findByText("Brand search isn't available on this connection")).toBeTruthy()
    await waitFor(() => expect(within(catalogGroup()).getAllByRole('button').length).toBeGreaterThan(0))
    expect(order(brandsGroup()!)).toBeLessThan(order(catalogGroup()))
  })

  it('stale and aborted answers are silent', async () => {
    for (const reason of ['stale', 'aborted']) {
      search.mockImplementation(async (_query: string, options?: { onReason?: (reason: string) => void }) => { options?.onReason?.(reason); return [] })
      const user = await openLogger()
      await typeQuery(user, 'banana')
      await waitFor(() => expect(search).toHaveBeenCalled())
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(within(dialog()).queryByText(/Brand search/)).toBeNull()
      cleanup()
      search.mockReset()
    }
  })

  it('shows N sizes on a row and the size picker in the detail form', async () => {
    const BIG = { ...CHOBANI, gtin: '00012345678912', serving: { size: 227, unit: 'g' as const, household: '1 tub', label: '1 tub (227 g)' } }
    search.mockImplementation(echo([{ ...summary(CHOBANI), sizes: 2, variants: [CHOBANI.gtin, BIG.gtin] }]))
    getProduct.mockImplementation(async (gtin: string) => [CHOBANI, BIG].find((p) => p.gtin === gtin))
    const user = await openLogger()
    await typeQuery(user, 'chobani')
    expect(await within(dialog()).findByText(/2 sizes/)).toBeTruthy()
    await user.click(await within(dialog()).findByText('Vanilla Greek Yogurt'))
    expect(await within(dialog()).findByRole('button', { name: '1 tub (227 g)' })).toBeTruthy()
  })

  it('logs a liquid in ml', async () => {
    const COKE: BrandedProduct = { gtin: '00049000028911', fdcId: 3, name: 'Cola', brand: 'Coke', category: 'Soda', serving: { size: 355, unit: 'ml', household: '1 can', label: '1 can (355 ml)' }, per100: { calories: 42, protein: 0, fat: 0, carbs: 10.6 }, nutrients: {} }
    search.mockImplementation(echo([summary(COKE)]))
    getProduct.mockResolvedValue(COKE)
    const user = await openLogger()
    await typeQuery(user, 'coke')
    await user.click(await within(dialog()).findByText('Cola'))
    expect(await within(dialog()).findByRole('button', { name: '10 ml more' })).toBeTruthy()
    await user.click(within(dialog()).getByRole('button', { name: 'Add to diary' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalled())
    expect(saved()).toMatchObject({ grams: 355, unit: 'ml' }) // review L1
  })

  it('a label that rounds to zero logs by servings with a note', async () => {
    const ROUND: BrandedProduct = { gtin: '00049000028999', fdcId: 4, name: 'Zero Spray', brand: 'Acme', category: 'Oil', serving: { size: 0.25, unit: 'g', household: '1 spray', label: '1 spray (0.25 g)' }, per100: { calories: 0, protein: 0, fat: 0, carbs: 0 }, nutrients: {}, labelRounded: true }
    search.mockImplementation(echo([{ ...summary(ROUND), kcal: 0 }]))
    getProduct.mockResolvedValue(ROUND)
    const user = await openLogger()
    await typeQuery(user, 'zero spray')
    await user.click(await within(dialog()).findByText('Zero Spray'))
    expect(await within(dialog()).findByText(/Label rounds to zero; per 100 g isn't reliable/)).toBeTruthy()
  })

  it('an absurdly large label serving defaults to 100 g', async () => {
    const HUGE: BrandedProduct = { ...OREO, gtin: '00044000032999', name: 'Huge Cookies', serving: { size: 1500, unit: 'g', household: '1 box', label: '1 box (1500 g)' } }
    search.mockImplementation(echo([summary(HUGE)]))
    getProduct.mockResolvedValue(HUGE)
    const user = await openLogger()
    await typeQuery(user, 'oreo')
    await user.click(await within(dialog()).findByText('Huge Cookies'))
    await waitFor(() => expect((within(dialog()).getByLabelText('Amount') as HTMLInputElement).value).toBe('100'))
  })

  it('review H3: a seasoning with a 0.7 g serving is logged by servings, never as 100 g (Lawry\'s lemon pepper)', async () => {
    const PEPPER: BrandedProduct = { gtin: '00072320001159', fdcId: 5, name: 'Lemon Pepper', brand: "Lawry's", category: 'Spices', serving: { size: 0.7, unit: 'g', household: '1/4 tsp', label: '1/4 tsp (0.7 g)' }, per100: { calories: 250, protein: 10, fat: 5, carbs: 50 }, nutrients: { sodium: 20000 } }
    search.mockImplementation(echo([summary(PEPPER)]))
    getProduct.mockResolvedValue(PEPPER)
    const user = await openLogger()
    await typeQuery(user, 'lawrys lemon pepper')
    await user.click(await within(dialog()).findByText('Lemon Pepper'))
    expect(await within(dialog()).findByText(/One serving: 1\/4 tsp \(0\.7 g\)/)).toBeTruthy()
    expect(within(dialog()).queryByLabelText('Amount')).toBeNull()
    expect(within(dialog()).getByText('Packaged food')).toBeTruthy()
    await user.click(within(dialog()).getByRole('button', { name: 'Add to diary' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalled())
    expect(saved().sodium).toBeCloseTo(140, 0)
    expect(saved().grams).toBe(0.7)
  })

  it('review H3: "+" on the same seasoning puts one serving on the plate, not 100 g', async () => {
    const PEPPER: BrandedProduct = { gtin: '00072320001159', fdcId: 5, name: 'Lemon Pepper', brand: "Lawry's", category: 'Spices', serving: { size: 0.7, unit: 'g', household: '1/4 tsp', label: '1/4 tsp (0.7 g)' }, per100: { calories: 250, protein: 10, fat: 5, carbs: 50 }, nutrients: { sodium: 20000 } }
    search.mockImplementation(echo([summary(PEPPER)]))
    getProduct.mockResolvedValue(PEPPER)
    const user = await openLogger()
    await typeQuery(user, 'lawrys lemon pepper')
    await user.click(await within(dialog()).findByRole('button', { name: /^Add Lawry's Lemon Pepper to plate/ }))
    await user.click(await within(dialog()).findByRole('button', { name: /^Log 1 food/ }))
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalled())
    const entry = (m.saveEntries.mock.calls[0][0] as unknown as Array<Record<string, number>>)[0]
    expect(entry.grams).toBe(0.7)
    expect(entry.sodium).toBeCloseTo(140, 0)
  })

  it('shows no Brands group when the search finds nothing', async () => {
    search.mockResolvedValue([])
    const user = await openLogger()
    await typeQuery(user, 'zzzqqq')
    await waitFor(() => expect(search).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(brandsGroup()).toBeNull()
  })

  it('keeps long brand and product names inside the row (they wrap)', async () => {
    search.mockImplementation(echo([{ gtin: '00000000054321', name: 'Extra Creamy Salted Caramel Almond Milk Frozen Dessert Bars', brand: 'The Very Long Named Artisanal Dessert Company International', kcal: 190, serving: '1 bar (60 g)' }]))
    const user = await openLogger()
    await typeQuery(user, 'caramel')
    const copy = (await within(dialog()).findByText(/The Very Long Named/)).closest('.result-copy') as HTMLElement
    expect(copy.classList.contains('branded-copy')).toBe(true)
  })
})

describe('the Brands group while typing (review M2, M3, M6, L5, L6)', () => {
  it('keeps the earlier rows, dimmed, while a newer search loads, and replaces them in place', async () => {
    const first = deferred<BrandedSummary[]>()
    search.mockImplementation(async (query: string) => (query === 'chobani' ? [summary(CHOBANI, 'chobani')] : first.promise))
    const user = await openLogger()
    await typeQuery(user, 'chobani')
    await within(dialog()).findByText('Vanilla Greek Yogurt')
    const group = brandsGroup()!
    await user.type(within(dialog()).getByRole('textbox', { name: 'Search foods' }), ' v')
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2))
    expect(brandsGroup()).toBe(group) // the same element: nothing remounted or flipped
    expect(within(group).getByText('Vanilla Greek Yogurt')).toBeTruthy()
    expect(group.querySelector('.result-list')?.getAttribute('aria-busy')).toBe('true')
    expect(within(group).queryByText('Searching brands…')).toBeNull()
    first.resolve([{ ...summary(OREO, 'chobani v') }])
    await within(group).findByText('Chocolate Sandwich Cookies')
    expect(brandsGroup()).toBe(group)
    expect(group.querySelector('.result-list')?.getAttribute('aria-busy')).toBeNull()
  })

  it('reserves the place with a skeleton while the first answer loads', async () => {
    const slow = deferred<BrandedSummary[]>()
    search.mockImplementation(() => slow.promise)
    const user = await openLogger()
    await typeQuery(user, 'chobani')
    await waitFor(() => expect(brandsGroup()?.querySelectorAll('.brand-skeleton span').length).toBe(3))
    slow.resolve([summary(CHOBANI, 'chobani')])
    await within(dialog()).findByText('Vanilla Greek Yogurt')
    expect(brandsGroup()!.querySelector('.brand-skeleton')).toBeNull()
  })

  it('an empty answer for a half-typed word keeps the earlier rows for a moment, then clears them', async () => {
    search.mockImplementation(async (query: string) => (query === 'chobani' ? [summary(CHOBANI, 'chobani')] : []))
    const user = await openLogger()
    await typeQuery(user, 'chobani')
    await within(dialog()).findByText('Vanilla Greek Yogurt')
    await user.type(within(dialog()).getByRole('textbox', { name: 'Search foods' }), ' zzz')
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2), { timeout: 3000 })
    expect(within(dialog()).queryByText('Vanilla Greek Yogurt')).toBeTruthy()
    await waitFor(() => expect(within(dialog()).queryByText('Vanilla Greek Yogurt')).toBeNull(), { timeout: 3000 })
  })

  it('does not search brands for describe-style input', async () => {
    const user = await openLogger()
    await typeQuery(user, '2 eggs and a banana')
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(search).not.toHaveBeenCalled()
  })

  it('a slow search says so and offers a 44px Retry that searches again', async () => {
    let calls = 0
    search.mockImplementation(async (query: string, options?: { onReason?: (reason: string) => void }) => {
      calls += 1
      if (calls === 1) { options?.onReason?.('timeout'); return [] }
      return [summary(CHOBANI, query)]
    })
    const user = await openLogger()
    await typeQuery(user, 'chobani')
    expect(await within(dialog()).findByText('Brand search is slow right now. Try again')).toBeTruthy()
    await user.click(within(dialog()).getByRole('button', { name: 'Retry' }))
    expect(await within(dialog()).findByText('Vanilla Greek Yogurt')).toBeTruthy()
  })

  it('a second "+" on a row that is still loading queues one more; other rows load in parallel', async () => {
    const slow = deferred<BrandedProduct | undefined>()
    getProduct.mockImplementation((gtin: string) => (gtin === CHOBANI.gtin ? slow.promise : Promise.resolve(PRODUCTS.find((p) => p.gtin === gtin))))
    search.mockImplementation(echo([summary(CHOBANI), summary(OREO)]))
    const user = await openLogger()
    await typeQuery(user, 'chobani')
    const chobaniPlus = await within(dialog()).findByRole('button', { name: /^Add Chobani Vanilla Greek Yogurt to plate/ })
    await user.click(chobaniPlus)
    await user.click(chobaniPlus)
    await waitFor(() => expect(within(brandsGroup()!).getAllByRole('button').some((button) => button.getAttribute('aria-busy') === 'true')).toBe(true))
    await user.click(await within(dialog()).findByRole('button', { name: /^Add Oreo Chocolate Sandwich Cookies to plate/ }))
    await waitFor(() => expect(getProduct).toHaveBeenCalledTimes(2)) // both loads started before the first finished
    slow.resolve(CHOBANI)
    await user.click(await within(dialog()).findByRole('button', { name: /Add Chobani Vanilla Greek Yogurt to plate, 2 on plate/ }))
  })

  it('typing after tapping a cold row cancels the pending open', async () => {
    const slow = deferred<BrandedProduct | undefined>()
    getProduct.mockImplementation(() => slow.promise)
    const user = await openLogger()
    await typeQuery(user, 'chobani')
    await user.click(await within(dialog()).findByText('Vanilla Greek Yogurt'))
    await user.type(within(dialog()).getByRole('textbox', { name: 'Search foods' }), ' x')
    slow.resolve(CHOBANI)
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(within(dialog()).queryByLabelText('Amount')).toBeNull()
  })

  it('opening a generic food while a brand row loads is not overwritten when the brand arrives', async () => {
    const slow = deferred<BrandedProduct | undefined>()
    getProduct.mockImplementation(() => slow.promise)
    const user = await openLogger()
    await typeQuery(user, 'yogurt')
    search.mockImplementation(echo([summary(CHOBANI)]))
    await typeQuery(user, 'yogurt ')
    await user.click(await within(dialog()).findByText('Vanilla Greek Yogurt'))
    await user.click(within(catalogGroup()).getAllByRole('button', { name: /^(?!Add)/ })[0])
    slow.resolve(CHOBANI)
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(within(dialog()).queryByText(/Chobani Vanilla Greek Yogurt/)).toBeNull()
  })
})

describe('opening a brand row', () => {
  it('opens the detail form on the label serving with its calories and macros, and adds a tidy entry', async () => {
    const user = await openLogger()
    await typeQuery(user, 'chobani')
    const rowEl = await within(dialog()).findByText('Vanilla Greek Yogurt')
    await user.click(rowEl)
    await waitFor(() => expect(getProduct).toHaveBeenCalledWith('00012345678905', expect.anything()))
    expect((await within(dialog()).findByLabelText('Amount') as HTMLInputElement).value).toBe('150')
    const chip = within(dialog()).getByRole('button', { name: /^1 container/ })
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    expect(within(dialog()).getByText(/Chobani Vanilla Greek Yogurt/)).toBeTruthy()
    // The label serving is the first chip.
    expect(within(dialog()).getAllByRole('button', { name: /g$/ }).length).toBeGreaterThan(0)
    expect(within(dialog()).getByText('120')).toBeTruthy()
    await user.click(within(dialog()).getByRole('button', { name: 'Add to diary' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalled())
    const entry = saved()
    expect(entry).toMatchObject({ name: 'Chobani Vanilla Greek Yogurt', catalogId: 'usda-branded-00012345678905', grams: 150, calories: 120, protein: 14, carbs: 15, fat: 0 })
    // Label nutrients ride along; what the label lacks stays absent; added sugars has no field in the app.
    expect(entry.sodium).toBe(60)
    expect(entry.calcium).toBe(180)
    expect(entry.sugar).toBe(12)
    expect('iron' in entry).toBe(false)
    expect('addedSugar' in entry).toBe(false)
    // Older builds refuse a backup with any other source value, so none is written.
    expect('catalogSource' in entry).toBe(false)
    expect(entry.name.match(/Chobani/g)).toHaveLength(1)
  })

  it('changing the grams scales the label nutrients with the macros', async () => {
    const user = await openLogger()
    await typeQuery(user, 'chobani')
    await user.click(await within(dialog()).findByText('Vanilla Greek Yogurt'))
    const grams = (await within(dialog()).findByLabelText('Amount')) as HTMLInputElement
    fireEvent.change(grams, { target: { value: '300' } })
    await user.click(within(dialog()).getByRole('button', { name: 'Add to diary' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalled())
    expect(saved()).toMatchObject({ grams: 300, calories: 240, sodium: 120 })
  })

  it('says quietly that the product could not be loaded and stays on the search when it cannot', async () => {
    getProduct.mockResolvedValue(undefined)
    const user = await openLogger()
    await typeQuery(user, 'chobani')
    await user.click(await within(dialog()).findByText('Vanilla Greek Yogurt'))
    expect(await within(dialog()).findByText(/That product could not be loaded/)).toBeTruthy()
    expect(within(dialog()).getByRole('textbox', { name: 'Search foods' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a food with no label serving starts at 100 g', async () => {
    const bare: BrandedProduct = { ...OREO, gtin: '00000000077777', name: 'Bare Cookie', brand: 'Plain', serving: undefined }
    PRODUCTS.push(bare)
    try {
      const user = await openLogger()
      await typeQuery(user, 'plain')
      await user.click(await within(dialog()).findByText('Bare Cookie'))
      expect(((await within(dialog()).findByLabelText('Amount')) as HTMLInputElement).value).toBe('100')
    } finally { PRODUCTS.pop() }
  })
})

describe('the plate', () => {
  it('"+" on a brand row and on a banana logs 2 foods, the brand one with its label nutrients', async () => {
    const user = await openLogger()
    await typeQuery(user, 'oreo')
    await user.click(await within(dialog()).findByRole('button', { name: /^Add Oreo Chocolate Sandwich Cookies to plate/ }))
    await typeQuery(user, 'bananas, raw')
    await user.click(await within(dialog()).findByRole('button', { name: /^Add Bananas, raw to plate/ }))
    await user.click(await screen.findByRole('button', { name: 'Log 2 foods' }))
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalled())
    const [oreo, banana] = m.saveEntries.mock.calls[0][0] as Array<DiaryEntry & Record<string, unknown>>
    expect(oreo).toMatchObject({ name: 'Oreo Chocolate Sandwich Cookies', catalogId: 'usda-branded-00044000032029', grams: 34, calories: 160.1 })
    expect(oreo.sodium).toBeCloseTo(130, 0)
    expect('catalogSource' in oreo).toBe(false)
    expect(banana.catalogId).toBeTruthy()
    expect(banana.catalogSource).toBe('USDA SR Legacy')
    for (const key of NUTRIENT_KEYS) if (!(key in OREO.nutrients)) expect(key in oreo).toBe(false)
  })

  it('counts a second tap on the same brand row', async () => {
    const user = await openLogger()
    await typeQuery(user, 'oreo')
    await user.click(await within(dialog()).findByRole('button', { name: /^Add Oreo Chocolate Sandwich Cookies to plate/ }))
    await user.click(await within(dialog()).findByRole('button', { name: /Add Oreo Chocolate Sandwich Cookies to plate, 1 on plate/ }))
    await user.click(await screen.findByRole('button', { name: 'Log 1 food' }))
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalled())
    expect((m.saveEntries.mock.calls[0][0] as DiaryEntry[])[0]).toMatchObject({ grams: 68, calories: 320.3 })
  })
})

describe('a barcode typed into the search box', () => {
  it('12 digits look the product up directly and open it on the label serving', async () => {
    const user = await openLogger()
    await typeQuery(user, '012345678905')
    await waitFor(() => expect(lookup).toHaveBeenCalledWith('012345678905', expect.anything()))
    expect(search).not.toHaveBeenCalled()
    expect(((await within(dialog()).findByLabelText('Amount')) as HTMLInputElement).value).toBe('150')
  })

  it('8 digits list the match without opening it', async () => {
    lookup.mockResolvedValue(CHOBANI)
    const user = await openLogger()
    await typeQuery(user, '12345670')
    await waitFor(() => expect(lookup).toHaveBeenCalled())
    expect(await within(dialog()).findByText('Vanilla Greek Yogurt')).toBeTruthy()
    expect(within(dialog()).queryByLabelText('Amount')).toBeNull()
  })

  it('review H1: a typed code opens its product once; Back lands on an empty search and stays there', async () => {
    const user = await openLogger()
    await typeQuery(user, '044000032029')
    await within(dialog()).findByLabelText('Amount')
    await user.click(within(dialog()).getByRole('button', { name: /Back to food search/ }))
    await new Promise((resolve) => setTimeout(resolve, 900))
    expect((within(dialog()).getByRole('textbox', { name: 'Search foods' }) as HTMLInputElement).value).toBe('')
    expect(within(dialog()).queryByLabelText('Amount')).toBeNull()
    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it('review H1: with a plate, Add to plate returns to the search screen with the plate, and the plate can be logged', async () => {
    const user = await openLogger()
    await typeQuery(user, 'banana')
    await user.click(await within(dialog()).findByRole('button', { name: /^Add Bananas, raw to plate/ }))
    await typeQuery(user, '044000032029')
    await within(dialog()).findByLabelText('Amount')
    await user.click(within(dialog()).getByRole('button', { name: 'Add to plate' }))
    await new Promise((resolve) => setTimeout(resolve, 900))
    expect(within(dialog()).queryByLabelText('Amount')).toBeNull()
    await user.click(await within(dialog()).findByRole('button', { name: /^Log 2 foods/ }))
    await waitFor(() => expect(m.saveEntries).toHaveBeenCalled())
    expect((m.saveEntries.mock.calls[0][0] as unknown[]).length).toBe(2)
  })

  it('review M4: an 8 digit code with a bad check digit is not looked up', async () => {
    const user = await openLogger()
    await typeQuery(user, '12345678')
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(lookup).not.toHaveBeenCalled()
  })

  it('an unknown code says so quietly', async () => {
    lookup.mockResolvedValue(undefined)
    const user = await openLogger()
    await typeQuery(user, '999999999999')
    expect(await within(dialog()).findByText(/No product with that barcode/)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('other digit counts search by text instead of by code', async () => {
    const user = await openLogger()
    await typeQuery(user, '12345')
    await waitFor(() => expect(search).toHaveBeenCalled())
    expect(lookup).not.toHaveBeenCalled()
  })
})

describe('links and history', () => {
  it('/?log=usda-branded-<gtin> opens the logger on that product', async () => {
    window.history.replaceState(null, '', '/?log=usda-branded-00012345678905')
    render(<App />)
    expect(((await screen.findByLabelText('Amount')) as HTMLInputElement).value).toBe('150')
    expect(getProduct).toHaveBeenCalledWith('00012345678905', expect.anything())
  })

  it('a branded entry in history re-logs with one tap and no branded request (it is a snapshot)', async () => {
    entries = [{ id: 'e0', date: '2026-01-01', meal: 'snack', name: 'Chobani Vanilla Greek Yogurt', calories: 120, protein: 13.95, carbs: 15, fat: 0, grams: 150, catalogId: 'usda-branded-00012345678905', sodium: 60, createdAt: stamp, updatedAt: stamp }]
    const user = await openLogger()
    await user.click(await within(dialog()).findByRole('button', { name: /^Log Chobani Vanilla Greek Yogurt now/ }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalled())
    expect(saved()).toMatchObject({ name: 'Chobani Vanilla Greek Yogurt', calories: 120, grams: 150, catalogId: 'usda-branded-00012345678905', sodium: 60 })
    expect('catalogSource' in saved()).toBe(false)
    expect(search).not.toHaveBeenCalled()
    expect(getProduct).not.toHaveBeenCalled()
    expect(lookup).not.toHaveBeenCalled()
  })

  it('opening that history entry shows its saved numbers without a branded request', async () => {
    entries = [{ id: 'e0', date: '2026-01-01', meal: 'snack', name: 'Chobani Vanilla Greek Yogurt', calories: 120, protein: 13.95, carbs: 15, fat: 0, grams: 150, catalogId: 'usda-branded-00012345678905', sodium: 60, createdAt: stamp, updatedAt: stamp }]
    const user = await openLogger()
    await user.click(await within(dialog()).findByText('Chobani Vanilla Greek Yogurt'))
    expect(((await within(dialog()).findByLabelText(/^Calories/)) as HTMLInputElement).value).toBe('120')
    expect(getProduct).not.toHaveBeenCalled()
  })
})

describe('the barcode screen', () => {
  const offFetches = () => vi.mocked(fetch).mock.calls.filter((call) => String(call[0]).includes('openfoodfacts'))
  const thirdParty = () => vi.mocked(fetch).mock.calls.filter((call) => /^https?:\/\//.test(String(call[0])) && !String(call[0]).startsWith(window.location.origin))
  async function scanner(preferences: Settings['preferences'] = { welcomed: true }) {
    m.getSettings.mockResolvedValue({ ...welcomed, preferences })
    const user = await openLogger()
    await user.click(await screen.findByRole('button', { name: /Scan barcode/ }))
    return user
  }
  const typeCode = async (user: ReturnType<typeof userEvent.setup>, code: string) => {
    await user.type(await within(dialog()).findByLabelText('Barcode number'), code)
    await user.click(within(dialog()).getByRole('button', { name: 'Look up' }))
  }

  it('is not behind the online opt-in: a product in the brand list opens on its label serving, ready to add', async () => {
    const user = await scanner()
    expect(within(dialog()).queryByText('Barcode lookup is off')).toBeNull()
    await typeCode(user, '012345678905')
    expect(((await within(dialog()).findByLabelText('Amount')) as HTMLInputElement).value).toBe('150')
    await user.click(within(dialog()).getByRole('button', { name: 'Add to diary' }))
    await waitFor(() => expect(m.saveEntry).toHaveBeenCalled())
    expect(saved()).toMatchObject({ name: 'Chobani Vanilla Greek Yogurt', grams: 150, catalogId: 'usda-branded-00012345678905' })
    expect(offFetches()).toHaveLength(0)
    expect(thirdParty()).toHaveLength(0)
  })

  it('a product in the brand list never goes on to Open Food Facts, even with the opt-in on', async () => {
    const user = await scanner({ welcomed: true, barcodeLookup: true })
    await typeCode(user, '012345678905')
    await within(dialog()).findByLabelText('Amount')
    expect(offFetches()).toHaveLength(0)
  })

  it('a code the list lacks, with the opt-in off, offers the opt-in, the label scanner and manual entry, and sends nothing', async () => {
    lookup.mockResolvedValue(undefined)
    const user = await scanner()
    await typeCode(user, '012345678905')
    expect(await within(dialog()).findByRole('button', { name: 'Turn on online lookup' })).toBeTruthy()
    expect(within(dialog()).getByRole('button', { name: /Enter it by hand/ })).toBeTruthy()
    expect(offFetches()).toHaveLength(0)
    await user.click(within(dialog()).getByRole('button', { name: /Scan the nutrition label instead/ }))
    expect(await screen.findByText('Scan a nutrition label')).toBeTruthy()
    expect(offFetches()).toHaveLength(0)
  })

  it('a code the list lacks, with the opt-in on, goes on to Open Food Facts', async () => {
    lookup.mockResolvedValue(undefined)
    vi.mocked(fetch).mockImplementation((url: unknown) => String(url).includes('openfoodfacts') ? Promise.resolve(new Response(JSON.stringify({ status: 0 }), { status: 200 })) : Promise.resolve(respond(String(url).includes('usda-nutrients') ? tableText : catalogText)))
    const user = await scanner({ welcomed: true, barcodeLookup: true })
    await typeCode(user, '012345678905')
    await waitFor(() => expect(offFetches()).toHaveLength(1))
  })

  it('enter it by hand goes to the manual form', async () => {
    lookup.mockResolvedValue(undefined)
    const user = await scanner()
    await typeCode(user, '012345678905')
    await user.click(await within(dialog()).findByRole('button', { name: /Enter it by hand/ }))
    expect(await within(dialog()).findByLabelText(/Food or meal name/)).toBeTruthy()
  })

  it('offline, a code the list lacks says the list is not reachable and still offers the way out', async () => {
    lookup.mockImplementation(async (_code: string, options?: { onReason?: (reason: string) => void }) => { options?.onReason?.('offline'); return undefined })
    const user = await scanner()
    await typeCode(user, '012345678905')
    expect(await within(dialog()).findByText('Brand list not reachable')).toBeTruthy()
    expect(within(dialog()).getByRole('button', { name: /Scan the nutrition label instead/ })).toBeTruthy()
  })
})

describe('settings', () => {
  it('lists the branded food source with its release date', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click((await screen.findAllByRole('button', { name: 'Settings' }))[0])
    expect(await screen.findByText('USDA FoodData Central Branded, October 2026', { exact: false })).toBeTruthy()
    expect(screen.getByText(/Branded foods:/)).toBeTruthy()
  })
})
