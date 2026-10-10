import { useEffect, useId, useRef, useState } from 'react'
import type { MascotLine, MascotMood } from '../lib/mascot'
import type { PipGrowth, PipStage } from '../lib/pipGrowth'
import { Icon } from './Icon'

/** What grows out of Pip's head at each stage: a sprout, a seedling, a bud, a flower, then a flower with a glow. */
function PipCrown({ stage, leafFill }: { stage: PipStage; leafFill: { fill: string } }) {
  if (stage === 0) return <>
    <path className="pip-stem" d="M40 17 C40 13 40 11 41 8" />
    <path className="pip-leaf" style={leafFill} d="M41 9 C45 3 53 3 56 6 C52 11 46 12 41 9 Z" />
    <path className="pip-vein" d="M42 8.8 C46 7 50 6.2 54 6.2" />
    <path className="pip-leaf pip-leaf-small" style={leafFill} d="M40 11 C36 6 30 6 27 8 C30 13 36 13 40 11 Z" />
    <path className="pip-vein" d="M39 10.8 C35 9.2 31.5 8.4 28.5 8.3" />
  </>
  const tall = stage >= 2
  const top = tall ? -1 : 2
  return <>
    <path className="pip-stem" d={`M40 17 C40 12 40 ${top + 6} 41 ${top}`} />
    <path className="pip-leaf" style={leafFill} d="M40.5 10 C46 2 56 2 60 6 C55 12 47 13 40.5 10 Z" />
    <path className="pip-vein" d="M42 9.6 C47 7 52.5 6.2 58 6.2" />
    <path className="pip-leaf pip-leaf-small" style={leafFill} d="M40 12 C34 5 26 5 22 8 C26 14 34 15 40 12 Z" />
    <path className="pip-vein" d="M38.5 11.6 C33.5 9.2 28.5 8.3 24 8.3" />
    {stage === 1 && <path className="pip-leaf" style={leafFill} d="M41 3 C42 -3 48 -6 52 -5 C51 0 46 4 41 3 Z" />}
    {stage === 2 && <>
      <path className="pip-leaf pip-leaf-small" style={leafFill} d="M41 1 C39 -2 39 -5 41 -6 C43 -5 43 -2 41 1 Z" />
      <ellipse className="pip-bud" cx="41" cy="-7" rx="4" ry="5.5" />
    </>}
    {stage >= 3 && <g className="pip-flower">
      {[0, 72, 144, 216, 288].map((angle) => <circle key={angle} className="pip-petal" cx={41 + 5.2 * Math.sin((angle * Math.PI) / 180)} cy={-7 - 5.2 * Math.cos((angle * Math.PI) / 180)} r="4.2" />)}
      <circle className="pip-flower-center" cx="41" cy="-7" r="3" />
    </g>}
  </>
}

