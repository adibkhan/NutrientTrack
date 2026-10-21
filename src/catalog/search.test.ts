import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import catalogText from '../../public/data/usda-common-v2.json?raw'
import { searchCatalog } from './index'


beforeAll(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(catalogText, { status: 200 })))
})
afterAll(() => vi.unstubAllGlobals())

const names = async (query: string, limit = 10) => (await searchCatalog(query, limit)).map((food) => food.name)

describe('catalog search ranking', () => {
  it('ranks_raw_bananas_above_banana_powder', async () => {
    const results = await names('banana')
    expect(results[0]).toBe('Bananas, raw')
    expect(results.indexOf('Bananas, raw')).toBeLessThan(results.indexOf('Bananas, dehydrated, or banana powder'))
  })

  it('puts_plain_eggs_first_and_infant_or_frozen_mixtures_after', async () => {
    const results = await names('eggs', 30)
    expect(results[0]).toMatch(/^Egg, (whole|chicken)/i)
    expect(results[0]).toMatch(/raw/)
    expect(results.slice(0, 5).some((name) => /baby|infant|frozen mixture/i.test(name))).toBe(false)
  })

  it('does_not_lead_oat_milk_with_baby_cereal', async () => {
    const results = await names('oat milk', 20)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]).not.toMatch(/baby/i)
    expect(results.slice(0, 5).some((name) => /baby/i.test(name))).toBe(false)
  })

  it('still_finds_baby_food_when_asked', async () => {
    const results = await names('baby food banana', 5)
    expect(results[0]).toMatch(/^Babyfood/i)
  })

  it('tolerates_a_one_letter_typo', async () => {
    expect((await names('bannana'))[0]).toBe('Bananas, raw')
  })

  it('tolerates_two_edits_in_long_words', async () => {
    const results = await names('cheddar chese', 5)
    expect(results.length).toBeGreaterThan(0)
  })

  it('does_not_correct_short_words', async () => {
    expect(await names('zzq')).toEqual([])
  })

  it('searches_the_whole_catalog_quickly_after_the_first_call', async () => {
    await searchCatalog('chicken')
    const start = performance.now()
    for (const q of ['b', 'ba', 'ban', 'bana', 'banan', 'banana']) await searchCatalog(q, 20)
    expect((performance.now() - start) / 6).toBeLessThan(40)
  })
})
