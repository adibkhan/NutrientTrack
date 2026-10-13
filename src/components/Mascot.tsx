import { useEffect, useId, useRef, useState } from 'react'
import { feedLine, petLine, pokeLine, type MascotLine, type MascotMood, type MascotReaction } from '../lib/mascot'
import { FoodGlyph } from './FoodGlyph'
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
const PET_PRESS_MS = 450

interface PipFigureProps {
  mood: MascotMood
  size?: number
  stage?: PipStage
  /** A moment that overrides the mood's face: chewing, dizzy, giggling, being patted. */
  reaction?: MascotReaction | null
  /** A tap on Pip. The strip counts quick taps in a row, since the figure remounts on each poke. */
  onPoke?: () => void
  /** A long press on Pip. */
  onPet?: () => void
}

export function PipFigure({ mood, size = 56, stage = 0, reaction = null, onPoke, onPet }: PipFigureProps) {
  const id = useId().replace(/:/g, '')
  const [poked, setPoked] = useState(0)
  const pressTimer = useRef<number | null>(null)
  const pressed = useRef(false)
  const svgRef = useRef<SVGSVGElement>(null)
  useEffect(() => () => { if (pressTimer.current) window.clearTimeout(pressTimer.current) }, [])
  const startPress = () => {
    pressed.current = true
    if (pressTimer.current) window.clearTimeout(pressTimer.current)
    pressTimer.current = window.setTimeout(() => { pressTimer.current = null; if (pressed.current) { pressed.current = false; onPet?.() } }, PET_PRESS_MS)
  }
  const endPress = () => {
    if (!pressed.current) return
    pressed.current = false
    if (pressTimer.current) { window.clearTimeout(pressTimer.current); pressTimer.current = null }
    setPoked((count) => count + 1)
    onPoke?.()
  }
  const cancelPress = () => { pressed.current = false; if (pressTimer.current) { window.clearTimeout(pressTimer.current); pressTimer.current = null } }
  const canLook = mood !== 'happy' && mood !== 'proud' && mood !== 'sleepy' && !reaction
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
  const tier = size < 44 ? 'small' : size > 120 ? 'large' : 'standard'
  const armsUp = mood === 'cheer' && !reaction
  const waving = mood === 'wave' && !reaction
  const happyEyes = reaction === 'loved' || reaction === 'giggle' || (!reaction && (mood === 'happy' || mood === 'proud'))
  const dizzy = reaction === 'dizzy'
  const eating = reaction === 'eating'
  const sleepyFace = mood === 'sleepy' && !reaction
  // Brows live in every face so a mood moves them instead of swapping the eyes out.
  const brows = dizzy ? ['M27.5 33.5 Q31.5 35.5 35.5 33.5', 'M44.5 33.5 Q48.5 35.5 52.5 33.5']
    : eating ? ['M27.5 32.5 Q31.5 30.5 35.5 32', 'M44.5 32 Q48.5 30.5 52.5 32.5']
    : sleepyFace ? ['M28 36.5 Q31.5 36 35 36.5', 'M45 36.5 Q48.5 36 52 36.5']
    : happyEyes || mood === 'cheer' ? ['M27 31.5 Q31.5 28.8 36 31', 'M44 31 Q48.5 28.8 53 31.5']
    : mood === 'uneasy' ? ['M28 35 L35 32.5', 'M52 35 L45 32.5']
    : mood === 'calm' ? ['M28 33 Q31.5 32 35 32.6', 'M45 32.6 Q48.5 32 52 33']
    : ['M28 32.6 Q31.5 31 35 31.8', 'M45 31.8 Q48.5 31 52 32.6']
  const cheekFill = { fill: `url(#${id}-cheek)` }
  const bodyFill = { fill: `url(#${id}-body)` }
  const bellyFill = { fill: `url(#${id}-belly)` }
  const leafFill = { fill: `url(#${id}-leaf)` }
  // The view box leaves headroom above the body for the bud and flower of later stages.
  return (
    <svg className={`pip pip-${mood} pip-stage-${stage} pip-tier-${tier} ${poked ? 'pip-poked' : ''} ${reaction ? `pip-react pip-react-${reaction}` : ''}`} key={poked} ref={svgRef} viewBox="0 -16 80 96" width={size} height={(size * 96) / 80} aria-hidden="true" focusable="false" onPointerDown={startPress} onPointerUp={endPress} onPointerLeave={cancelPress} onPointerCancel={cancelPress} onContextMenu={(event) => event.preventDefault()}>
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
        <radialGradient id={`${id}-cheek`} cx="50%" cy="50%" r="50%">
          <stop offset="0" style={{ stopColor: 'var(--pip-cheek)', stopOpacity: 0.8 }} />
          <stop offset="1" style={{ stopColor: 'var(--pip-cheek)', stopOpacity: 0 }} />
        </radialGradient>
        <filter id={`${id}-blur`} x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="1.1" /></filter>
        <linearGradient id={`${id}-leaf`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: 'var(--pip-leaf)' }} />
          <stop offset="1" style={{ stopColor: 'var(--pip-leaf-light)' }} />
        </linearGradient>
      </defs>
      {stage === 4 && <circle className="pip-halo" style={{ fill: `url(#${id}-halo)` }} cx="40" cy="36" r="44" />}
      <ellipse className="pip-shadow" cx="40" cy="74.5" rx="20" ry="3.4" filter={`url(#${id}-blur)`} />
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
          <g className="pip-cheer-arm pip-cheer-left"><path className="pip-arm pip-arm-still" d="M21 36 L13.5 25.5" /><circle className="pip-hand" cx="13" cy="24.8" r="4" /></g>
          <g className="pip-cheer-arm pip-cheer-right"><path className="pip-arm pip-arm-still" d="M59 36 L66.5 25.5" /><circle className="pip-hand" cx="67" cy="24.8" r="4" /></g>
        </> : <>
          <g className="pip-arm-left"><path className="pip-arm" d="M20 47 L13.5 54.5" /><circle className="pip-hand" cx="13" cy="55" r="4" /></g>
          {waving
            ? <g className="pip-wave-arm"><path className="pip-arm pip-arm-still" d="M60 40 L68.5 29.5" /><circle className="pip-hand" cx="69" cy="29" r="4" /></g>
            : <g className="pip-arm-right"><path className="pip-arm" d="M60 47 L66.5 54.5" /><circle className="pip-hand" cx="67" cy="55" r="4" /></g>}
        </>}
        {/* Feet */}
        <path className="pip-foot" d="M23.5 69.8 C23.5 66.2 27 65 30.5 65.2 C34.5 65.4 37.5 67 37.5 69.6 C37.5 72.2 34.5 73.6 30.5 73.6 C27 73.6 23.5 72.8 23.5 69.8 Z" />
        <path className="pip-foot" d="M42.5 69.6 C42.5 67 45.5 65.4 49.5 65.2 C53 65 56.5 66.2 56.5 69.8 C56.5 72.8 53 73.6 49.5 73.6 C45.5 73.6 42.5 72.2 42.5 69.6 Z" />
        <ellipse className="pip-foot-shine" cx="29" cy="67.6" rx="2.6" ry="1" />
        <ellipse className="pip-foot-shine" cx="51" cy="67.6" rx="2.6" ry="1" />
        {/* Body: a rounded pea, a touch wider at the bottom, lit from the top left. */}
        <path className="pip-body" style={bodyFill} d="M40 16 C55 16 65 28 65.5 43 C66 58 55 70 40 70 C25 70 14 58 14.5 43 C15 28 25 16 40 16 Z" />
        <ellipse className="pip-belly" style={bellyFill} cx="40" cy="52" rx="15.5" ry="13.5" />
        <path className="pip-contour" d="M40 16 C55 16 65 28 65.5 43 C66 58 55 70 40 70 C25 70 14 58 14.5 43 C15 28 25 16 40 16 Z" />
        <path className="pip-rim" d="M21.5 30 C23.5 23 29 18 36 16.8 C30.5 19.4 25.5 24 23.2 31.5 Z" />
        <ellipse className="pip-shine" cx="30" cy="25.5" rx="3.6" ry="2" transform="rotate(-34 30 25.5)" />
        <circle className="pip-shine" cx="35.8" cy="21.8" r="1.1" />
        {/* Face */}
        {dizzy ? <g className="pip-dizzy-eyes">
          <path className="pip-line" d="M28.5 38 L34.5 44 M34.5 38 L28.5 44" />
          <path className="pip-line" d="M45.5 38 L51.5 44 M51.5 38 L45.5 44" />
        </g> : sleepyFace ? <>
          <path className="pip-line" d="M27 41 Q31.5 45 36 41" />
          <path className="pip-line" d="M44 41 Q48.5 45 53 41" />
          <path className="pip-line pip-lash" d="M28 43.5 L26.5 45.5" />
          <path className="pip-line pip-lash" d="M52 43.5 L53.5 45.5" />
        </> : happyEyes ? <>
          <path className="pip-line pip-eye-arc" d="M27 42 Q31.5 35.5 36 42" />
          <path className="pip-line pip-eye-arc" d="M44 42 Q48.5 35.5 53 42" />
        </> : <g className="pip-eyes">
          <ellipse className="pip-eye-socket" cx="31.5" cy="41.4" rx="5" ry="5.6" />
          <ellipse className="pip-eye-socket" cx="48.5" cy="41.4" rx="5" ry="5.6" />
          <g className="pip-glance"><g className="pip-look">
            <ellipse className="pip-eye" cx="31.5" cy="41.2" rx="4" ry="4.8" />
            <ellipse className="pip-eye" cx="48.5" cy="41.2" rx="4" ry="4.8" />
            <circle className="pip-eye-glint" cx="33.2" cy="39" r="1.7" />
            <circle className="pip-eye-glint" cx="50.2" cy="39" r="1.7" />
            <circle className="pip-eye-glint" cx="29.9" cy="43.4" r="0.8" />
            <circle className="pip-eye-glint" cx="46.9" cy="43.4" r="0.8" />
          </g></g>
        </g>}
        <ellipse className="pip-cheek" style={cheekFill} cx="24" cy="48.5" rx="6" ry="3.8" />
        <ellipse className="pip-cheek" style={cheekFill} cx="56" cy="48.5" rx="6" ry="3.8" />
        <path className={`pip-line pip-brow ${mood === 'uneasy' || dizzy || sleepyFace || happyEyes || mood === 'cheer' || eating ? 'is-expressive' : ''}`} d={brows[0]} />
        <path className={`pip-line pip-brow ${mood === 'uneasy' || dizzy || sleepyFace || happyEyes || mood === 'cheer' || eating ? 'is-expressive' : ''}`} d={brows[1]} />
        {eating
          ? <g className="pip-chew"><ellipse className="pip-mouth-open" cx="40" cy="51" rx="5.5" ry="4.5" /><ellipse className="pip-tongue" cx="40" cy="53.4" rx="3" ry="1.6" /></g>
          : dizzy
            ? <path className="pip-line pip-mouth" d="M34 51 Q37 48.5 40 51 Q43 53.5 46 51" />
            : reaction === 'giggle'
              ? <path className="pip-mouth-open" d="M32 47 Q40 46.5 48 47 Q47 55 40 55.5 Q33 55 32 47 Z" />
              : reaction === 'loved'
                ? <path className="pip-line pip-mouth" d="M33.5 48 Q40 55 46.5 48" />
                : mood === 'cheer'
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
        {eating && <>
          <ellipse className="pip-cheek-full pip-cheek-full-left" cx="25" cy="49" rx="6" ry="4.5" />
          <ellipse className="pip-cheek-full pip-cheek-full-right" cx="55" cy="49" rx="6" ry="4.5" />
        </>}
        {mood === 'uneasy' && !reaction && <>
          {/* A warm tummy and a sweat drop. */}
          <path className="pip-heat" d="M40 53 C37 57 37 61 40 63 C43 61 43 57 40 53 Z" />
          <path className="pip-sweat" d="M60 24 C58 28 58 30 60 31 C62 30 62 28 60 24 Z" />
        </>}
      </g>
      {dizzy && <g className="pip-stars">
        {[0, 1, 2].map((index) => <path key={index} className="pip-star" style={{ animationDelay: `${index * 0.3}s` }} d="M40 3 L41.4 7 L45.5 7.6 L42.5 10.4 L43.3 14.5 L40 12.4 L36.7 14.5 L37.5 10.4 L34.5 7.6 L38.6 7 Z" />)}
      </g>}
      {reaction === 'loved' && <g className="pip-hearts">
        {[[18, 18, 0], [62, 12, 0.35], [40, 0, 0.7]].map(([x, y, delay]) => <path key={`${x}-${y}`} className="pip-heart" style={{ animationDelay: `${delay}s`, transformOrigin: `${x}px ${y}px` }} d={`M${x} ${Number(y) + 4} C${Number(x) - 5} ${Number(y) - 1} ${Number(x) - 2} ${Number(y) - 5} ${x} ${Number(y) - 2} C${Number(x) + 2} ${Number(y) - 5} ${Number(x) + 5} ${Number(y) - 1} ${x} ${Number(y) + 4} Z`} />)}
      </g>}
      {mood === 'proud' && !reaction && <g className="pip-sparkles">
        <path d="M66 14 L67.5 18.5 L72 20 L67.5 21.5 L66 26 L64.5 21.5 L60 20 L64.5 18.5 Z" />
        <path d="M13 18 L14 21 L17 22 L14 23 L13 26 L12 23 L9 22 L12 21 Z" />
      </g>}
      {sleepyFace && <text className="pip-zzz" x="60" y="20">z</text>}
    </svg>
  )
}

