import { createRoot } from 'react-dom/client'
import { PipFigure } from '../../../src/components/Mascot'
import type { MascotMood, MascotReaction } from '../../../src/lib/mascot'
import { PIP_STAGES, type PipStage } from '../../../src/lib/pipGrowth'
import '../../../src/styles.css'

/** Every mood, reaction and stage at the three detail tiers. Built by scripts/brand/contact-sheet.mjs; never shipped. */
const MOODS: MascotMood[] = ['wave', 'happy', 'proud', 'cheer', 'calm', 'sleepy', 'uneasy']
const REACTIONS: MascotReaction[] = ['eating', 'dizzy', 'giggle', 'loved']
const params = new URLSearchParams(window.location.search)
const theme = params.get('theme')
if (theme) document.documentElement.setAttribute('data-theme', theme)

/** ?export=1 renders only the variants export-pip.mjs reads, each tagged with data-variant. */
function Export() {
  return <div className="row">
    <div data-variant="wave-flower"><PipFigure mood="wave" size={150} stage={3} /></div>
    <div data-variant="wave-plain"><PipFigure mood="wave" size={150} stage={0} /></div>
    <div data-variant="happy-flower"><PipFigure mood="happy" size={150} stage={3} /></div>
    <div data-variant="cheer-flower"><PipFigure mood="cheer" size={150} stage={3} /></div>
  </div>
}

function Sheet() {
  if (params.get('export')) return <Export />
  return <div className="sheet">
    {[34, 56, 150].map((size) => <div key={size}>
      <h2>Moods at {size}px</h2>
      <div className="row">{MOODS.map((mood) => <div key={mood}><PipFigure mood={mood} size={size} stage={3} />{mood}</div>)}</div>
    </div>)}
    <h2>Reactions at 56px</h2>
    <div className="row">{REACTIONS.map((reaction) => <div key={reaction}><PipFigure mood="happy" size={56} stage={3} reaction={reaction} />{reaction}</div>)}</div>
    {[34, 56, 150].map((size) => <div key={size}>
      <h2>Stages at {size}px</h2>
      <div className="row">{PIP_STAGES.map((stage, index) => <div key={stage.name}><PipFigure mood="wave" size={size} stage={index as PipStage} />{stage.name}</div>)}</div>
    </div>)}
  </div>
}

createRoot(document.getElementById('root')!).render(<Sheet />)
