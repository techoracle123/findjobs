import type { ScoreComponent } from '../shared/types'

interface ScoreBreakdownProps {
  components: ScoreComponent[]
}

/**
 * Explain overlap through actual skills and preferences, not numeric grades.
 * Unknown listing details never count against a visitor.
 */
export function ScoreBreakdown({ components }: ScoreBreakdownProps) {
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
                  ? percent >= 60
                    ? 'Matches well'
                    : percent > 0
                      ? 'Some overlap'
                      : 'No overlap yet'
                  : 'Add a preference to compare'}
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
    </div>
  )
}
