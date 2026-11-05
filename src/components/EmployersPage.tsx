import { useEffect, useState } from 'react'
import { Footer } from './Footer'
import { SiteHeader } from './SiteHeader'

/**
 * Employer interest page. Direct posting is paused: there are no employer
 * accounts, no employer prices and no way to publish a job from this page.
 * The form only records interest in case posting is opened carefully later.
 */
export function EmployersPage() {
  const [state, setState] = useState<'idle' | 'done' | 'error'>('idle')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')

  useEffect(() => {
    document.title = 'For employers. FJ Find Jobs'
  }, [])

  return (
    <div className="app">
      <SiteHeader />
      <main className="wrap" id="main">
        <h1>Employer posting is not open</h1>
        <p className="lede">
          Employers cannot create an account or post a job directly on FJ today. We are keeping the
          board focused on real public vacancies while the checks and support process a posting
          service needs are not in place.
        </p>

        <section aria-label="How vacancies appear today">
          <h2>How vacancies appear today</h2>
          <p>
            FJ collects vacancies that are already public on employer career pages and established
            job boards. Applicants are sent back to the original posting to apply. If a role closes
            at the source, it is removed here on the next refresh.
          </p>
          <p>
            FJ does not charge people to apply for these jobs. We do not ask applicants for money
            for an employer. We do not receive applications for the jobs we collect.
          </p>
        </section>

        <section aria-label="What is paused">
          <h2>What is paused</h2>
          <ul>
            <li>No employer accounts.</li>
            <li>No direct job posting.</li>
            <li>No employer payment or featured listing.</li>
          </ul>
          <p>
            If a listing about your company is wrong or appears to misuse your company name, report
            it from the job page so it can be reviewed.
          </p>
        </section>

        <section className="waitlist" aria-label="Employer interest">
          <h2>Tell us you are interested</h2>
          <p>
            Leave a work email if you want to hear from us only if employer posting is opened in the
            future. This does not create an account or reserve a posting.
          </p>
          {state === 'done' ? (
            <p role="status">Thank you. We have recorded your interest.</p>
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
              <button className="btn btn--primary">Record my interest</button>
              {state === 'error' && (
                <p className="banner banner--demo" role="status">
                  We could not save that. Try again.
                </p>
              )}
            </form>
          )}
        </section>

        <p className="field__hint">
          FJ is not an employer and does not act as a recruiter. We point people to the original
          posting; hiring decisions stay entirely with the employer.
        </p>
      </main>
      <Footer />
    </div>
  )
}
