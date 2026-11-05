import { useEffect, useState } from 'react'
import {
  ArrowRight,
  Bell,
  Bookmark,
  Briefcase,
  Check,
  Globe2,
  GraduationCap,
  Lightbulb,
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
  const [ideaTotal, setIdeaTotal] = useState<number | null>(null)
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
      try {
        const response = await fetch('/api/ideas?country=NGA&limit=1')
        const body = (await response.json()) as { catalogTotal?: number }
        if (response.ok && typeof body.catalogTotal === 'number') setIdeaTotal(body.catalogTotal)
      } catch {
        // Jobs and the public counters remain useful if idea evidence is refreshing.
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

        <section className="home-section home-ideas-teaser" aria-labelledby="home-ideas-heading">
          <p className="eyebrow">Beyond finding work</p>
          <h2 id="home-ideas-heading">Find a product idea and check it with real people</h2>
          <p className="home-lead">
            Look at official figures for Nigeria, another country or the whole world. Find physical
            and software products you could build or sell, and see what people are searching for.
            Every idea includes who it is for, a simple first version, possible risks and checks to
            do before spending money.
          </p>
          {ideaTotal !== null ? (
            <p className="home-idea-count">
              <Lightbulb size={19} /> <strong>{number(ideaTotal)}</strong> product ideas for
              different places, each linked to official figures
            </p>
          ) : null}
          <p className="field__hint">
            The figures help explain a problem. They do not prove that people will buy the product
            or that the business will succeed.
          </p>
          <a className="btn btn--primary" href="/ideas">
            Explore product ideas <ArrowRight size={17} />
          </a>
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
          <p className="eyebrow">Free for now</p>
          <h2 id="home-pro-heading">Every job preparation tool is free for now</h2>
          <p className="home-lead">
            Finding work is only one part. FJ Match Intelligence compares your CV with an advert. It
            shows which requirements you meet, which skills are missing, whether the location works
            for you, and other adverts that may fit you better. Other Pro tools help you prepare and
            spot warning signs in the advert.
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
              <h3>No card or trial needed</h3>
              <p>
                Use the CV check, FJ Match Intelligence, application preparation, interview help and
                the other current tools with your free account. You do not need to start a trial or
                buy anything.
              </p>
            </div>
            <a className="btn btn--primary" href="/pricing">
              See everything included <ArrowRight size={17} aria-hidden="true" />
            </a>
          </div>
          <p className="field__hint">
            Private CV text and account information still require sign-in and your permission. Rules
            that keep FJ safe and fair for everyone still apply.
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
                than the same work at home. Always check which countries the advert accepts, whether
                you need permission to work there, and the working hours. “Remote” does not always
                mean you can apply from Nigeria.
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
                <strong>Apply early and keep trying.</strong> New jobs can receive many applications
                quickly. Set aside time each week to look for suitable work and send careful
                applications.
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
              training or uniform. For a gig, write down the exact work, deadline, changes included
              and when you will be paid before you start. The advert check in Pro can review advert
              text, but it does not approve a company or client. Check each one yourself before you
              share personal documents.
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