/** Pip: a small sprouting pea that grows as days are logged. Drawn inline so it works offline and takes its colours from the theme tokens. */
export function PipFigure({ mood, size = 56, stage = 0 }: { mood: MascotMood; size?: number; stage?: PipStage }) {
  const id = useId().replace(/:/g, '')
  const [poked, setPoked] = useState(0)
  const svgRef = useRef<SVGSVGElement>(null)
  const canLook = mood !== 'happy' && mood !== 'proud' && mood !== 'sleepy'
  // On devices with a pointer, Pip's eyes follow it. Phones have no hover, so they keep the idle glances.
  useEffect(() => {
    if (!canLook || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    if (!window.matchMedia('(hover: hover)').matches || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let frame = 0
    const onMove = (event: PointerEvent) => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        const svg = svgRef.current
        if (!svg) return
        const box = svg.getBoundingClientRect()
        const dx = event.clientX - (box.left + box.width / 2)
        const dy = event.clientY - (box.top + box.height * 0.45)
        const distance = Math.hypot(dx, dy) || 1
        const reach = Math.min(1, distance / 160) * 2.4
        svg.style.setProperty('--pip-look-x', `${((dx / distance) * reach).toFixed(2)}px`)
        svg.style.setProperty('--pip-look-y', `${((dy / distance) * reach * 0.7).toFixed(2)}px`)
      })
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => { window.removeEventListener('pointermove', onMove); if (frame) window.cancelAnimationFrame(frame) }
  }, [canLook])
  const armsUp = mood === 'cheer'
  const waving = mood === 'wave'
  const happyEyes = mood === 'happy' || mood === 'proud'
  const bodyFill = { fill: `url(#${id}-body)` }
  const bellyFill = { fill: `url(#${id}-belly)` }
  const leafFill = { fill: `url(#${id}-leaf)` }
  // The view box leaves headroom above the body for the bud and flower of later stages.
  return (
    <svg className={`pip pip-${mood} pip-stage-${stage} ${poked ? 'pip-poked' : ''}`} key={poked} ref={svgRef} viewBox="0 -16 80 96" width={size} height={(size * 96) / 80} aria-hidden="true" focusable="false" onPointerDown={() => setPoked((count) => count + 1)}>
      <defs>
        <radialGradient id={`${id}-body`} cx="36%" cy="28%" r="78%">
          <stop offset="0" style={{ stopColor: 'var(--pip-belly)' }} />
          <stop offset="0.38" style={{ stopColor: 'var(--pip-body)' }} />
          <stop offset="1" style={{ stopColor: 'var(--pip-shade)' }} />
        </radialGradient>
        <linearGradient id={`${id}-belly`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--pip-belly)', stopOpacity: 0 }} />
          <stop offset="1" style={{ stopColor: 'var(--pip-belly)', stopOpacity: 0.85 }} />
        </linearGradient>
        <radialGradient id={`${id}-halo`} cx="50%" cy="50%" r="50%">
          <stop offset="0" style={{ stopColor: 'var(--pip-halo)', stopOpacity: 0.32 }} />
          <stop offset="0.6" style={{ stopColor: 'var(--pip-halo)', stopOpacity: 0.14 }} />
          <stop offset="1" style={{ stopColor: 'var(--pip-halo)', stopOpacity: 0 }} />
        </radialGradient>
        <linearGradient id={`${id}-leaf`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: 'var(--pip-leaf)' }} />
          <stop offset="1" style={{ stopColor: 'var(--pip-leaf-light)' }} />
        </linearGradient>
      </defs>
      {stage === 4 && <circle className="pip-halo" style={{ fill: `url(#${id}-halo)` }} cx="40" cy="36" r="44" />}
      <ellipse className="pip-shadow" cx="40" cy="74.5" rx="19" ry="3.2" />
      {mood === 'cheer' && <path className="pip-dust pip-dust-left" d="M22 70 q-5 -1 -8 2" />}
      {mood === 'cheer' && <path className="pip-dust pip-dust-right" d="M58 70 q5 -1 8 2" />}
      {mood === 'cheer' && <g className="pip-confetti" aria-hidden="true">
        {[[12, 20, 'a'], [22, 8, 'b'], [40, 2, 'c'], [58, 8, 'a'], [68, 20, 'b'], [16, 44, 'c'], [64, 44, 'a'], [30, 12, 'b'], [50, 12, 'c'], [8, 32, 'b'], [72, 32, 'c']].map(([x, y, tone], index) => (
          <rect key={index} className={`pip-confetto pip-confetto-${tone}`} x={Number(x) - 1.6} y={Number(y) - 1.6} width="3.2" height="3.2" rx="0.8" style={{ animationDelay: `${0.15 + (index % 5) * 0.09}s`, transformOrigin: `${x}px ${y}px` }} />
        ))}
      </g>}
      <g className="pip-body-group">
        <g className="pip-crown"><PipCrown stage={stage} leafFill={leafFill} /></g>
        {/* Arms: stubby capsules behind the body, with a slightly darker underside. */}
        {armsUp ? <>
          <g className="pip-cheer-arm pip-cheer-left"><path className="pip-arm pip-arm-still" d="M21 36 L13 25" /></g>
          <g className="pip-cheer-arm pip-cheer-right"><path className="pip-arm pip-arm-still" d="M59 36 L67 25" /></g>
        </> : <>
          <path className="pip-arm pip-arm-left" d="M20 47 L13 55" />
          {waving
            ? <g className="pip-wave-arm"><path className="pip-arm pip-arm-still" d="M60 40 L69 29" /></g>
            : <path className="pip-arm pip-arm-right" d="M60 47 L67 55" />}
        </>}
        {/* Feet */}
        <ellipse className="pip-foot" cx="30.5" cy="69.5" rx="6.5" ry="3.8" />
        <ellipse className="pip-foot" cx="49.5" cy="69.5" rx="6.5" ry="3.8" />
        {/* Body: a rounded pea, a touch wider at the bottom, lit from the top left. */}
        <path className="pip-body" style={bodyFill} d="M40 16 C55 16 65 28 65.5 43 C66 58 55 70 40 70 C25 70 14 58 14.5 43 C15 28 25 16 40 16 Z" />
        <ellipse className="pip-belly" style={bellyFill} cx="40" cy="52" rx="15.5" ry="13.5" />
        <ellipse className="pip-shine" cx="29" cy="27" rx="5.5" ry="3" transform="rotate(-32 29 27)" />
        <circle className="pip-shine" cx="36.5" cy="22.5" r="1.4" />
        {/* Face */}
        {mood === 'sleepy' ? <>
          <path className="pip-line" d="M27 41 Q31.5 45 36 41" />
          <path className="pip-line" d="M44 41 Q48.5 45 53 41" />
          <path className="pip-line pip-lash" d="M28 43.5 L26.5 45.5" />
          <path className="pip-line pip-lash" d="M52 43.5 L53.5 45.5" />
        </> : happyEyes ? <>
          <path className="pip-line pip-eye-arc" d="M27 42 Q31.5 35.5 36 42" />
          <path className="pip-line pip-eye-arc" d="M44 42 Q48.5 35.5 53 42" />
        </> : <g className="pip-eyes">
          <g className="pip-glance"><g className="pip-look">
            <ellipse className="pip-eye" cx="31.5" cy="41" rx="3.7" ry="4.3" />
            <ellipse className="pip-eye" cx="48.5" cy="41" rx="3.7" ry="4.3" />
            <circle className="pip-eye-glint" cx="33" cy="39.2" r="1.5" />
            <circle className="pip-eye-glint" cx="50" cy="39.2" r="1.5" />
            <circle className="pip-eye-glint" cx="30" cy="43" r="0.7" />
            <circle className="pip-eye-glint" cx="47" cy="43" r="0.7" />
          </g></g>
        </g>}
        <ellipse className="pip-cheek" cx="24" cy="48.5" rx="4.6" ry="2.7" />
        <ellipse className="pip-cheek" cx="56" cy="48.5" rx="4.6" ry="2.7" />
        {mood === 'cheer'
          ? <>
            <path className="pip-mouth-open" d="M33 47.5 Q40 47.5 47 47.5 Q46 56.5 40 56.5 Q34 56.5 33 47.5 Z" />
            <ellipse className="pip-tongue" cx="40" cy="54.5" rx="3.6" ry="2.2" />
          </>
          : mood === 'sleepy'
            ? <ellipse className="pip-mouth-open" cx="40" cy="50.5" rx="2.4" ry="2" />
            : mood === 'uneasy'
              ? <path className="pip-line pip-mouth" d="M33 50.5 Q36.5 47.5 40 50.5 Q43.5 53.5 47 50.5" />
              : mood === 'calm'
                ? <path className="pip-line pip-mouth" d="M36 48.5 Q40 51.5 44 48.5" />
                : <path className="pip-line pip-mouth" d="M33.5 47.5 Q40 54.5 46.5 47.5" />}
        {mood === 'uneasy' && <>
          {/* Worried brows, a warm tummy and a sweat drop. */}
          <path className="pip-line pip-brow" d="M28 35 L35 32.5" />
          <path className="pip-line pip-brow" d="M52 35 L45 32.5" />
          <path className="pip-heat" d="M40 53 C37 57 37 61 40 63 C43 61 43 57 40 53 Z" />
          <path className="pip-sweat" d="M60 24 C58 28 58 30 60 31 C62 30 62 28 60 24 Z" />
        </>}
      </g>
      {mood === 'proud' && <g className="pip-sparkles">
        <path d="M66 14 L67.5 18.5 L72 20 L67.5 21.5 L66 26 L64.5 21.5 L60 20 L64.5 18.5 Z" />
        <path d="M13 18 L14 21 L17 22 L14 23 L13 26 L12 23 L9 22 L12 21 Z" />
      </g>}
      {mood === 'sleepy' && <text className="pip-zzz" x="60" y="20">z</text>}
    </svg>
  )
}

