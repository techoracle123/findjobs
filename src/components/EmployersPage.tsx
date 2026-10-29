import { useEffect, useState } from 'react'
import { Footer } from './Footer'

/**
 * Employers page. Direct posting is not open yet, so this page states the
 * offer plainly and collects waitlist emails through the same endpoint as
 * the pricing waitlist. No prices are shown until they are final — the
 * waitlist hears them first.
 */
export function EmployersPage() {
  const [state, setState] = useState<'idle' | 'done' | 'error'>('idle')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')

  useEffect(() => {
    document.title = 'For employers — FJ - Find Jobs'
  }, [])

  return (
    <>
      <main className="wrap" id="main">
        <h1>Reach job seekers across Nigeria and beyond</h1>
        <p className="lede">
          FJ collects real vacancies from employer career pages and established job boards, cleans
          them up, and puts them in front of people who are actively looking. Employer accounts with
          direct posting are on the way.
        </p>

        <section aria-label="What employers get">
          <h2>What you will get at launch</h2>
          <ul>
            <li>
              <strong>Direct job posting</strong> — publish a vacancy in minutes, edit or close it
              any time.
            </li>
            <li>
              <strong>Verified employer profile</strong> — your company page with a verified badge,
              so candidates know the listing is really yours.
            </li>
            <li>
              <strong>Scam protection for your brand</strong> — listings that misuse your company
              name can be reported and removed; verified profiles help candidates tell you apart
              from impersonators.
            </li>
            <li>
              <strong>Reach without the noise</strong> — your roles appear in search by profession,
              country, work type and experience level.
            </li>
          </ul>
        </section>

        <section aria-label="How it works today">
          <h2>How it works today</h2>
          <p>
            You may already be on FJ. If your vacancies are published on your public careers page or
            an established job board or applicant tracking system, FJ collects them automatically at
            no cost and links applicants back to your original posting. You keep full control: close
            the role at the source and it disappears here on the next refresh.
          </p>
          <p>
            FJ never charges job seekers, never asks applicants for money on your behalf, and always
            sends applicants to your original application page.
          </p>
        </section>

        <section aria-label="Employer pricing">
          <h2>Pricing</h2>
          <p>
            Automatic collection from your public listings is free and stays free. Direct posting
            and verified profiles will be paid plans priced in naira; final prices will be confirmed
            before launch and waitlist members will hear them first — with founding pricing locked
            in for early employers.
          </p>
        </section>

        <section className="waitlist" aria-label="Employer waitlist">
          <h2>Join the employer waitlist</h2>
          <p>Leave your work email and company name. We will contact you before launch.</p>
          {state === 'done' ? (
            <p role="status">Thank you. We will email you before employer accounts open.</p>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void fetch('/api/billing/waitlist', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email, company }),
                })
                  .then((r) => {
                    if (!r.ok) throw new Error('failed')
                    setState('done')
                  })
                  .catch(() => setState('error'))
              }}
            >
              <label className="field">
                Work email
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                />
              </label>
              <label className="field">
                Company name
                <input
                  type="text"
                  value={company}
                  onChange={(event) => setCompany(event.target.value)}
                  autoComplete="organization"
                />
              </label>
              <button className="btn btn--primary">Join the waitlist</button>
              {state === 'error' && (
                <p className="banner banner--demo" role="status">
                  Could not save that just now. Try again.
                </p>
              )}
            </form>
          )}
        </section>

        <p className="field__hint">
          FJ is not an employer and does not act as a recruiter. We point people to your original
          posting; hiring decisions stay entirely with you.
        </p>
      </main>
      <Footer />
    </>
  )
}