interface MascotProps {
  line: MascotLine
  growth?: PipGrowth
  onAction?: (line: MascotLine) => void
  actionLabel?: string
  /** The entry just logged, so Pip can eat it. A new id starts a new bite. */
  fed?: { id: string; name: string }
}

const EAT_MS = 1700
const REACT_MS = 2400
const POKE_WINDOW_MS = 2200

/** The diary strip: Pip with one short line. Dismissing hides that line; the next new situation brings Pip back. */
export function Mascot({ line, growth, onAction, actionLabel, fed }: MascotProps) {
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [moment, setMoment] = useState<{ reaction: MascotReaction; text: string | null; key: number } | null>(null)
  const momentTimer = useRef<number | null>(null)
  const lastFed = useRef<string | null>(null)
  const pokes = useRef<number[]>([])
  const react = (reaction: MascotReaction, text: string | null, ms: number) => {
    if (momentTimer.current) window.clearTimeout(momentTimer.current)
    setMoment({ reaction, text, key: Date.now() })
    momentTimer.current = window.setTimeout(() => { momentTimer.current = null; setMoment(null) }, ms)
  }
  useEffect(() => () => { if (momentTimer.current) window.clearTimeout(momentTimer.current) }, [])
  // A new line means something changed; let Pip speak again.
  useEffect(() => { if (dismissed && dismissed !== line.id) setDismissed(null) }, [line.id, dismissed])
  // Pip eats each fresh entry once.
  useEffect(() => {
    if (!fed || lastFed.current === fed.id) return
    lastFed.current = fed.id
    react('eating', feedLine(fed.name, fed.id), EAT_MS)
  }, [fed])
  if (dismissed === line.id) return null
  const onPoke = () => {
    const now = Date.now()
    pokes.current = [...pokes.current.filter((time) => now - time < POKE_WINDOW_MS), now]
    const poke = pokeLine(pokes.current.length)
    if (poke.reaction) react(poke.reaction, poke.text, REACT_MS)
  }
  const onPet = () => react('loved', petLine(`${line.id}:${Math.floor(Date.now() / 60000)}`), REACT_MS)
  const text = moment?.text ?? line.text
  return (
    <section className={`mascot mascot-${line.mood} ${moment ? `mascot-${moment.reaction}` : ''}`} aria-label="Pip, your logging buddy">
      <div className="mascot-figure" key={`figure-${line.id}`}>
        <PipFigure mood={line.mood} stage={growth?.stage ?? 0} reaction={moment?.reaction ?? null} onPoke={onPoke} onPet={onPet} />
        {moment?.reaction === 'eating' && fed && <span className="pip-bite" key={moment.key} aria-hidden="true"><FoodGlyph name={fed.name} /></span>}
        {growth && <small className="pip-stage-label" title={growth.next ? `${growth.next.remaining} more logged ${growth.next.remaining === 1 ? 'day' : 'days'} to ${growth.next.name.toLowerCase()}` : `${growth.days} days logged`}>{growth.name}</small>}
      </div>
      <div className="mascot-bubble" key={`bubble-${line.id}-${moment?.key ?? ''}`}>
        <p role="status">{text}</p>
        {onAction && actionLabel && <button className="text-button mascot-action" type="button" onClick={() => onAction(line)}>{actionLabel}<Icon name="arrow-right" size={15} /></button>}
      </div>
      <button className="icon-button quiet mascot-dismiss" type="button" aria-label="Hide Pip’s message" onClick={() => setDismissed(line.id)}><Icon name="x" size={14} /></button>
    </section>
  )
}
