#!/usr/bin/env node

/**
 * Static nutrition pages for search engines: one page per food in the bundled USDA catalog, one page per category,
 * a directory at /foods/, and /sitemap.xml. Runs after `vite build` and writes into dist/.
 *
 * The pages are plain HTML with one shared stylesheet. They never load the app's JavaScript, make no third-party
 * requests, and link into the app with /?log=<catalog id>, which opens the logger on that food.
 *
 * Usage: node scripts/build-food-pages.mjs [--catalog public/data/usda-common-v2.json] [--out dist] [--origin https://nutrienttrack.com]
 */

import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const CATALOG = resolve(option('--catalog', 'public/data/usda-common-v2.json'))
const OUT = resolve(option('--out', 'dist'))
const ORIGIN = option('--origin', 'https://nutrienttrack.com').replace(/\/$/, '')

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
export const slugify = (value) => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/%/g, ' percent ')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 90)
  .replace(/-+$/g, '')

const number = (value, digits = 1) => {
  const factor = 10 ** digits
  const rounded = Math.round(value * factor) / factor
  return rounded.toLocaleString('en-US', { maximumFractionDigits: digits })
}
const shortPortion = (label) => label.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim()
const scale = (per100g, grams) => ({
  calories: (per100g.calories * grams) / 100,
  protein: (per100g.protein * grams) / 100,
  carbs: (per100g.carbs * grams) / 100,
  fat: (per100g.fat * grams) / 100,
})

const PREFERRED_PORTIONS = ['medium', 'large', 'slice', 'piece', 'fruit', 'egg', 'serving', 'cup', 'tbsp']
const isBareWeight = (label) => /^\d+(\.\d+)?\s*(oz|g|lb)\b/i.test(label)

/** A portion people actually think in: "1 medium" before "1 cup, mashed", and never a bare ounce or gram weight. */
const headlinePortion = (food) => {
  const portions = (food.portions ?? []).filter(([label]) => !isBareWeight(label))
  for (const word of PREFERRED_PORTIONS) {
    const match = portions.find(([label]) => label.startsWith('1 ') && new RegExp(`\\b${word}\\b`, 'i').test(label))
    if (match) return match
  }
  return portions[0] ?? food.portions?.[0]
}

const PIP_SVG = `<svg class="pip" viewBox="0 -4 80 84" width="64" height="67" aria-hidden="true"><defs><radialGradient id="pipb" cx="36%" cy="28%" r="78%"><stop offset="0" stop-color="var(--pip-belly)"/><stop offset=".38" stop-color="var(--pip-body)"/><stop offset="1" stop-color="var(--pip-shade)"/></radialGradient><linearGradient id="pipl" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="var(--pip-leaf)"/><stop offset="1" stop-color="var(--pip-leaf-light)"/></linearGradient><linearGradient id="pipy" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--pip-belly)" stop-opacity="0"/><stop offset="1" stop-color="var(--pip-belly)" stop-opacity=".85"/></linearGradient></defs><ellipse class="pip-shadow" cx="40" cy="74.5" rx="19" ry="3.2"/><path class="pip-stem" d="M40 17 C40 13 40 11 41 8"/><path fill="url(#pipl)" d="M41 9 C45 3 53 3 56 6 C52 11 46 12 41 9 Z"/><path fill="url(#pipl)" d="M40 11 C36 6 30 6 27 8 C30 13 36 13 40 11 Z"/><path class="pip-arm" d="M20 47 L13 55"/><path class="pip-arm" d="M60 40 L69 29"/><ellipse class="pip-foot" cx="30.5" cy="69.5" rx="6.5" ry="3.8"/><ellipse class="pip-foot" cx="49.5" cy="69.5" rx="6.5" ry="3.8"/><path fill="url(#pipb)" d="M40 16 C55 16 65 28 65.5 43 C66 58 55 70 40 70 C25 70 14 58 14.5 43 C15 28 25 16 40 16 Z"/><ellipse fill="url(#pipy)" cx="40" cy="52" rx="15.5" ry="13.5"/><ellipse class="pip-shine" cx="29" cy="27" rx="5.5" ry="3" transform="rotate(-32 29 27)"/><ellipse class="pip-eye" cx="31.5" cy="41" rx="3.7" ry="4.3"/><ellipse class="pip-eye" cx="48.5" cy="41" rx="3.7" ry="4.3"/><circle class="pip-glint" cx="33" cy="39.2" r="1.5"/><circle class="pip-glint" cx="50" cy="39.2" r="1.5"/><ellipse class="pip-cheek" cx="24" cy="48.5" rx="4.6" ry="2.7"/><ellipse class="pip-cheek" cx="56" cy="48.5" rx="4.6" ry="2.7"/><path class="pip-line" d="M33.5 47.5 Q40 54.5 46.5 47.5"/></svg>`

