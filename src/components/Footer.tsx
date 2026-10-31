/** Present on every page. Legal pages carry short honest content until the full policies ship. */
export function Footer() {
  return (
    <footer className="site-footer">
      <nav aria-label="Footer">
        <a href="/about">About</a>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="/scams">How to spot a job scam</a>
        <a href="/faq">FAQ</a>
        <a href="/pricing">Pricing</a>
        <a href="/contact">Contact</a>
      </nav>
      <p>
        FJ is not an employer. We never ask you to pay to apply for a job. Check the company and the
        original advert before you apply.
      </p>
    </footer>
  )
}
