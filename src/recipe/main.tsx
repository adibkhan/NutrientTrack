import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { loadCatalog } from '../catalog'
import type { CatalogFood } from '../catalog/types'
import { RecipeCalculator } from './RecipeCalculator'
import '../styles.css'
import './recipe.css'

/** The page lives one folder below the app, so the catalog and the app links are relative to its parent. */
function Page() {
  const [catalog, setCatalog] = useState<CatalogFood[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    void loadCatalog('../data/usda-common-v2.json').then((loaded) => { if (live) setCatalog(loaded) }).catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [])
  return <>
    {failed && <p className="recipe-error" role="alert">The food catalog could not be loaded. Check your connection and reload.</p>}
    <RecipeCalculator catalog={catalog} appHref="../" />
  </>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
)