const STYLES = `@font-face{font-family:"IBM Plex Sans";font-style:normal;font-weight:400 700;font-display:swap;src:url("/fonts/ibm-plex-sans-latin.woff2") format("woff2")}
:root{color-scheme:light;--bg:#fff;--surface:#fff;--soft:#f4f5f7;--row:#f9fafb;--ink:#101828;--ink2:#475467;--muted:#667085;--line:#e4e7ec;--accent:#2e6fe8;--accent-soft:#eaf1fe;--protein:#2e6fe8;--carbs:#7a5af8;--fat:#e08a1e;--pip-body:#5cbf7c;--pip-shade:#3f9a5e;--pip-belly:#a3e0b6;--pip-leaf:#2f8f4e;--pip-leaf-light:#7fd49a;--pip-ink:#1d2939;--pip-cheek:#f6a5a0;--pip-soft:#effaf2;--pip-line:#cdeed7}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#0c111d;--surface:#131926;--soft:#1d2433;--row:#181f2d;--ink:#f2f4f7;--ink2:#cfd4dc;--muted:#98a2b3;--line:#2a3243;--accent:#7aa7f7;--accent-soft:#172544;--protein:#7aa7f7;--carbs:#a592fb;--fat:#f0a53a;--pip-body:#4fae6c;--pip-shade:#36844f;--pip-belly:#79c893;--pip-leaf:#4fae6c;--pip-leaf-light:#8ee0a8;--pip-ink:#0c111d;--pip-cheek:#e98585;--pip-soft:#13261b;--pip-line:#24452f}}
*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 "IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--accent)}.wrap{max-width:860px;margin:0 auto;padding:0 16px}
header.site{border-bottom:1px solid var(--line)}header.site .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:60px}
.brand{display:inline-flex;align-items:center;gap:8px;color:var(--ink);font-weight:700;text-decoration:none}.brand i{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:var(--accent);color:#fff;font-style:normal;font-size:15px}
.open-app{display:inline-flex;align-items:center;min-height:40px;padding:0 14px;border-radius:8px;background:var(--accent);color:#fff;font-weight:600;text-decoration:none;font-size:14px}
nav.crumbs{margin:20px 0 4px;color:var(--muted);font-size:13px}nav.crumbs a{color:var(--muted)}
h1{margin:0 0 6px;font-size:28px;line-height:1.2;letter-spacing:-.01em}.lede{margin:0 0 20px;color:var(--ink2)}
.hero{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:16px}
.stat{padding:14px;border:1px solid var(--line);border-radius:10px;background:var(--surface)}.stat span{display:block;color:var(--muted);font-size:12px}.stat strong{font-size:24px;font-variant-numeric:tabular-nums}.stat small{color:var(--muted);font-size:13px;font-weight:500}
.split{display:flex;height:10px;overflow:hidden;border-radius:99px;background:var(--soft);margin:6px 0 4px}.split b{display:block}.split .p{background:var(--protein)}.split .c{background:var(--carbs)}.split .f{background:var(--fat)}
.legend{display:flex;flex-wrap:wrap;gap:4px 14px;margin:0 0 20px;color:var(--ink2);font-size:13px}.legend i{display:inline-block;width:9px;height:9px;margin-right:6px;border-radius:2px}
table{width:100%;border-collapse:collapse;margin:0 0 20px;font-variant-numeric:tabular-nums;font-size:14px}th,td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:right}th:first-child,td:first-child{text-align:left}thead th{color:var(--muted);font-size:12px;font-weight:600;background:var(--row);white-space:nowrap}td small{display:block;color:var(--muted);font-size:12px}td:not(:first-child){white-space:nowrap}.table-scroll{overflow-x:auto;border:1px solid var(--line);border-radius:10px;margin-bottom:20px}.table-scroll table{margin:0}
h2{margin:28px 0 10px;font-size:18px}
.cta{display:flex;align-items:center;gap:14px;margin:24px 0;padding:16px;border:1px solid var(--pip-line);border-radius:12px;background:var(--pip-soft)}.cta p{margin:2px 0 10px;color:var(--ink2);font-size:14px}.cta strong{font-size:16px}
.pip{flex:0 0 auto;animation:pip-bob 3.4s ease-in-out infinite}@keyframes pip-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}@media (prefers-reduced-motion:reduce){.pip{animation:none}}.pip-shadow{fill:var(--pip-shade);opacity:.16}.pip-arm{fill:none;stroke:var(--pip-shade);stroke-width:7;stroke-linecap:round}.pip-foot{fill:var(--pip-shade)}.pip-shine{fill:#fff;opacity:.55}.pip-stem{fill:none;stroke:var(--pip-leaf);stroke-width:2.4;stroke-linecap:round}.pip-eye{fill:var(--pip-ink)}.pip-glint{fill:#fff}.pip-cheek{fill:var(--pip-cheek);opacity:.6}.pip-line{fill:none;stroke:var(--pip-ink);stroke-width:2.4;stroke-linecap:round}
ul.links{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:2px 16px;margin:0 0 20px;padding:0;list-style:none}ul.links li{padding:6px 0;border-bottom:1px solid var(--line);font-size:14px}ul.links small{color:var(--muted)}
.source{color:var(--muted);font-size:13px}footer.site{margin-top:40px;padding:20px 0 40px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}
@media (max-width:520px){h1{font-size:23px}th,td{padding:8px}}`

