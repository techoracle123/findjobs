export function matchLabel(score: number): string {
  return score >= 75
    ? 'Strong overlap'
    : score >= 45
      ? 'Promising overlap'
      : score > 0
        ? 'Some overlap'
        : 'Little overlap'
}

/** A preference indicator, never an employer rating or hiring probability. */
export function MatchRing({ score }: { score: number }) {
  return (
    <span
      className="scorebadge"
      style={{ '--pct': Math.max(0, Math.min(100, score)) } as React.CSSProperties}
      role="img"
      aria-label={`${matchLabel(score)} with your skills and preferences`}
      title={`${matchLabel(score)} with your skills and preferences. A fuller green ring means more overlap, not a hiring prediction.`}
    >
      <span className="scorebadge__inner" />
    </span>
  )
}
