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
        <p className="eyebrow">Free for now</p>
        <h1>Everything on FJ is free for now</h1>
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
            <h2>You do not need a card or a trial</h2>
            <p>
              Payments are paused, so you cannot buy or renew a plan. Existing paid plans and
              payment records are not deleted. Applying on an employer or client website is still
              free.
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
          <h2>What stays the same</h2>
          <ul>
            {PRO_LIMITS.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
            <li>Private account information and saved CV text still require sign-in.</li>
            <li>Rules that keep FJ safe and fair for everyone still apply.</li>
          </ul>
        </section>

        <section className="info-section">
          <h2>Problems and product ideas are included too</h2>
          <p>
            Look at official figures for different countries, find physical and software products
            you could build or sell, and see what people are searching for. Every idea needs to be
            checked with real people. None is a guaranteed business.
          </p>
          <a className="btn btn--primary" href="/ideas">
            See ideas for your location <ArrowRight size={17} />
          </a>
        </section>
      </main>
      <Footer />
    </div>
  )
}
