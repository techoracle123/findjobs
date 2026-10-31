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
      <header className="topbar">
        <a className="brand" href="/" aria-label="FJ - Find Jobs">
          <img className="brand__logo" src="/favicon.svg" alt="" width="36" height="36" />
          <span>
            FJ{' '}
            <span className="brand__separator" aria-hidden="true">
              —
            </span>{' '}
            Find Jobs
          </span>
        </a>
        <nav className="topnav" aria-label="Primary">
          <a href="/jobs">Jobs</a>
          <a href="/pricing">Pricing</a>
          <a href="/about">About</a>
        </nav>
        <div className="topbar__spacer" />
        <div className="topbar__actions">
          {signedIn ? (
            <a className="btn btn--primary btn--sm" href="/jobs">
              See your jobs
            </a>
          ) : (
            <>
              <a className="btn btn--ghost btn--sm" href="/auth/login?returnTo=%2Fjobs">
                Sign in
              </a>
              <a
                className="btn btn--primary btn--sm nav-signup"
                href="/auth/signup?returnTo=%2Fjobs"
              >
                Sign up
              </a>
            </>
          )}
        </div>
      </header>

      <main className="content home">
        <section className="home-hero">
          <span className="eyebrow">Jobs in Nigeria. Remote jobs from abroad.</span>
          <h1>Thousands of job opportunities. All in one place.</h1>
          <p>
            Looking for work should not mean opening ten different websites every day. We gather
            real job adverts from many companies in Nigeria and from companies abroad that hire
            people who work from home. We put them in one place. You come here, find the ones that
            fit your skills, and apply.
          </p>
          <p>
            We present the opportunities to you. What you do with them is up to you. Some of these
            jobs pay in naira. Some remote jobs pay in dollars, pounds or euros. When a company
            publishes the salary, you will see it on the job before you apply.
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
            You need a free account to see the jobs. Creating one takes less than a minute, and it
            lets us save your jobs and send you free alerts.
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
            A free FJ account is a complete job-search account. You are not given a small sample of
            jobs and then asked to pay to finish an application.
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
          <p className="eyebrow">When the problem is no longer finding jobs</p>
          <h2 id="home-pro-heading">Pro helps you choose better and apply stronger</h2>
          <p className="home-lead">
            Many people can find one hundred adverts. The hard part is knowing which ones accept
            Nigeria, which ones look unsafe, whether your CV proves what the advert asks for, and
            how to write a convincing application without inventing experience. That is the work Pro
            does.
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
                One full CV analysis and three complete application packs. No card is taken and the
                trial ends by itself.
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
              <p>Find, save, alert and apply on employer sites.</p>
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
              <p>
                Same Pro tools for eligible final-year students, recent graduates and corps members.
              </p>
            </div>
          </div>
          <p className="field__hint">
            Payments open in the next stage. Prices are shown now so you can decide with full
            information. <a href="/pricing">Compare every feature and check graduate eligibility</a>
            .
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
                sales and customer support. The stronger your skill, the stronger your chances.
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
            Nobody can promise you a job, and you should run away from anybody who does. What we can
            do is bring you real opportunities every day in one place, so your effort goes into
            applying well instead of searching all over the internet.
          </p>
        </section>

        <section className="home-section">
          <h2>Stay safe while you search</h2>
          <div className="home-card home-card--wide">
            <ShieldCheck size={20} />
            <p>
              A real employer will never ask you to pay money to get a job. Not for a form, not for
              training, not for a uniform, not for anything. If a job asks you to pay, or asks for
              your bank details before you are employed, stop and report it. Pro’s before-you-apply
              check can also review an advert pasted from WhatsApp, Telegram or email, but it does
              not verify an employer. Jobs on FJ come from employers and public job boards. We do
              not employ you ourselves, and the final application always happens with the company.
              Check every company well before you share personal documents.
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