interface MascotProps {
  line: MascotLine
  growth?: PipGrowth
  onAction?: (line: MascotLine) => void
  actionLabel?: string
}

/** The diary strip: Pip with one short line. Dismissing hides that line; the next new situation brings Pip back. */
export function Mascot({ line, growth, onAction, actionLabel }: MascotProps) {
  const [dismissed, setDismissed] = useState<string | null>(null)
  // A new line means something changed; let Pip speak again.
  useEffect(() => { if (dismissed && dismissed !== line.id) setDismissed(null) }, [line.id, dismissed])
  if (dismissed === line.id) return null
  return (
    <section className={`mascot mascot-${line.mood}`} aria-label="Pip, your logging buddy">
      <div className="mascot-figure" key={`figure-${line.id}`}>
        <PipFigure mood={line.mood} stage={growth?.stage ?? 0} />
        {growth && <small className="pip-stage-label" title={growth.next ? `${growth.next.remaining} more logged ${growth.next.remaining === 1 ? 'day' : 'days'} to ${growth.next.name.toLowerCase()}` : `${growth.days} days logged`}>{growth.name}</small>}
      </div>
      <div className="mascot-bubble" key={`bubble-${line.id}`}>
        <p role="status">{line.text}</p>
        {onAction && actionLabel && <button className="text-button mascot-action" type="button" onClick={() => onAction(line)}>{actionLabel}<Icon name="arrow-right" size={15} /></button>}
      </div>
      <button className="icon-button quiet mascot-dismiss" type="button" aria-label="Hide Pip’s message" onClick={() => setDismissed(line.id)}><Icon name="x" size={14} /></button>
    </section>
  )
}
