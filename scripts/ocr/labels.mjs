// Three synthetic nutrition labels, rendered from HTML, with the values a correct reading must produce.
// Used by render-labels.mjs and e2e.mjs; nothing here ships in the app.

const css = `
  body { margin: 0; background: #8a8f94; display: flex; align-items: center; justify-content: center; font-family: 'DejaVu Sans', sans-serif; }
  .stage { padding: 48px; }
  .photo { transform: rotate(var(--rot)); filter: blur(var(--blur)); }
  .label { background: #fff; color: #000; border: 3px solid #000; padding: 8px 10px; width: 330px; font-size: 15px; line-height: 1.25; }
  .label h1 { font-size: 40px; margin: 0; font-weight: 900; letter-spacing: -1px; border-bottom: 1px solid #000; }
  .row { display: flex; justify-content: space-between; border-top: 1px solid #000; padding: 2px 0; }
  .row.sub { padding-left: 16px; }
  .row.sub2 { padding-left: 32px; }
  .thick { border-top: 9px solid #000; }
  .mid { border-top: 5px solid #000; }
  .big { font-size: 34px; font-weight: 900; display: flex; justify-content: space-between; align-items: flex-end; }
  b { font-weight: 800; }
  .right { text-align: right; }
  .foot { font-size: 11px; border-top: 4px solid #000; padding-top: 3px; }
  table { border-collapse: collapse; width: 100%; }
  td, th { padding: 3px 4px; border-top: 1px solid #000; text-align: left; font-size: 15px; }
  th { border-top: 0; font-size: 13px; }
  td.n, th.n { text-align: right; }
`

const usClassic = `
<div class="label">
  <h1>Nutrition Facts</h1>
  <div>8 servings per container</div>
  <div class="row" style="border-top:0"><b style="font-size:18px">Serving size</b><b style="font-size:18px">2/3 cup (55g)</b></div>
  <div class="thick"></div>
  <div style="font-size:13px"><b>Amount per serving</b></div>
  <div class="big"><span>Calories</span><span>230</span></div>
  <div class="mid"></div>
  <div class="row right" style="justify-content:flex-end"><b>% Daily Value*</b></div>
  <div class="row"><span><b>Total Fat</b> 8g</span><b>10%</b></div>
  <div class="row sub"><span>Saturated Fat 1g</span><b>5%</b></div>
  <div class="row sub"><span><i>Trans</i> Fat 0g</span><span></span></div>
  <div class="row"><span><b>Cholesterol</b> 0mg</span><b>0%</b></div>
  <div class="row"><span><b>Sodium</b> 160mg</span><b>7%</b></div>
  <div class="row"><span><b>Total Carbohydrate</b> 37g</span><b>13%</b></div>
  <div class="row sub"><span>Dietary Fiber 4g</span><b>14%</b></div>
  <div class="row sub"><span>Total Sugars 12g</span><span></span></div>
  <div class="row sub2"><span>Includes 10g Added Sugars</span><b>20%</b></div>
  <div class="row"><span><b>Protein</b> 3g</span><span></span></div>
  <div class="thick"></div>
  <div class="row" style="border-top:0"><span>Vitamin D 2mcg</span><span>10%</span></div>
  <div class="row"><span>Calcium 260mg</span><span>20%</span></div>
  <div class="row"><span>Iron 8mg</span><span>45%</span></div>
  <div class="row"><span>Potassium 235mg</span><span>6%</span></div>
  <div class="foot">* The % Daily Value (DV) tells you how much a nutrient in a serving of food contributes to a daily diet. 2,000 calories a day is used for general nutrition advice.</div>
</div>`

