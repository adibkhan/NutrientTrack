import { useEffect, useMemo, useState } from 'react'
import type { CatalogFood } from '../catalog/types'
import { FoodGlyph } from '../components/FoodGlyph'
import { Icon } from '../components/Icon'
import { MAX_SERVINGS, calculateRecipe, clampServings, decodeRecipeHash, encodeRecipeHash, ingredientTotals, recipeLabelHtml, recipeLabelText } from '../lib/recipe'
import { formatNumber } from '../lib/utils'

const EXAMPLE = '2 cups rice\n1 lb chicken breast\n2 tbsp olive oil\n1 onion\n2 cloves garlic\n1 can tomatoes'

interface RecipeCalculatorProps {
  catalog: CatalogFood[] | null
  /** Where the app lives relative to this page, for the "open in NutrientTrack" link. */
  appHref?: string
}

const copyText = async (text: string): Promise<boolean> => {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Some browsers refuse without a recent tap; the code box below is there to copy by hand.
  }
  return false
}

/** The recipe calorie calculator: paste ingredients, set servings, read the label, copy it for a blog or a note. */
export function RecipeCalculator({ catalog, appHref = '../' }: RecipeCalculatorProps) {
  const fromHash = typeof window !== 'undefined' ? decodeRecipeHash(window.location.hash) : undefined
  const [text, setText] = useState(fromHash?.text ?? '')
  // Kept as typed so clearing the box to type a new number does not snap it back to 1 mid-edit.
  const [servingsText, setServingsText] = useState(String(fromHash?.servings ?? 4))
  const servings = clampServings(Number(servingsText))
  const [title, setTitle] = useState('')
  const [skipped, setSkipped] = useState<Set<number>>(new Set())
  const [showEmbed, setShowEmbed] = useState(false)
  const [copied, setCopied] = useState<'label' | 'text' | 'link' | null>(null)
  useEffect(() => { setSkipped(new Set()) }, [text])
  useEffect(() => {
    if (typeof window === 'undefined') return
    const hash = encodeRecipeHash(text, servings)
    if (window.location.hash !== hash) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`)
  }, [text, servings])
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(null), 1800)
    return () => window.clearTimeout(timer)
  }, [copied])

  const result = useMemo(() => (catalog ? calculateRecipe(text, servings, catalog, skipped) : null), [catalog, text, servings, skipped])
  const kept = result ? result.resolved.filter((_, index) => !skipped.has(index)) : []
  const hasRecipe = kept.length > 0
  const embedHtml = result && hasRecipe ? recipeLabelHtml(result, title) : ''
  const copy = async (kind: 'label' | 'text' | 'link') => {
    if (!result) return
    const ok = await copyText(kind === 'label' ? embedHtml : kind === 'text' ? recipeLabelText(result, title) : window.location.href)
    if (ok) setCopied(kind)
    else setShowEmbed(true)
  }

  return (
    <main className="recipe-page">
      <header className="recipe-hero">
        <a className="brand brand-link recipe-brand" href={appHref}><span className="brand-mark"><span /><span /></span><span className="brand-name">Nutrient<span>Track</span></span></a>
        <h1>Recipe calorie calculator</h1>
        <p>Paste your ingredients, one per line. Calories and macros per serving come from USDA data, worked out right here in your browser. Nothing is uploaded.</p>
      </header>

      <div className="recipe-grid">
        <section className="panel recipe-input" aria-label="Ingredients">
          <div className="form-field full">
            <label htmlFor="recipe-ingredients">Ingredients <span>one per line, with amounts</span></label>
            <textarea id="recipe-ingredients" className="recipe-textarea" rows={9} value={text} placeholder={EXAMPLE} spellCheck={false} onChange={(event) => setText(event.target.value)} />
          </div>
          <div className="recipe-input-row">
            <div className="form-field">
              <label htmlFor="recipe-servings">Servings</label>
              <input id="recipe-servings" type="number" inputMode="numeric" min={1} max={MAX_SERVINGS} value={servingsText} onChange={(event) => setServingsText(event.target.value)} onBlur={() => setServingsText(String(servings))} />
            </div>
            <div className="form-field recipe-title-field">
              <label htmlFor="recipe-title">Recipe name <span>optional, for the label</span></label>
              <input id="recipe-title" type="text" maxLength={80} value={title} placeholder="Chicken and rice" onChange={(event) => setTitle(event.target.value)} />
            </div>
          </div>
          {!text.trim() && <button className="text-button" type="button" onClick={() => setText(EXAMPLE)}>Try an example <Icon name="arrow-right" size={15} /></button>}
          {catalog === null && text.trim() && <p className="field-hint">Loading the food catalog…</p>}
          {result && result.resolved.length > 0 && (
            <ul className="recipe-ingredients" aria-label="Matched ingredients">
              {result.resolved.map((item, index) => skipped.has(index) ? null : (
                <li key={`${index}-${item.food.id}`}>
                  <FoodGlyph name={item.food.name} category={item.food.category} />
                  <span className="describe-copy"><strong>{item.food.name}</strong><small>{item.amountLabel} · {formatNumber(item.grams, 0)} g · {formatNumber(ingredientTotals(item).calories)} kcal</small></span>
                  <button className="icon-button quiet" type="button" aria-label={`Remove ${item.food.name}`} onClick={() => setSkipped(new Set([...skipped, index]))}><Icon name="x" size={15} /></button>
                </li>
              ))}
            </ul>
          )}
          {result && result.unmatched.length > 0 && <p className="field-hint warn">No match for {result.unmatched.map((item) => `“${item.text}”`).join(', ')}. Try a plainer name, like “chicken breast” or “cheddar”.</p>}
          {result && result.resolved.length > 0 && <p className="field-hint">Check each match. A line like “1 onion” uses the USDA size for a medium one; write the grams to be exact.</p>}
        </section>

        <section className="panel recipe-label-panel" aria-label="Nutrition per serving">
          {!hasRecipe ? (
            <div className="recipe-empty"><span className="empty-orb"><Icon name="food" size={20} /></span><p>Your label appears here as you type.</p></div>
          ) : result && (
            <>
              <div className="recipe-label" aria-live="polite">
                <p className="recipe-label-title">Nutrition Facts</p>
                <p className="recipe-label-sub">{title.trim() || 'Recipe'} · {result.servings} {result.servings === 1 ? 'serving' : 'servings'} · per serving</p>
                <p className="metric-value recipe-calories">{formatNumber(result.perServing.calories)} <small>kcal</small></p>
                <dl className="recipe-macros">
                  <div><dt>Protein</dt><dd>{formatNumber(result.perServing.protein, 1)} g</dd></div>
                  <div><dt>Carbs</dt><dd>{formatNumber(result.perServing.carbs, 1)} g</dd></div>
                  <div><dt>Fat</dt><dd>{formatNumber(result.perServing.fat, 1)} g</dd></div>
                </dl>
                <p className="recipe-whole">Whole recipe: {formatNumber(result.total.calories)} kcal · {formatNumber(result.total.protein, 0)} g protein · {formatNumber(result.total.carbs, 0)} g carbs · {formatNumber(result.total.fat, 0)} g fat</p>
              </div>
              <div className="recipe-actions">
                <button className="button primary" type="button" onClick={() => void copy('label')}><Icon name="copy" size={16} />{copied === 'label' ? 'Copied' : 'Copy label for your blog'}</button>
                <button className="button secondary" type="button" onClick={() => void copy('text')}>{copied === 'text' ? 'Copied' : 'Copy as text'}</button>
                <button className="button secondary" type="button" onClick={() => void copy('link')}>{copied === 'link' ? 'Copied' : 'Copy link'}</button>
                <button className="text-button" type="button" aria-expanded={showEmbed} onClick={() => setShowEmbed((open) => !open)}>{showEmbed ? 'Hide embed code' : 'Show embed code'}</button>
              </div>
              {showEmbed && (
                <div className="form-field full">
                  <label htmlFor="recipe-embed">Embed code <span>paste into any page</span></label>
                  <textarea id="recipe-embed" className="recipe-embed" rows={5} readOnly value={embedHtml} onFocus={(event) => event.target.select()} />
                </div>
              )}
              <p className="field-hint">Want it in your diary? <a href={`${appHref}?text=${encodeURIComponent(text.trim().replace(/\n+/g, ', '))}`}>Open these ingredients in NutrientTrack</a>, the free diary that keeps your food on your phone.</p>
            </>
          )}
        </section>
      </div>

      <footer className="recipe-footer">
        <p>Values are estimates from USDA SR Legacy data, per 100 g and USDA household measures. Cooking changes weight, not calories: weigh raw where you can. <a href={`${appHref}foods/`}>Browse the food catalog</a>.</p>
      </footer>
    </main>
  )
}
