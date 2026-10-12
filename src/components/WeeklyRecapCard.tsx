import { useRef, useState } from 'react'
import type { WeeklyRecap } from '../lib/recap'
import { PIP_STAGES, type PipGrowth } from '../lib/pipGrowth'
import { formatNumber, formatShortDate } from '../lib/utils'
import { PipFigure } from './Mascot'
import { Icon } from './Icon'
import { GrowthPath } from './GrowthPath'

interface WeeklyRecapCardProps {
  recap: WeeklyRecap
  growth: PipGrowth
  unit: 'lb' | 'kg'
  onNotify: (message: string) => void
}

const weekday = (date: string) => new Intl.DateTimeFormat(undefined, { weekday: 'narrow' }).format(new Date(`${date}T12:00:00`))
const stageStart = (growth: PipGrowth) => PIP_STAGES[growth.stage].days
const signed = (value: number, unit: string) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatNumber(Math.abs(value), 1)} ${unit}`

/** The last seven days at a glance, with a shareable image made on the device. Weight stays out of the image unless asked. */
export function WeeklyRecapCard({ recap, growth, unit, onNotify }: WeeklyRecapCardProps) {
  const pipRef = useRef<HTMLDivElement>(null)
  const [showPath, setShowPath] = useState(false)
  const [includeWeight, setIncludeWeight] = useState(false)
  const [busy, setBusy] = useState(false)
  const range = `${formatShortDate(recap.start)} – ${formatShortDate(recap.end)}`
  const stats = [
    { label: 'Days logged', value: `${recap.daysLogged}/7` },
    { label: 'Foods logged', value: formatNumber(recap.foodsLogged) },
    { label: 'Avg energy', value: recap.avgCalories === undefined ? '—' : `${formatNumber(recap.avgCalories)} kcal` },
    { label: 'Avg protein', value: recap.avgProtein === undefined ? '—' : `${formatNumber(recap.avgProtein)} g` },
  ]

  const share = async () => {
    setBusy(true)
    try {
      const blob = await drawRecap({ recap, range, stats, growthLabel: `Pip is ${growth.name.toLowerCase()} · ${growth.days} days logged`, weight: includeWeight && recap.trendChange !== undefined ? signed(recap.trendChange, unit) : undefined, pip: pipRef.current?.querySelector('svg') ?? null })
      const file = new File([blob], `nutrienttrack-week-${recap.end}.png`, { type: 'image/png' })
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'My week on NutrientTrack' })
      } else {
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = file.name
        anchor.click()
        URL.revokeObjectURL(url)
        onNotify('Recap image saved.')
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) onNotify('The recap image could not be made on this browser.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel recap-card" aria-labelledby="recap-title">
      <div className="recap-head">
        <div>
          <h2 id="recap-title">Your week</h2>
          <p className="page-description">{range}</p>
        </div>
        <div className="recap-pip" ref={pipRef}><PipFigure mood={recap.daysLogged >= 5 ? 'cheer' : recap.daysLogged >= 3 ? 'proud' : 'wave'} size={56} stage={growth.stage} /></div>
      </div>
      <div className="recap-days" aria-label={`${recap.daysLogged} of 7 days logged`}>
        {recap.days.map((day) => <span key={day.date} className={day.logged ? 'logged' : ''}><i aria-hidden="true">{day.logged && <Icon name="check" size={12} />}</i><small>{weekday(day.date)}</small></span>)}
      </div>
      <div className="recap-stats">
        {stats.map((stat) => <div key={stat.label}><span>{stat.label}</span><strong>{stat.value}</strong></div>)}
      </div>
      <div className="recap-growth">
        <span><strong>Pip is {growth.name.toLowerCase()}</strong> · {growth.days} {growth.days === 1 ? 'day' : 'days'} logged</span>
        <button className="recap-growth-next" type="button" aria-expanded={showPath} onClick={() => setShowPath((open) => !open)}>{growth.next ? `${growth.next.remaining} more to ${growth.next.name.toLowerCase()}` : 'Fully grown'}<Icon name="chevron-down" size={14} className={showPath ? 'is-open' : ''} /></button>
        <span className="recap-growth-bar" aria-hidden="true"><b style={{ width: `${growth.next ? Math.min(100, ((growth.days - stageStart(growth)) / (growth.next.remaining + growth.days - stageStart(growth))) * 100) : 100}%` }} /></span>
        {showPath && <GrowthPath growth={growth} />}
      </div>
      {recap.trendChange !== undefined && <p className="recap-weight">Trend weight this week: <strong>{signed(recap.trendChange, unit)}</strong></p>}
      <div className="recap-actions">
        {recap.trendChange !== undefined && <label className="recap-include"><input type="checkbox" checked={includeWeight} onChange={(event) => setIncludeWeight(event.target.checked)} />Include weight in the image</label>}
        <button className="button secondary compact" type="button" disabled={busy || recap.daysLogged === 0} onClick={() => { void share() }}><Icon name="upload" size={15} />{busy ? 'Making image…' : 'Share recap'}</button>
      </div>
    </section>
  )
}

const cssVar = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

/** Pip as an image: copy the computed colours onto a clone, since CSS variables do not reach an SVG drawn into a canvas. */
const pipImage = async (svg: SVGSVGElement | null): Promise<HTMLImageElement | null> => {
  if (!svg) return null
  const clone = svg.cloneNode(true) as SVGSVGElement
  const live = svg.querySelectorAll('*')
  clone.querySelectorAll('*').forEach((node, index) => {
    const style = getComputedStyle(live[index])
    for (const property of ['fill', 'stroke', 'opacity', 'stroke-width', 'stroke-linecap', 'font-size', 'font-weight', 'stop-color', 'stop-opacity']) node.setAttribute(property, style.getPropertyValue(property))
    node.removeAttribute('class')
    // Inline styles hold var() colours that a standalone image cannot resolve; the copied attributes carry the real values.
    node.removeAttribute('style')
  })
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', '200')
  clone.setAttribute('height', '240')
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }))
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('pip')); image.src = url })
    return image
  } catch {
    return null
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

const roundRect = (context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) => {
  context.beginPath()
  context.moveTo(x + radius, y)
  context.arcTo(x + width, y, x + width, y + height, radius)
  context.arcTo(x + width, y + height, x, y + height, radius)
  context.arcTo(x, y + height, x, y, radius)
  context.arcTo(x, y, x + width, y, radius)
  context.closePath()
}

async function drawRecap({ recap, range, stats, growthLabel, weight, pip }: { recap: WeeklyRecap; range: string; stats: Array<{ label: string; value: string }>; growthLabel: string; weight?: string; pip: SVGSVGElement | null }): Promise<Blob> {
  const width = 1080
  const height = 1350
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('canvas')
  const font = (size: number, weightValue = 600) => `${weightValue} ${size}px "IBM Plex Sans", system-ui, sans-serif`
  const colors = {
    page: cssVar('--pip-soft', '#effaf2'), card: cssVar('--surface', '#ffffff'), line: cssVar('--pip-line', '#cdeed7'),
    ink: cssVar('--ink', '#101828'), muted: cssVar('--muted', '#667085'), accent: cssVar('--pip-body', '#5cbf7c'), soft: cssVar('--surface-soft', '#f4f5f7'),
  }
  await document.fonts?.ready
  context.fillStyle = colors.page
  context.fillRect(0, 0, width, height)
  roundRect(context, 60, 60, width - 120, height - 120, 40)
  context.fillStyle = colors.card
  context.fill()
  context.strokeStyle = colors.line
  context.lineWidth = 3
  context.stroke()

  context.fillStyle = colors.ink
  context.font = font(72, 700)
  context.fillText('My week', 120, 210)
  context.fillStyle = colors.muted
  context.font = font(36, 400)
  context.fillText(range, 120, 268)
  const image = await pipImage(pip)
  if (image) context.drawImage(image, width - 120 - 210, 96, 200, 240)

  // Seven day dots.
  const dotY = 410
  recap.days.forEach((day, index) => {
    const x = 160 + index * 128
    context.beginPath()
    context.arc(x, dotY, 40, 0, Math.PI * 2)
    context.fillStyle = day.logged ? colors.accent : colors.soft
    context.fill()
    context.fillStyle = colors.muted
    context.font = font(28, 600)
    context.textAlign = 'center'
    context.fillText(weekday(day.date), x, dotY + 84)
    context.textAlign = 'start'
  })

  // Two by two stat tiles.
  stats.forEach((stat, index) => {
    const x = 120 + (index % 2) * 430
    const y = 560 + Math.floor(index / 2) * 220
    roundRect(context, x, y, 410, 190, 28)
    context.fillStyle = colors.soft
    context.fill()
    context.fillStyle = colors.muted
    context.font = font(30, 500)
    context.fillText(stat.label, x + 36, y + 62)
    context.fillStyle = colors.ink
    context.font = font(58, 700)
    context.fillText(stat.value, x + 36, y + 142)
  })

  let footerY = 1060
  if (weight) {
    context.fillStyle = colors.ink
    context.font = font(36, 600)
    context.fillText(`Trend weight: ${weight}`, 120, footerY)
    footerY += 70
  }
  context.fillStyle = colors.muted
  context.font = font(30, 500)
  context.fillText(recap.streak >= 2 ? `${recap.streak}-day logging streak · ${growthLabel}` : growthLabel, 120, footerY)
  context.fillStyle = colors.ink
  context.font = font(32, 700)
  context.fillText('nutrienttrack.com · free, private, no ads', 120, height - 120)

  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('blob'))), 'image/png'))
}
