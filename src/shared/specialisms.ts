/** Title-led discovery labels, not a claim of qualification or eligibility. */
export function specialistRole(title: string): string | null {
  if (
    /\b(?:cyber[ -]?security|information security|infosec|appsec|penetration test(?:er|ing)?|pentest(?:er|ing)?|threat (?:intelligence|research)|vulnerability|security operations|soc analyst|red team|blue team|cloud security|application security|security engineer|security analyst|security architect|CISO)\b/i.test(
      title,
    ) &&
    !/\b(?:physical security|security guard|loss prevention)\b/i.test(title)
  )
    return 'security'
  if (
    /\b(?:video edit(?:or|ing)?|video produc(?:er|tion)|film edit|motion (?:design|graphics)|post[ -]?production|animator|videograph(?:er|y))\b/i.test(
      title,
    )
  )
    return 'video'
  if (
    /\b(?:data (?:analys(?:t|is)|scien(?:tist|ce)|engineer)|analytics|business intelligence|business analyst|product analyst|BI (?:analyst|developer)|reporting analyst)\b/i.test(
      title,
    )
  )
    return 'data'
  return null
}
