import { useState, type FormEvent } from 'react'
import type { Food, RecipeIngredient } from '../types'
import { ingredientFromFood, isRecipe, recipePerServing } from '../lib/recipes'
import { formatNumber, newId } from '../lib/utils'
import { Icon } from './Icon'
import { Modal } from './Modal'

export interface RecipeDraft {
  name: string
  servings: number
  ingredients: RecipeIngredient[]
}

interface RecipeModalProps {
  recipe?: Food
  foods: Food[]
  onClose: () => void
  onSave: (draft: RecipeDraft, existing?: Food) => Promise<void>
}

interface Line {
  key: string
  name: string
  calories: string
  protein: string
  carbs: string
  fat: string
  quantity?: number
  foodId?: string
}

const toLine = (ingredient: RecipeIngredient): Line => ({
  key: newId(),
  name: ingredient.name,
  calories: String(ingredient.calories),
  protein: String(ingredient.protein),
  carbs: String(ingredient.carbs),
  fat: String(ingredient.fat),
  quantity: ingredient.quantity,
  foodId: ingredient.foodId,
})

const number = (text: string): number => {
  const parsed = Number(text)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

const fromLine = (line: Line): RecipeIngredient => ({
  name: line.name.trim(),
  calories: number(line.calories),
  protein: number(line.protein),
  carbs: number(line.carbs),
  fat: number(line.fat),
  ...(line.quantity !== undefined ? { quantity: line.quantity } : {}),
  ...(line.foodId ? { foodId: line.foodId } : {}),
})

export function RecipeModal({ recipe, foods, onClose, onSave }: RecipeModalProps) {
  const [name, setName] = useState(recipe?.name ?? '')
  const [servings, setServings] = useState(String(recipe?.recipeServings ?? 1))
  const [lines, setLines] = useState<Line[]>(() => (recipe?.ingredients ?? []).map(toLine))
  const [pickId, setPickId] = useState('')
  const [pickQuantity, setPickQuantity] = useState('1')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // A recipe cannot contain itself, and nesting recipes would hide where the numbers come from.
  const pickable = foods.filter((food) => food.id !== recipe?.id && !isRecipe(food))
  const servingsNumber = Number(servings)
  const perServing = recipePerServing(lines.map(fromLine), servingsNumber)
  const update = (key: string, patch: Partial<Line>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))

  const addSaved = () => {
    const food = pickable.find((candidate) => candidate.id === pickId)
    if (!food) return
    const quantity = Number(pickQuantity)
    setLines((current) => [...current, toLine(ingredientFromFood(food, Number.isFinite(quantity) && quantity > 0 ? quantity : 1))])
    setPickId('')
    setPickQuantity('1')
  }
  const addCustom = () => setLines((current) => [...current, { key: newId(), name: '', calories: '', protein: '', carbs: '', fat: '' }])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    if (!name.trim()) { setError('Give this recipe a name.'); return }
    if (!(servingsNumber > 0) || !Number.isFinite(servingsNumber)) { setError('Enter how many servings the recipe makes, more than zero.'); return }
    if (lines.length === 0) { setError('Add at least one ingredient.'); return }
    if (lines.some((line) => !line.name.trim())) { setError('Give every ingredient a name.'); return }
    setError('')
    setSaving(true)
    try { await onSave({ name: name.trim(), servings: servingsNumber, ingredients: lines.map(fromLine) }, recipe) } finally { setSaving(false) }
  }

  return (
    <Modal eyebrow={recipe ? 'Edit recipe' : 'Your library'} title={recipe ? 'Update recipe' : 'Create a recipe'} onClose={onClose} closeOnBackdrop={false}>
      <form className="modal-form recipe-form" onSubmit={submit}>
        <div className="form-field full">
          <label htmlFor="recipe-name">Recipe name</label>
          <input autoFocus id="recipe-name" placeholder="e.g. Overnight oats" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="form-field full">
          <label htmlFor="recipe-servings">Servings made</label>
          <input id="recipe-servings" inputMode="decimal" min="0" step="any" type="number" value={servings} onChange={(event) => setServings(event.target.value)} />
        </div>
        <div className="recipe-lines" aria-label="Ingredients">
          {lines.length === 0 && <p className="logger-empty-line">No ingredients yet. Add a saved food below, or a custom line.</p>}
          {lines.map((line, index) => (
            <div className="recipe-line" key={line.key}>
              <div className="recipe-line-top">
                <input aria-label={`Ingredient ${index + 1} name`} placeholder="Ingredient" value={line.name} onChange={(event) => update(line.key, { name: event.target.value })} />
                <button className="icon-button quiet danger-hover" type="button" aria-label={`Remove ingredient ${index + 1}`} onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}><Icon name="trash" size={16} /></button>
              </div>
              <div className="recipe-line-macros">
                {(['calories', 'protein', 'carbs', 'fat'] as const).map((key) => (
                  <input key={key} aria-label={`Ingredient ${index + 1} ${key}`} inputMode="decimal" min="0" placeholder={key === 'calories' ? 'kcal' : `${key[0].toUpperCase()} g`} step="any" type="number" value={line[key]} onChange={(event) => update(line.key, { [key]: event.target.value })} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="recipe-add">
          <div className="form-field">
            <label htmlFor="recipe-pick">Add a saved food</label>
            <select id="recipe-pick" value={pickId} onChange={(event) => setPickId(event.target.value)}>
              <option value="">Choose…</option>
              {pickable.map((food) => <option key={food.id} value={food.id}>{food.name} · {food.serving}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="recipe-quantity">Servings</label>
            <input id="recipe-quantity" inputMode="decimal" min="0" step="any" type="number" value={pickQuantity} onChange={(event) => setPickQuantity(event.target.value)} />
          </div>
          <button className="button secondary compact" type="button" disabled={!pickId} onClick={addSaved}><Icon name="plus" size={15} />Add</button>
        </div>
        <button className="button secondary compact" type="button" onClick={addCustom}><Icon name="plus" size={15} />Add a custom ingredient</button>
        <div className="nutrition-preview" aria-live="polite">
          <div><span>Per serving</span><strong>{formatNumber(perServing.calories, 1)}<small>kcal</small></strong></div>
          <div><span><i className="macro-dot protein" />Protein</span><strong>{formatNumber(perServing.protein, 1)}<small>g</small></strong></div>
          <div><span><i className="macro-dot carbs" />Carbs</span><strong>{formatNumber(perServing.carbs, 1)}<small>g</small></strong></div>
          <div><span><i className="macro-dot fat" />Fat</span><strong>{formatNumber(perServing.fat, 1)}<small>g</small></strong></div>
        </div>
        {error && <p className="form-error" role="alert"><Icon name="info" size={15} />{error}</p>}
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="button primary" disabled={saving} type="submit"><Icon name="check" size={16} />{saving ? 'Saving…' : recipe ? 'Save recipe' : 'Create recipe'}</button>
        </div>
      </form>
    </Modal>
  )
}
