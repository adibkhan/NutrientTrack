import { useState } from 'react'
import type { DiaryEntry, Goals } from '../types'
import type { ContributorMetric, ContributorRange } from '../lib/contributors'
import { NutrientContributors } from './NutrientContributors'
import NutrientsCard from './NutrientsCard'


/** The Trends nutrients card with the contributors view below it: tapping a row in the card shows that nutrient's top sources. */
export function NutrientsSection({ entries, goals }: { entries: DiaryEntry[]; goals?: Goals }) {
  const [range, setRange] = useState<ContributorRange>(30)
  const [metric, setMetric] = useState<ContributorMetric>('calories')
  const select = (next: ContributorMetric) => {
    setMetric(next)
    const heading = document.getElementById('contributors-heading')
    heading?.scrollIntoView?.({ block: 'start' })
  }
  return (
    <>
      <NutrientsCard entries={entries} range={range} onRangeChange={setRange} onSelect={select} />
      <NutrientContributors entries={entries} goals={goals} metric={metric} onMetricChange={setMetric} range={range} onRangeChange={setRange} />
    </>
  )
}
