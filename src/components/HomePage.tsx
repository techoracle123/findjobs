import { useEffect, useState } from 'react'
import {
  ArrowRight,
  Bell,
  Bookmark,
  Briefcase,
  Check,
  Globe2,
  GraduationCap,
  MapPin,
  ShieldCheck,
  Wallet,
} from 'lucide-react'
import { Footer } from './Footer'
import { SiteHeader } from './SiteHeader'
import { FREE_FEATURES, PRO_FEATURES } from '../lib/pro-features'

interface PublicStats {
  total: number
  nigeria: number
  remote: number
  countries: number
  updatedAt: string
}

/**
 * The public homepage. It explains what FJ is, shows honest live counts,
 * teaches what improves a person's chances, and invites them to create the
 * free account they need before they can see the jobs.
 */
export function HomePage() {
  const [stats, setStats] = useState<PublicStats | null>(null)
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    document.title = 'FJ - Find Jobs. Thousands of job opportunities in one place.'
    void (async () => {
      try {
        const response = await fetch('/api/public-stats', { cache: 'no-store' })
        if (response.ok) {
          const body = (await response.json()) as PublicStats & { available?: boolean }
          if (body.available !== false && typeof body.total === 'number') setStats(body)
        }
      } catch {
        /* The page reads fine without the numbers. */
      }
      try {
        const response = await fetch('/api/auth/session', {
          credentials: 'same-origin',
          cache: 'no-store',
        })
        if (response.ok) {
          const body = (await response.json()) as { user?: unknown }
          setSignedIn(Boolean(body.user))
        }
      } catch {
        /* Signed out is the safe assumption. */
      }
    })()
  }, [])

  const number = (value: number) => value.toLocaleString('en-NG')

  return (
    <div className="app">
      <SiteHeader current="home" signedIn={signedIn} />

      <main className="content home">
        <section className="home-hero">
          <span className="eyebrow">Jobs in Nigeria. Remote jobs from abroad.</span>
          <h1>Thousands of job opportunities. All in one place.</h1>
          <p>
            We bring jobs from companies in Nigeria and companies abroad into one place. You do not
            need to check many websites each day.
          </p>
          <p>
            Some jobs pay in naira. Some remote jobs pay in dollars, pounds or euros. If a company
            states the pay, you will see it before you apply.
          </p>
          <div className="home-hero__actions">
            {signedIn ? (
              <a className="btn btn--primary" href="/jobs">
                See your jobs <ArrowRight size={17} />
              </a>
            ) : (
              <>
                <a className="btn btn--primary" href="/auth/signup?returnTo=%2Fjobs">
                  Create a free account <ArrowRight size={17} />
                </a>
                <a className="btn" href="/auth/login?returnTo=%2Fjobs">
                  Sign in
                </a>
              </>
            )}
          </div>
          <p className="field__hint">
            {signedIn
              ? 'You are signed in. Your saved jobs and free alerts are in your account.'
              : 'You need a free account to see the jobs. Creating one takes less than a minute, and it lets us save your jobs and send you free alerts.'}
          </p>
        </section>

        {stats && (
          <section className="home-stats" aria-label="Jobs on FJ right now">
            <div className="home-stat">
              <strong>{number(stats.total)}</strong>
              <span>jobs listed right now</span>
            </div>
            <div className="home-stat">
              <strong>{number(stats.nigeria)}</strong>
              <span>jobs in Nigeria</span>
            </div>
            <div className="home-stat">
              <strong>{number(stats.remote)}</strong>
              <span>remote jobs you can do from home</span>
            </div>
            <div className="home-stat">
              <strong>{number(stats.countries)}</strong>
              <span>countries hiring</span>
            </div>
          </section>
        )}
        {stats && (
          <p className="field__hint home-stats__note">
            These numbers come from the adverts on FJ right now. New adverts are collected twice a
            day, and jobs that have closed are removed.
          </p>
        )}

        <figure className="home-figure">
          <img
            src="/images/home-people.jpg"
            alt="Young Nigerian professionals working together on laptops in a bright office"
            loading="lazy"
          />
          <figcaption>
            People in Nigeria now work for companies in Lagos and Abuja, and also for companies in
            London, Toronto and New York, without leaving home.
          </figcaption>
        </figure>

        <section className="home-section">
          <h2>How it works</h2>
          <div className="home-steps">
            <div className="home-step">
              <Briefcase size={20} />
              <h3>1. Create your free account</h3>
              <p>
                Sign up with your email and a password. Tell us your skills and the kind of work you
                want, so we can show you the right jobs first.
              </p>
            </div>
            <div className="home-step">
              <Bookmark size={20} />
              <h3>2. Find and save good jobs</h3>
              <p>
                Search by work type, place, or remote. Read each advert well. Save the ones that fit
                you so you can come back to them any time.
              </p>
            </div>
            <div className="home-step">
              <Bell size={20} />
              <h3>3. Apply and keep going</h3>
              <p>
                We take you to the company page where the real application happens. Applying there
                is always free. Keep a list of where you applied, and turn on free alerts so new
                jobs come to you.
              </p>
            </div>
          </div>
        </section>

        <section className="home-section" aria-labelledby="home-free-heading">
          <p className="eyebrow">No card. No application limit.</p>
          <h2 id="home-free-heading">Everything you need to find and apply is free</h2>
          <p className="home-lead">
            A free account lets you search, save and apply. We will not ask you to pay to finish an
            application.
          </p>
          <div className="home-feature-grid">
            {FREE_FEATURES.map((feature) => (
              <article className="home-card" key={feature.id}>
                <Check size={19} aria-hidden="true" />
                <h3>{feature.title}</h3>
                <p>{feature.what}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="home-section home-pro" aria-labelledby="home-pro-heading">
          <p className="eyebrow">More help</p>
          <h2 id="home-pro-heading">Pro helps you check and prepare</h2>
          <p className="home-lead">
            Finding jobs is only one part. You also need to know if people in Nigeria can apply, if
            the advert looks safe, and if your CV matches the job. Pro helps with these checks.
          </p>
          <div className="home-feature-grid">
            {PRO_FEATURES.map((feature) => (
              <article className="home-card" key={feature.id}>
                <h3>{feature.title}</h3>
                <p>{feature.what}</p>
                <p className="field__hint">{feature.why}</p>
              </article>
            ))}
          </div>
          <div className="home-trial-band">
            <div>
              <h3>Try it free for 3 days</h3>
              <p>
                Check one CV in full and prepare applications for three jobs. We do not ask for card
                details. The trial ends on its own.
              </p>
            </div>
            <a className="btn btn--primary" href="/pricing#trial-heading">
              See how the trial works <ArrowRight size={17} aria-hidden="true" />
            </a>
          </div>
          <div className="home-price-grid" aria-label="FJ prices">
            <div>
              <span>Free</span>
              <strong>₦0</strong>
              <p>Search, save, get alerts and apply free.</p>
            </div>
            <div>
              <span>Pro Monthly</span>
              <strong>₦5,000/month</strong>
              <p>Founding price for the first 500 paying members.</p>
            </div>
            <div>
              <span>Pro Yearly</span>
              <strong>₦40,000/year</strong>
              <p>Same tools for about ₦3,333 a month at the founding price.</p>
            </div>
            <div>
              <span>Pro for Graduates</span>
              <strong>₦3,000/month</strong>
              <p>Same Pro tools for students, new graduates and corps members who qualify.</p>
            </div>
          </div>
          <p className="field__hint">
            Payments are not open yet. Prices are shown now so you can decide later.{' '}
            <a href="/pricing">Compare plans or check the graduate price</a>.
          </p>
        </section>

        <section className="home-section">
          <h2>What kind of jobs are here?</h2>
          <div className="home-two">
            <div className="home-card">
              <MapPin size={20} />
              <h3>Jobs in Nigeria</h3>
              <p>
                Work with banks, hospitals, schools, factories, shops, offices and tech companies in
                Lagos, Abuja, Port Harcourt and other states. There are jobs for graduates starting
                out and jobs for people with many years of experience.
              </p>
            </div>
            <div className="home-card">
              <Globe2 size={20} />
              <h3>Remote jobs from abroad</h3>
              <p>
                Work from your home in Nigeria for a company in another country. Many of these
                companies pay in dollars or other foreign currencies, which can mean much better pay
                than the same work at home. Always check the advert’s country, work-authorisation
                and time-zone wording; “remote” does not always mean open from Nigeria.
              </p>
            </div>
          </div>
        </section>

        <section className="home-section">
          <h2>What decides if you get the job?</h2>
          <p className="home-lead">
            Let us be honest with you. Seeing many jobs is only the first step. Companies abroad get
            applications from all over the world, so your chances depend mostly on your skills and
            how well you present them. The good news is that these are things you can improve.
          </p>
          <ul className="home-list">
            <li>
              <GraduationCap size={17} />
              <span>
                <strong>Your skills come first.</strong> The remote jobs that pay best ask for
                skills like software work, data work, design, writing, video editing, accounting,
                sales and customer support. Good skills give you a better chance.
              </span>
            </li>
            <li>
              <Check size={17} />
              <span>
                <strong>Show proof of your work.</strong> A sample project, a portfolio, or clear
                results from your last job can move you ahead of people who only list duties on
                their CV.
              </span>
            </li>
            <li>
              <Check size={17} />
              <span>
                <strong>Write your CV for the job in front of you.</strong> Read the advert. Use the
                same words for your skills where they are true. Remove things that do not matter for
                that job.
              </span>
            </li>
            <li>
              <Check size={17} />
              <span>
                <strong>Apply early and apply often.</strong> New jobs get many applications in the
                first days. People who apply every week, not once in a while, are the ones who get
                interviews.
              </span>
            </li>
            <li>
              <Wallet size={17} />
              <span>
                <strong>Be ready for the interview.</strong> For remote work you will need a laptop,
                steady internet and a quiet place to talk. Practice explaining your work in clear
                and simple English.
              </span>
            </li>
          </ul>
          <p className="home-lead">
            Nobody can promise you a job. We bring jobs into one place so you can spend your time
            applying well.
          </p>
        </section>

        <section className="home-section">
          <h2>Stay safe while you search</h2>
          <div className="home-card home-card--wide">
            <ShieldCheck size={20} />
            <p>
              A real employer will not ask you to pay to get a job. Do not pay for a form, training
              or uniform. Do not send bank details before you start work. The advert check in Pro
              can check a job advert, but it does not approve a company. Check each company yourself
              before you share personal documents.
            </p>
          </div>
        </section>

        <section className="home-cta">
          <h2>Your next job may already be listed here.</h2>
          <p>
            Create your free account now and see today's jobs in Nigeria and remote jobs from
            companies abroad.
          </p>
          {signedIn ? (
            <a className="btn btn--primary" href="/jobs">
              See your jobs <ArrowRight size={17} />
            </a>
          ) : (
            <a className="btn btn--primary" href="/auth/signup?returnTo=%2Fjobs">
              Create a free account <ArrowRight size={17} />
            </a>
          )}
        </section>

        <Footer />
      </main>
    </div>
  )
}
