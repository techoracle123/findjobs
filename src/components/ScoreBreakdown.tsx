import type { ScoreComponent } from '../shared/types'

interface ScoreBreakdownProps {
  components: ScoreComponent[]
  total: number
}

/**
 * The score is explainable by construction: every component shows the weight
 * it carries, what it earned, and which skills or attributes drove it.
 */
export function ScoreBreakdown({ components, total }: ScoreBreakdownProps) {
  return (
    <div className="breakdown">
      {components.map((component) => {
        const percent = component.applicable
          ? Math.round((component.earned / component.weight) * 100)
          : 0
        return (
          <div className={`bd${component.applicable ? '' : ' bd--muted'}`} key={component.key}>
            <div className="bd__head">
              <span className="bd__name">{component.label}</span>
              <span className="bd__value">
                {component.applicable
                  ? `${percent}% of ${component.weight}`
                  : `${component.weight} — not scored`}
              </span>
            </div>
            <div className="bd__bar">
              <div className="bd__fill" style={{ width: `${percent}%` }} />
            </div>
            <span className="bd__detail">{component.detail}</span>
            {component.matched.length > 0 && (
              <div className="taglist">
                {component.matched.map((item) => (
                  <span className="tag" key={item}>
                    {item}
                  </span>
                ))}
              </div>
            )}
          </div>
        )
      })}
      <hr className="divider" />
      <div className="kv">
        <span className="kv__key">Match score</span>
        <span className="kv__value">{total} / 100</span>
      </div>
    </div>
  )
}
