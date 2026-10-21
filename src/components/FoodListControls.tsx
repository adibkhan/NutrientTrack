import type { FoodSort } from '../lib/foodSearch'
import { Icon } from './Icon'

interface FoodListControlsProps {
  query: string
  sort: FoodSort
  onQuery: (query: string) => void
  onSort: (sort: FoodSort) => void
}

/** Search box and sort selector for a long saved-foods list. */
export function FoodListControls({ query, sort, onQuery, onSort }: FoodListControlsProps) {
  return (
    <div className="food-list-controls">
      <label className="search-input-wrap" htmlFor="foods-search"><Icon name="search" size={18} /><input id="foods-search" type="search" aria-label="Search saved foods" placeholder="Search" value={query} onChange={(event) => onQuery(event.target.value)} /></label>
      <select aria-label="Sort saved foods" value={sort} onChange={(event) => onSort(event.target.value as FoodSort)}>
        <option value="recent">Recent</option>
        <option value="az">A to Z</option>
        <option value="used">Most used</option>
      </select>
    </div>
  )
}
