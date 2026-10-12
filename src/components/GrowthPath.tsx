import { PIP_STAGES, type PipGrowth, type PipStage } from '../lib/pipGrowth'
import { PipFigure } from './Mascot'
import { Icon } from './Icon'

/**
 * Every stage Pip can reach, so there is something to look forward to. Reached stages show the grown Pip, the current
 * one is marked, and the ones ahead are drawn faint with the number of logged days they take.
 */
export function GrowthPath({ growth }: { growth: PipGrowth }) {
  return (
    <ol className="growth-path" aria-label="Pip’s growth stages">
      {PIP_STAGES.map((stage, index) => {
        const state = index < growth.stage ? 'reached' : index === growth.stage ? 'current' : 'ahead'
        const remaining = stage.days - growth.days
        return (
          <li key={stage.name} className={`growth-stage is-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="growth-stage-figure"><PipFigure mood={state === 'ahead' ? 'calm' : 'happy'} size={40} stage={index as PipStage} /></span>
            <span className="growth-stage-copy">
              <strong>{stage.name}{state === 'reached' && <Icon name="check" size={12} />}</strong>
              <small>{stage.gift}</small>
            </span>
            <span className="growth-stage-days">
              {state === 'current' ? 'You are here' : state === 'reached' ? `${stage.days} days` : `${remaining} more ${remaining === 1 ? 'day' : 'days'}`}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
