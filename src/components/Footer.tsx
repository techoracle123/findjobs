/** Present on every page. Legal pages carry short honest content until the full policies ship. */
export function Footer() {
  return (
    <footer className="site-footer">
      <nav aria-label="Footer">
        <a href="/about">About</a>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="/scams">How to spot a job scam</a>
        <a href="/employers">For employers</a>
        <a href="/contact">Contact</a>
      </nav>
      <p>
        FJ shares opportunities. We are not employers, never charge job seekers, and never ask you
        to pay to apply. Always verify the original listing before applying.
      </p>
    </footer>
  )
}
