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
  Users,
  Wallet,
} from 'lucide-react'
import { Footer } from './Footer'
import { SiteHeader } from './SiteHeader'
import { FREE_FEATURES, PRO_FEATURES } from '../lib/pro-features'

interface PublicStats {
  total: number
  nigeria: number
  remote: number
  gigs?: number
  countries: number
  registeredUsers?: number | null
  updatedAt: string
}

/**
 * The public homepage. It explains what FJ is, shows honest live counts,
 * teaches what improves a person's chances, and invites them to create the
 * free account they need before they can see the jobs.
 */
export function HomePage() {
  const [stats, setStats] = useState<PublicStats | null>(null)
  const [registeredUsers, setRegisteredUsers] = useState<number | null>(null)
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    document.title = 'FJ - Find Jobs. Thousands of job opportunities in one place.'
    void (async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let loadedUsers = false
        let loadedStats = false
        try {
          const response = await fetch('/api/public-stats')
          const body = (await response.json().catch(() => null)) as
            (PublicStats & { available?: boolean }) | null
          if (typeof body?.registeredUsers === 'number') {
            setRegisteredUsers(body.registeredUsers)
            loadedUsers = true
          }
          if (response.ok && body && body.available !== false && typeof body.total === 'number') {
            setStats(body)
            loadedStats = true
          }
        } catch {
          /* One retry below handles a brief connection failure. */
        }
        if (loadedUsers && loadedStats) break
        if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 1200))
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
          <span className="eyebrow">Jobs in Nigeria. Gigs and remote work from abroad.</span>
          <h1>Thousands of job opportunities. All in one place.</h1>
          <p>
            We bring jobs, freelance gigs, short projects and contracts from Nigeria and abroad into
            one place. You do not need to check many websites each day.
          </p>
          <p>
            Some work pays in naira. Some remote work pays in dollars, pounds or euros. Look for web
            development, cybersecurity, data analytics, design, writing and other digital skills. If
            an advert states the pay, you will see it before you apply.
          </p>
          <div className="home-hero__actions">
            {signedIn ? (
              <a className="btn btn--primary" href="/jobs">
                See jobs and gigs <ArrowRight size={17} />
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
          {registeredUsers !== null && (
            <p className="home-user-count" aria-live="polite">
              <Users size={18} aria-hidden="true" />
              <span>
                <strong>{number(registeredUsers)}</strong>{' '}
                {registeredUsers === 1 ? 'person has' : 'people have'} registered on FJ
              </span>
            </p>
          )}
          <p className="field__hint">
            {signedIn
              ? 'You are signed in. Your saved work and free alerts are in your account.'
              : 'You need a free account to see the jobs and gigs. Creating one takes less than a minute, and it lets us save your work and send you free alerts.'}
          </p>
        </section>

        {(stats || registeredUsers !== null) && (
          <section className="home-stats-section" aria-labelledby="home-numbers-heading">
            <div className="home-stats-head">
              <p className="eyebrow">Live numbers</p>
              <h2 id="home-numbers-heading">FJ in numbers</h2>
            </div>
            <div className={`home-stats ${stats ? '' : 'home-stats--users-only'}`}>
              {registeredUsers !== null && (
                <div className="home-stat home-stat--users">
                  <strong>{number(registeredUsers)}</strong>
                  <span>registered users</span>
                </div>
              )}
              {stats && (
                <>
                  <div className="home-stat">
                    <strong>{number(stats.total)}</strong>
                    <span>jobs and gigs listed right now</span>
                  </div>
                  <div className="home-stat">
                    <strong>{number(stats.nigeria)}</strong>
                    <span>listings in Nigeria</span>
                  </div>
                  <div className="home-stat">
                    <strong>{number(stats.remote)}</strong>
                    <span>remote listings you may do from home</span>
                  </div>
                  {typeof stats.gigs === 'number' && (
                    <div className="home-stat">
                      <strong>{number(stats.gigs)}</strong>
                      <span>gigs and contracts</span>
                    </div>
                  )}
                  <div className="home-stat">
                    <strong>{number(stats.countries)}</strong>
                    <span>countries hiring</span>
                  </div>
                </>
              )}
            </div>
          </section>
        )}
        {(stats || registeredUsers !== null) && (
          <p className="field__hint home-stats__note">
            {stats
              ? 'Listing numbers come from the adverts on FJ right now. New adverts are collected twice a day, and closed listings are removed. The gig number counts only adverts with clear contract, freelance, project or temporary wording. '
              : ''}
            The registered-user number counts FJ accounts and leaves out test accounts.
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
              <h3>2. Find and save good work</h3>
              <p>
                Choose jobs, gigs and contracts, or all work. Then search by profession, place or
                work setting. Save the adverts that fit you so you can come back to them.
              </p>
            </div>
            <div className="home-step">
              <Bell size={20} />
              <h3>3. Apply and keep going</h3>
              <p>
                We take you to the original page where the real application or pitch happens.
                Applying there is always free. Keep a list of where you applied, and turn on free
                alerts so new work comes to you.
              </p>
            </div>
          </div>
        </section>

        <section className="home-section" aria-labelledby="home-free-heading">
          <p className="eyebrow">No card. No application limit.</p>
          <h2 id="home-free-heading">Everything you need to find and apply is free</h2>
          <p className="home-lead">
            A free account lets you search, save and apply. We will not ask you to pay to get a job
            or gig, or to finish an application.
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
            Finding work is only one part. FJ Match Intelligence compares your CV with an advert,
            separates essential requirements from desirable ones, names missing skills, checks
            location signals, and points to stronger alternatives. Other Pro tools help you prepare
            and check safety signs in the advert text.
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
                Check one CV in full and get help, including FJ Match Intelligence, for three
                listings. We do not ask for card details. The trial ends on its own. It is optional.
                You can skip it and buy Pro at once.
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
            Compare the plans before you decide. The free trial needs no card, and you do not need
            it before you pay. <a href="/pricing">See prices or check the graduate price</a>.
          </p>
        </section>

        <section className="home-section">
          <h2>What kind of work is here?</h2>
          <div className="home-two">
            <div className="home-card">
              <MapPin size={20} />
              <h3>Jobs in Nigeria</h3>
              <p>
                Work with banks, hospitals, schools, factories, shops, offices and tech companies in
                Lagos, Abuja, Port Harcourt and other states. There are jobs for graduates starting
                out and jobs for people with many years of experience.
              </p>
              <h3>Gigs and contracts</h3>
              <p>
                Short projects and contract work appear only when the source or advert gives clear
                contract, freelance, project or temporary wording. Contract length is shown when the
                advert states it.
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
          <h2>What decides if you get the work?</h2>
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
            Nobody can promise you a job or gig. We bring real adverts into one place so you can
            spend your time applying well.
          </p>
        </section>

        <section className="home-section">
          <h2>Stay safe while you search</h2>
          <div className="home-card home-card--wide">
            <ShieldCheck size={20} />
            <p>
              A real employer or client will not ask you to pay to get work. Do not pay for a form,
              training or uniform. For a gig, agree the scope, deadline, revisions and payment
              schedule in writing before you start. The advert check in Pro can review advert text,
              but it does not approve a company or client. Check each one yourself before you share
              personal documents.
            </p>
          </div>
        </section>

        <section className="home-cta">
          <h2>Your next job or gig may already be listed here.</h2>
          <p>
            Create your free account now and see today's jobs, gigs and contracts in Nigeria and
            from companies abroad.
          </p>
          {signedIn ? (
            <a className="btn btn--primary" href="/jobs">
              See jobs and gigs <ArrowRight size={17} />
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