const page = ({ title, description, path, body, jsonLd }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${ORIGIN}${path}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${ORIGIN}${path}">
<meta property="og:type" content="website">
<meta property="og:image" content="${ORIGIN}/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/icons/nutrienttrack-192.png" type="image/png">
<link rel="stylesheet" href="/foods/foods.css">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body>
<header class="site"><div class="wrap"><a class="brand" href="/"><i>N</i>NutrientTrack</a><a class="open-app" href="/">Open the free tracker</a></div></header>
<main class="wrap">
${body}
</main>
<footer class="site"><div class="wrap">Nutrition values from USDA FoodData Central (SR Legacy, public domain). NutrientTrack is a free, private calorie and macro tracker with no ads and no account required. Values are for reference and are not medical advice.</div></footer>
</body>
</html>
`

const breadcrumbLd = (items) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, path], index) => ({ '@type': 'ListItem', position: index + 1, name, item: `${ORIGIN}${path}` })),
})

const ctaBlock = (food) => `<section class="cta">${PIP_SVG}<div><strong>Track ${escapeHtml(food ? food.name.split(',')[0] : 'your food')} free</strong><p>Log it in two taps with household servings, a free barcode scanner and weight trends. No ads, no account, your diary stays on your device.</p><a class="open-app" href="${food ? `/?log=${encodeURIComponent(food.id)}` : '/'}">${food ? 'Log this food' : 'Start tracking'}</a></div></section>`

export const foodPage = (food, { categorySlug, foodPath, related }) => {
  const per100 = food.per100g
  const headline = headlinePortion(food)
  const portionRows = [['100 g', 100], ...(food.portions ?? []).slice(0, 8)]
  const energy = per100.protein * 4 + per100.carbs * 4 + per100.fat * 9
  const share = (value) => (energy > 0 ? (value / energy) * 100 : 0)
  const shares = { p: share(per100.protein * 4), c: share(per100.carbs * 4), f: share(per100.fat * 9) }
  const headlineValues = headline ? scale(per100, headline[1]) : undefined
  const description = `${food.name} has ${number(per100.calories, 0)} calories per 100 g${headline ? ` (${number(headlineValues.calories, 0)} per ${shortPortion(headline[0]).replace(/^1 /, '')})` : ''}, with ${number(per100.protein)} g protein, ${number(per100.carbs)} g carbs and ${number(per100.fat)} g fat. USDA nutrition facts and household servings.`
  const body = `<nav class="crumbs" aria-label="Breadcrumb"><a href="/foods/">Foods</a> › <a href="/foods/${categorySlug}/">${escapeHtml(food.category)}</a></nav>
<h1>Calories in ${escapeHtml(food.name)}</h1>
<p class="lede">Nutrition facts per 100 g and per household serving, from USDA FoodData Central.</p>
<div class="hero">
<div class="stat"><span>Per 100 g</span><strong>${number(per100.calories, 0)}</strong> <small>kcal</small></div>
${headline ? `<div class="stat"><span>Per ${escapeHtml(shortPortion(headline[0]).replace(/^1 /, ''))} (${number(headline[1], 0)} g)</span><strong>${number(headlineValues.calories, 0)}</strong> <small>kcal</small></div>` : ''}
<div class="stat"><span>Protein per 100 g</span><strong>${number(per100.protein)}</strong> <small>g</small></div>
<div class="stat"><span>Carbs / fat per 100 g</span><strong>${number(per100.carbs)}</strong> <small>g</small> · <strong>${number(per100.fat)}</strong> <small>g</small></div>
</div>
<div class="split" role="img" aria-label="Energy from protein ${number(shares.p, 0)}%, carbs ${number(shares.c, 0)}%, fat ${number(shares.f, 0)}%"><b class="p" style="width:${shares.p.toFixed(1)}%"></b><b class="c" style="width:${shares.c.toFixed(1)}%"></b><b class="f" style="width:${shares.f.toFixed(1)}%"></b></div>
<p class="legend"><span><i style="background:var(--protein)"></i>Protein ${number(shares.p, 0)}%</span><span><i style="background:var(--carbs)"></i>Carbs ${number(shares.c, 0)}%</span><span><i style="background:var(--fat)"></i>Fat ${number(shares.f, 0)}%</span><span>of calories</span></p>
<h2>Nutrition by serving</h2>
<div class="table-scroll"><table><thead><tr><th>Serving</th><th>kcal</th><th>Protein g</th><th>Carbs g</th><th>Fat g</th></tr></thead><tbody>
${portionRows.map(([label, grams]) => { const values = scale(per100, grams); return `<tr><td>${escapeHtml(label)}${label === '100 g' ? '' : `<small>${number(grams)} g</small>`}</td><td>${number(values.calories, 0)}</td><td>${number(values.protein)}</td><td>${number(values.carbs)}</td><td>${number(values.fat)}</td></tr>` }).join('\n')}
</tbody></table></div>
${ctaBlock(food)}
${related.length ? `<h2>More ${escapeHtml(food.category.toLowerCase())}</h2><ul class="links">${related.map((item) => `<li><a href="${item.path}">${escapeHtml(item.name)}</a> <small>${number(item.calories, 0)} kcal / 100 g</small></li>`).join('')}</ul>` : ''}
<p class="source">Source: USDA FoodData Central, SR Legacy, FDC ID <a href="https://fdc.nal.usda.gov/food-details/${food.fdcId}/nutrients" rel="nofollow">${food.fdcId}</a>.</p>`
  return page({
    title: `${food.name}: calories, protein, carbs and fat | NutrientTrack`,
    description,
    path: foodPath,
    body,
    jsonLd: breadcrumbLd([['Foods', '/foods/'], [food.category, `/foods/${categorySlug}/`], [food.name, foodPath]]),
  })
}

export const buildPages = (catalog) => {
  const pages = new Map()
  const usedSlugs = new Set()
  const categories = new Map()
  const entries = catalog.map((food) => {
    let slug = slugify(food.name) || `food-${food.fdcId}`
    if (usedSlugs.has(slug)) slug = `${slug}-${food.fdcId}`
    usedSlugs.add(slug)
    const categorySlug = slugify(food.category)
    const path = `/foods/${categorySlug}/${slug}/`
    if (!categories.has(categorySlug)) categories.set(categorySlug, { name: food.category, foods: [] })
    const item = { food, path, name: food.name, calories: food.per100g.calories }
    categories.get(categorySlug).foods.push(item)
    return { ...item, categorySlug }
  })
  for (const entry of entries) {
    const siblings = categories.get(entry.categorySlug).foods
    const index = siblings.indexOf(siblings.find((item) => item.path === entry.path))
    const related = [...siblings.slice(Math.max(0, index - 6), index), ...siblings.slice(index + 1, index + 7)].slice(0, 12)
    pages.set(entry.path, foodPage(entry.food, { categorySlug: entry.categorySlug, foodPath: entry.path, related }))
  }
  const sortedCategories = [...categories.entries()].sort((left, right) => left[1].name.localeCompare(right[1].name))
  for (const [categorySlug, category] of sortedCategories) {
    const path = `/foods/${categorySlug}/`
    pages.set(path, page({
      title: `${category.name}: calories and nutrition facts | NutrientTrack`,
      description: `Calories, protein, carbs and fat for ${category.foods.length} ${category.name.toLowerCase()} from USDA data, per 100 g and per household serving.`,
      path,
      jsonLd: breadcrumbLd([['Foods', '/foods/'], [category.name, path]]),
      body: `<nav class="crumbs" aria-label="Breadcrumb"><a href="/foods/">Foods</a></nav><h1>${escapeHtml(category.name)}</h1><p class="lede">${category.foods.length} foods with calories per 100 g. Open any food for servings and macros.</p>${ctaBlock()}<ul class="links">${category.foods.map((item) => `<li><a href="${item.path}">${escapeHtml(item.name)}</a> <small>${number(item.calories, 0)} kcal</small></li>`).join('')}</ul>`,
    }))
  }
  pages.set('/foods/', page({
    title: 'Food calorie and nutrition lookup | NutrientTrack',
    description: `Free calorie, protein, carb and fat facts for ${catalog.length.toLocaleString('en-US')} foods from USDA data, with household servings. Track them free with NutrientTrack.`,
    path: '/foods/',
    body: `<h1>Food nutrition lookup</h1><p class="lede">${catalog.length.toLocaleString('en-US')} foods from USDA FoodData Central, grouped by category.</p>${ctaBlock()}<ul class="links">${sortedCategories.map(([categorySlug, category]) => `<li><a href="/foods/${categorySlug}/">${escapeHtml(category.name)}</a> <small>${category.foods.length} foods</small></li>`).join('')}</ul>`,
  }))
  return pages
}

export const sitemapFor = (paths) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${['/', '/recipe-calories/', ...paths].map((path) => `<url><loc>${ORIGIN}${path}</loc></url>`).join('\n')}
</urlset>
`

const main = async () => {
  const catalog = JSON.parse(await fs.readFile(CATALOG, 'utf8'))
  const pages = buildPages(catalog)
  await fs.rm(join(OUT, 'foods'), { recursive: true, force: true })
  for (const [path, html] of pages) {
    const file = join(OUT, path, 'index.html')
    await fs.mkdir(dirname(file), { recursive: true })
    await fs.writeFile(file, html, 'utf8')
  }
  await fs.writeFile(join(OUT, 'foods', 'foods.css'), `${STYLES}\n`, 'utf8')
  await fs.writeFile(join(OUT, 'sitemap.xml'), sitemapFor([...pages.keys()]), 'utf8')
  console.log(`Wrote ${pages.size} food pages and sitemap.xml to ${OUT}`)
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('build-food-pages.mjs')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
