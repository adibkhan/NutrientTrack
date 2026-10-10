import type { ReactNode } from 'react'
import { foodKind, type FoodKind } from '../lib/foodKind'

// Line pictures on a 24 grid, drawn with currentColor so each family's tint comes from the stylesheet tokens.
const PATHS: Record<FoodKind, ReactNode> = {
  fruit: <><path d="M12 8.5c-1.6-1.4-5.5-1.6-6.6 1.9-1 3.2.8 8.6 3.8 9.9 1.2.5 1.9 0 2.8 0s1.6.5 2.8 0c3-1.3 4.8-6.7 3.8-9.9-1.1-3.5-5-3.3-6.6-1.9Z" /><path d="M12 8.5c0-2 .6-3.4 2-4.5" /><path d="M13.2 5.6c1.6-1 3.4-.8 4.3.2-1.3 1.2-3 1.3-4.3-.2Z" /></>,
  veg: <><path d="M5 19c0-7 5-12 14-14-1 9-6 14-13 14" /><path d="M5 19 13 11" /></>,
  meat: <><path d="M14.5 4.5a5 5 0 0 1 3.5 8.6c-1.6 1.6-3.7 1.9-5.3 1.4l-2.6 2.6a1.9 1.9 0 1 1-2.6 2.6 1.9 1.9 0 1 1-1.9-3.1 1.9 1.9 0 0 1 2.8-.6l2.6-2.6c-.5-1.6-.2-3.7 1.4-5.3a5 5 0 0 1 2.1-3.6Z" /></>,
  fish: <><path d="M3 12c3-4.5 9-6 13-2.5L20 7v10l-4-2.5C12 18 6 16.5 3 12Z" /><circle cx="8.5" cy="11" r=".9" fill="currentColor" stroke="none" /></>,
  egg: <><path d="M12 3.5c-3.3 0-6 5.4-6 9.5a6 6 0 0 0 12 0c0-4.1-2.7-9.5-6-9.5Z" /><circle cx="12" cy="14" r="2.4" /></>,
  dairy: <><path d="M8 3.5h8M8.5 3.5v3L6.5 9.5v11h11v-11l-2-3v-3" /><path d="M6.5 13h11" /></>,
  grain: <><path d="M5 10a4 4 0 0 1 3-6.5h8A4 4 0 0 1 19 10v10H5Z" /><path d="M9 12.5h6M9 16h6" /></>,
  drink: <><path d="M5 8h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5Z" /><path d="M16 9.5h1.5a2.5 2.5 0 0 1 0 5H16" /><path d="M8.5 4.5c0 1 1 1 1 2M12 4.5c0 1 1 1 1 2" /></>,
  sweet: <><path d="M5 11h14l-1.8 8.5H6.8Z" /><path d="M5 11a7 7 0 0 1 14 0" /><path d="M10 7.5h.01M14 8.5h.01" /></>,
  nut: <><path d="M12 9c-3.6 0-6 2.4-6 5.5S9 21 12 21s6-3.4 6-6.5S15.6 9 12 9Z" /><path d="M5.5 9.5c0-3 3-5.5 6.5-5.5s6.5 2.5 6.5 5.5Z" /><path d="M12 4V2.5" /></>,
  legume: <><path d="M7.5 18.5c-3.5-3.5-1-11 5-12.5 4.4-1.1 7 2 5.5 5-1.1 2.2-3.6 2.1-4.9 3.5-1.6 1.8-2.6 7-5.6 4Z" /><path d="M10 13.5c.8-1.2 1.8-2 3-2.5" /></>,
  meal: <><path d="M3.5 12h17a8.5 8.5 0 0 1-17 0Z" /><path d="M8 8.5c0-1.2 1-1.2 1-2.5M12 8.5c0-1.2 1-1.2 1-2.5M16 8.5c0-1.2 1-1.2 1-2.5" /></>,
}

/** Tinted picture of a food's family. Falls back to a bowl for anything it cannot place. */
export function FoodGlyph({ name, category, large = false }: { name: string; category?: string; large?: boolean }) {
  const kind = foodKind(name, category)
  const size = large ? 20 : 18
  return <span className={`food-avatar food-kind-${kind} ${large ? 'large' : ''}`} data-kind={kind} aria-hidden="true">
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{PATHS[kind]}</svg>
  </span>
}
