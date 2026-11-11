// @vitest-environment node
// The nutrient table builder (scripts/build-usda-nutrients.mjs) against a tiny synthetic archive, plus its map against the app model.
import { describe, expect, it } from 'vitest'
// @ts-expect-error The app tsconfig has no Node typings; this file runs in Node.
import { mkdtempSync, writeFileSync } from 'node:fs'
// @ts-expect-error see above
import { tmpdir } from 'node:os'
// @ts-expect-error see above
import { join } from 'node:path'
// @ts-expect-error The script is plain JavaScript.
import { buildNutrients, NUTRIENT_MAP, roundValue } from '../../scripts/build-usda-nutrients.mjs'
import { NUTRIENTS } from './nutrients'

type Spec = { key: string; ids: string[]; unit: string }

/** A ZIP of stored (uncompressed) files: enough for the script's reader, which does not check CRCs. */
const zipOf = (files: Record<string, string>): Uint8Array => {
  const text = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  const header = (size: number) => { const bytes = new Uint8Array(size); return { bytes, view: new DataView(bytes.buffer) } }
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = text.encode(name)
    const data = text.encode(content)
    const local = header(30)
    local.view.setUint32(0, 0x04034b50, true)
    local.view.setUint32(18, data.length, true)
    local.view.setUint32(22, data.length, true)
    local.view.setUint16(26, nameBytes.length, true)
    parts.push(local.bytes, nameBytes, data)
    const entry = header(46)
    entry.view.setUint32(0, 0x02014b50, true)
    entry.view.setUint32(20, data.length, true)
    entry.view.setUint32(24, data.length, true)
    entry.view.setUint16(28, nameBytes.length, true)
    entry.view.setUint32(42, offset, true)
    central.push(entry.bytes, nameBytes)
    offset += 30 + nameBytes.length + data.length
  }
  const directoryLength = central.reduce((sum, part) => sum + part.length, 0)
  const end = header(22)
  end.view.setUint32(0, 0x06054b50, true)
  end.view.setUint16(10, Object.keys(files).length, true)
  end.view.setUint32(12, directoryLength, true)
  end.view.setUint32(16, offset, true)
  const all = [...parts, ...central, end.bytes]
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of all) { out.set(part, at); at += part.length }
  return out
}

const nutrientCsv = ['"id","name","unit_name","nutrient_nbr","rank"', ...(NUTRIENT_MAP as Spec[]).flatMap((spec) => spec.ids.map((id) => `"${id}","${spec.key}","${spec.unit}","1","1"`))].join('\n')
const foodNutrient = (rows: Array<[number, string, string]>) =>
  ['"id","fdc_id","nutrient_id","amount"', ...rows.map(([fdc, nutrient, amount], index) => `"${index}","${fdc}","${nutrient}","${amount}"`)].join('\n')
const build = async (rows: Array<[number, string, string]>, catalog: Array<{ fdcId: number }>, nutrients = nutrientCsv) => {
  const dir = mkdtempSync(join(tmpdir(), 'nt-nutrients-'))
  const zip = join(dir, 'source.zip')
  const catalogPath = join(dir, 'catalog.json')
  writeFileSync(zip, zipOf({ 'sr/nutrient.csv': nutrients, 'sr/food_nutrient.csv': foodNutrient(rows) }))
  writeFileSync(catalogPath, JSON.stringify(catalog))
  return buildNutrients(zip, catalogPath) as Promise<{ keys: string[]; rows: number[][] }>
}
const bit = (key: string) => 2 ** (NUTRIENT_MAP as Spec[]).findIndex((spec) => spec.key === key)

describe('NUTRIENT_MAP', () => {
  it('has exactly the app model keys, so the file header and the app agree', () => {
    expect((NUTRIENT_MAP as Spec[]).map((spec) => spec.key).sort()).toEqual(NUTRIENTS.map((nutrient) => nutrient.key).sort())
  })

  it('reads each nutrient in a unit that converts to the app unit without scaling (G, MG, UG)', () => {
    const appUnit = { g: 'G', mg: 'MG', mcg: 'UG' } as const
    for (const spec of NUTRIENT_MAP as Spec[]) expect(spec.unit).toBe(appUnit[NUTRIENTS.find((nutrient) => nutrient.key === spec.key)!.unit])
  })

  it('uses the SR Legacy ids for the micrograms rows, not the IU ones', () => {
    const byKey = Object.fromEntries((NUTRIENT_MAP as Spec[]).map((spec) => [spec.key, spec.ids.join('+')]))
    expect(byKey).toMatchObject({ vitaminD: '1114', vitaminA: '1106', folate: '1190', vitaminK: '1185', potassium: '1092', omega3: '1404+1270+1278+1272' })
  })
})

describe('roundValue', () => {
  it('keeps three significant figures and never drops digits left of the point', () => {
    expect(roundValue(358.4)).toBe(358)
    expect(roundValue(12345.6)).toBe(12346)
    expect(roundValue(8.7123)).toBe(8.71)
    expect(roundValue(0.08149)).toBe(0.0815)
    expect(roundValue(0)).toBe(0)
  })
})

describe('buildNutrients', () => {
  it('writes [fdcId, mask, ...values] with only measured nutrients, and a measured zero stays zero', async () => {
    const table = await build([[1, '1092', '358.4'], [1, '1162', '8.712'], [1, '1253', '0'], [2, '1087', '113']], [{ fdcId: 1 }, { fdcId: 2 }])
    expect(table.rows).toEqual([
      [1, bit('cholesterol') + bit('potassium') + bit('vitaminC'), 0, 358, 8.71],
      [2, bit('calcium'), 113],
    ])
  })

  it('only includes foods in the catalog, sorted by fdcId', async () => {
    const table = await build([[9, '1092', '1'], [3, '1092', '2'], [7, '1092', '3']], [{ fdcId: 9 }, { fdcId: 3 }])
    expect(table.rows.map((row) => row[0])).toEqual([3, 9])
  })

  it('sums ALA, EPA and DHA into omega-3', async () => {
    const table = await build([[1, '1404', '0.5'], [1, '1278', '0.25'], [1, '1272', '0.5']], [{ fdcId: 1 }])
    expect(table.rows).toEqual([[1, bit('omega3'), 1.25]])
  })

  it('uses the generic 18:3 row when ALA is missing, and ALA over 18:3 when both are there', async () => {
    const table = await build([[1, '1270', '0.76'], [2, '1270', '9'], [2, '1404', '0.5']], [{ fdcId: 1 }, { fdcId: 2 }])
    expect(table.rows).toEqual([[1, bit('omega3'), 0.76], [2, bit('omega3'), 0.5]])
  })

  it('keeps EPA/DHA with no ALA when above zero, records a true zero when ALA or 18:3 is measured as zero, and skips EPA/DHA zeros alone', async () => {
    const table = await build([[1, '1278', '0.2'], [2, '1270', '0'], [2, '1278', '0'], [3, '1278', '0'], [3, '1272', '0']], [{ fdcId: 1 }, { fdcId: 2 }, { fdcId: 3 }])
    expect(table.rows).toEqual([[1, bit('omega3'), 0.2], [2, bit('omega3'), 0]])
  })

  it('refuses an archive whose unit for a nutrient is not the one the model expects', async () => {
    const wrong = nutrientCsv.replace('"1114","vitaminD","UG"', '"1114","vitaminD","IU"')
    await expect(build([[1, '1114', '1']], [{ fdcId: 1 }], wrong)).rejects.toThrow(/expected UG/)
  })
})
