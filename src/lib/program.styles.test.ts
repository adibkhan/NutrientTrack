// Maintenance nudge and diet styles in budgetFor / readProgram.
import { describe, expect, it } from 'vitest'
import { DIET_STYLES, MIN_BUDGET_KCAL, budgetFor, maintenanceNudge, readProgram } from './program'
import { LB_PER_KG } from './trend'

describe('maintenanceNudge', () => {
  const maintain = (goalWeight?: number) => ({ direction: 'maintain' as const, ...(goalWeight === undefined ? {} : { goalWeight }) })

  it('adds 250 when the trend is more than 1.5 lb below the goal', () => {
    expect(maintenanceNudge(maintain(180), 'lb', 178.4)).toBe(250)
  })
  it('takes 250 away when the trend is more than 1.5 lb above the goal', () => {
    expect(maintenanceNudge(maintain(180), 'lb', 181.6)).toBe(-250)
  })
  it('does nothing exactly at the 1.5 lb limit, on either side', () => {
    expect(maintenanceNudge(maintain(180), 'lb', 178.5)).toBe(0)
    expect(maintenanceNudge(maintain(180), 'lb', 181.5)).toBe(0)
  })
  it('does nothing when the trend equals the goal', () => {
    expect(maintenanceNudge(maintain(180), 'lb', 180)).toBe(0)
  })
  it('uses a 0.68 kg band for kg users', () => {
    expect(maintenanceNudge(maintain(80), 'kg', 79.3)).toBe(250)
    expect(maintenanceNudge(maintain(80), 'kg', 79.4)).toBe(0)
    expect(maintenanceNudge(maintain(80), 'kg', 80.7)).toBe(-250)
    expect(1.5 / LB_PER_KG).toBeCloseTo(0.68, 2)
  })
  it('does nothing without a goal weight or without a trend weight', () => {
    expect(maintenanceNudge(maintain(), 'lb', 170)).toBe(0)
    expect(maintenanceNudge(maintain(180), 'lb', undefined)).toBe(0)
    expect(maintenanceNudge(maintain(180), 'lb', 0)).toBe(0)
  })
  it.each(['lose', 'gain'] as const)('does nothing for %s', (direction) => {
    expect(maintenanceNudge({ direction, goalWeight: 180, weeklyRate: 1 }, 'lb', 150)).toBe(0)
  })
  it('does nothing without a direction', () => {
    expect(maintenanceNudge({ goalWeight: 180 }, 'lb', 150)).toBe(0)
  })
})

describe('budgetFor with the maintenance nudge', () => {
  it('adds the nudge to calories and reports it', () => {
    const b = budgetFor({ direction: 'maintain', goalWeight: 180 }, 'lb', 2300, 170)
    expect(b.calories).toBe(2550)
    expect(b.nudge).toBe(250)
  })
  it('subtracts the nudge and reports it as negative', () => {
    const b = budgetFor({ direction: 'maintain', goalWeight: 180 }, 'lb', 2300, 190)
    expect(b.calories).toBe(2050)
    expect(b.nudge).toBe(-250)
  })
  it('omits the nudge key entirely when there is none', () => {
    const b = budgetFor({ direction: 'maintain', goalWeight: 180 }, 'lb', 2300, 180)
    expect(b.calories).toBe(2300)
    expect('nudge' in b).toBe(false)
    expect('nudge' in budgetFor({ direction: 'maintain' }, 'lb', 2300, 150)).toBe(false)
    expect('nudge' in budgetFor({ direction: 'lose', weeklyRate: 1, goalWeight: 180 }, 'lb', 2300, 150)).toBe(false)
  })
  it('still holds the 1200 floor after a downward nudge', () => {
    const b = budgetFor({ direction: 'maintain', goalWeight: 150 }, 'lb', 1300, 170)
    expect(b.calories).toBe(MIN_BUDGET_KCAL)
    expect(b.floored).toBe(true)
    expect(b.nudge).toBe(-250)
  })
})

describe('budgetFor with diet styles', () => {
  const base = { direction: 'maintain' as const, proteinPerWeight: 1 }
  // 2000 kcal, 180 lb, 1 g per lb: protein 180 g.
  it('keeps the old balanced numbers for a missing style', () => {
    const b = budgetFor(base, 'lb', 2000, 180)
    expect(b).toMatchObject({ calories: 2000, protein: 180, fat: 67, carbs: 169 })
    expect(budgetFor({ ...base, dietStyle: 'balanced' }, 'lb', 2000, 180)).toEqual(b)
  })
  it.each([
    ['lowfat', 0.2], ['lowcarb', 0.4], ['keto', 0.65],
  ] as const)('%s uses a %s fat share and gives carbs the remainder', (dietStyle, share) => {
    const b = budgetFor({ ...base, dietStyle }, 'lb', 2000, 180)
    expect(DIET_STYLES[dietStyle].fatShare).toBe(share)
    expect(b.fat).toBe(Math.round((2000 * share) / 9))
    expect(b.carbs).toBe(Math.max(0, Math.round((2000 - 180 * 4 - b.fat! * 9) / 4)))
  })
  it('never lets carbs go negative when protein plus fat exceed the budget', () => {
    const b = budgetFor({ ...base, dietStyle: 'keto', proteinPerWeight: 2 }, 'lb', 1500, 180)
    expect(b.carbs).toBe(0)
  })
  it('sets no macros without a protein ratio, whatever the style', () => {
    const b = budgetFor({ direction: 'maintain', dietStyle: 'keto' }, 'lb', 2000, 180)
    expect(b.protein).toBeUndefined()
    expect(b.fat).toBeUndefined()
    expect(b.carbs).toBeUndefined()
  })
})

describe('readProgram dietStyle', () => {
  it.each(['balanced', 'lowfat', 'lowcarb', 'keto'])('keeps a valid style %s', (dietStyle) => {
    expect(readProgram({ dietStyle }).dietStyle).toBe(dietStyle)
  })
  it.each([['unknown string', 'paleo'], ['number', 3], ['null', null], ['empty string', ''], ['toString', 'toString'], ['__proto__', '__proto__'], ['constructor', 'constructor'], ['hasOwnProperty', 'hasOwnProperty']])('drops %s', (_name, dietStyle) => {
    const p = readProgram({ direction: 'maintain', dietStyle })
    expect('dietStyle' in p).toBe(false)
    expect(p.direction).toBe('maintain')
  })
  it('does not crash budgetFor on a program read from a hostile record', () => {
    const b = budgetFor(readProgram({ dietStyle: 'toString', proteinPerWeight: 1 }), 'lb', 2000, 180)
    expect(b.fat).toBe(67)
  })
})