const usDual = `
<div class="label" style="width:360px">
  <h1 style="font-size:36px">Nutrition Facts</h1>
  <div>About 6 servings per container</div>
  <div class="row" style="border-top:0"><b style="font-size:17px">Serving size</b><b style="font-size:17px">1 oz (28g/about 15 chips)</b></div>
  <div class="thick"></div>
  <table>
    <tr><th></th><th class="n">Per serving</th><th class="n">Per container</th></tr>
    <tr><td><b style="font-size:22px">Calories</b></td><td class="n"><b style="font-size:22px">160</b></td><td class="n"><b style="font-size:22px">960</b></td></tr>
    <tr><td><b>Total Fat</b></td><td class="n">10g 13%</td><td class="n">60g 77%</td></tr>
    <tr><td style="padding-left:16px">Saturated Fat</td><td class="n">1.5g 8%</td><td class="n">9g 45%</td></tr>
    <tr><td style="padding-left:16px"><i>Trans</i> Fat</td><td class="n">0g</td><td class="n">0g</td></tr>
    <tr><td><b>Cholesterol</b></td><td class="n">0mg 0%</td><td class="n">0mg 0%</td></tr>
    <tr><td><b>Sodium</b></td><td class="n">170mg 7%</td><td class="n">1020mg 44%</td></tr>
    <tr><td><b>Total Carbohydrate</b></td><td class="n">15g 5%</td><td class="n">90g 33%</td></tr>
    <tr><td style="padding-left:16px">Dietary Fiber</td><td class="n">1g 4%</td><td class="n">6g 21%</td></tr>
    <tr><td style="padding-left:16px">Total Sugars</td><td class="n">&lt;1g</td><td class="n">1g</td></tr>
    <tr><td><b>Protein</b></td><td class="n">2g</td><td class="n">12g</td></tr>
  </table>
  <div class="foot">Not a significant source of vitamin D, calcium, iron or potassium.</div>
</div>`

const eu = `
<div class="label" style="width:340px;border-radius:4px">
  <div style="font-size:20px;font-weight:800;padding-bottom:4px">Nutrition information</div>
  <table>
    <tr><th>Typical values</th><th class="n">per 100 g</th></tr>
    <tr><td>Energy</td><td class="n">1046 kJ / 250 kcal</td></tr>
    <tr><td>Fat</td><td class="n">12 g</td></tr>
    <tr><td style="padding-left:14px">of which saturates</td><td class="n">3.2 g</td></tr>
    <tr><td>Carbohydrate</td><td class="n">30 g</td></tr>
    <tr><td style="padding-left:14px">of which sugars</td><td class="n">5.4 g</td></tr>
    <tr><td>Fibre</td><td class="n">2.5 g</td></tr>
    <tr><td>Protein</td><td class="n">6.1 g</td></tr>
    <tr><td>Salt</td><td class="n">1.2 g</td></tr>
  </table>
</div>`

export const LABELS = [
  {
    name: 'us-classic', rotate: 0, blur: 0.4, html: usClassic,
    expected: { basis: 'per serving', servingGrams: 55, servingsPerContainer: 8, calories: 230, fat: 8, satFat: 1, transFat: 0, cholesterol: 0, sodium: 160, carbs: 37, fiber: 4, sugars: 12, addedSugars: 10, protein: 3, vitaminD: 2, calcium: 260, iron: 8, potassium: 235 },
  },
  {
    name: 'us-dual-column', rotate: -2, blur: 0.6, html: usDual,
    expected: { basis: 'per serving', servingGrams: 28, servingsPerContainer: 6, calories: 160, fat: 10, satFat: 1.5, transFat: 0, cholesterol: 0, sodium: 170, carbs: 15, fiber: 1, sugars: 0.5, protein: 2 },
  },
  {
    name: 'eu-per-100g', rotate: 1.5, blur: 0.5, html: eu,
    expected: { basis: 'per 100 g', calories: 250, fat: 12, satFat: 3.2, carbs: 30, sugars: 5.4, fiber: 2.5, protein: 6.1, sodium: 480 },
  },
]

export const pageFor = (label) => `<!doctype html><meta charset="utf-8"><style>${css}</style><body><div class="stage"><div class="photo" id="photo" style="--rot:${label.rotate}deg;--blur:${label.blur}px">${label.html}</div></div></body>`
