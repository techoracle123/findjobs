import { ArrowRight, Check, Lightbulb, ShieldCheck } from 'lucide-react'
import { Footer } from './Footer'
import { SiteHeader } from './SiteHeader'
import { FREE_FEATURES, PRO_FEATURES, PRO_LIMITS } from '../lib/pro-features'
import { FREE_ACCESS_MESSAGE } from '../shared/access'

export function FreeAccessPage() {
  return (
    <div className="app">
      <SiteHeader current="pricing" />
      <main className="content info-page free-access-page">
        <p className="eyebrow">Free early access</p>
        <h1>Everything in FJ is free for now</h1>
        <p className="lede">{FREE_ACCESS_MESSAGE}</p>
        <div className="home-hero__actions">
          <a className="btn btn--primary" href="/auth/signup?returnTo=%2Fjobs">
            Create a free account <ArrowRight size={17} />
          </a>
          <a className="btn" href="/ideas">
            Explore product ideas <Lightbulb size={17} />
          </a>
        </div>

        <section className="free-access-notice" aria-label="Payments paused">
          <ShieldCheck size={22} aria-hidden="true" />
          <div>
            <h2>No checkout. No card. No trial limit.</h2>
            <p>
              Payments are paused while FJ is in free early access. Existing paid subscriptions and
              billing records are preserved for later. Applying on an employer or client website
              remains free too.
            </p>
          </div>
        </section>

        <section className="free-access-grid" aria-label="Included features">
          {[...FREE_FEATURES, ...PRO_FEATURES].map((feature) => (
            <article className="free-access-feature" key={feature.id}>
              <Check size={18} aria-hidden="true" />
              <h2>{feature.title}</h2>
              <p>{feature.what}</p>
              <strong>{feature.why}</strong>
            </article>
          ))}
        </section>

        <section className="info-section">
          <h2>What free access does not change</h2>
          <ul>
            {PRO_LIMITS.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
            <li>Private account information and saved CV text still require sign-in.</li>
            <li>Fair-use and safety limits still protect the service and its data sources.</li>
          </ul>
        </section>

        <section className="info-section">
          <h2>Problems and product ideas are included too</h2>
          <p>
            Explore dated evidence by country, physical and software product ideas, and current
            search trends. Product ideas are hypotheses to validate, not guaranteed businesses.
          </p>
          <a className="btn btn--primary" href="/ideas">
            Find a problem worth solving <ArrowRight size={17} />
          </a>
        </section>
      </main>
      <Footer />
    </div>
  )
}
