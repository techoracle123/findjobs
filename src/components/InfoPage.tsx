import { ArrowLeft } from 'lucide-react'
import { Footer } from './Footer'

const PAGES: Record<string, { title: string; body: JSX.Element }> = {
  '/about': {
    title: 'About FJ',
    body: (
      <>
        <p>
          FJ — Find Jobs helps people in Nigeria and around the world discover real job
          opportunities across professions. We collect public listings from employer career pages
          and job boards, clean them up, and link you to the original posting.
        </p>
        <p>
          FJ is an information broker, not an employer or recruiter. We do not verify or endorse
          listings, and we never charge job seekers. Always verify the employer and the original
          listing before applying.
        </p>
      </>
    ),
  },
  '/privacy': {
    title: 'Privacy',
    body: (
      <>
        <p>
          Your profile, saved jobs and application history stay in your account or on your device.
          We do not sell personal data. Anonymous browsing needs no account.
        </p>
        <p>
          When you use AI features such as CV suggestions or translations, the text you submit is
          sent to our AI provider, OpenRouter, to generate a response. Do not upload information you
          are not comfortable sharing with that service.
        </p>
        <p>
          You can export or delete your account data at any time from your account. This page is a
          short summary; the complete policy, including retention periods and your full rights under
          the Nigeria Data Protection Regulation, is being finalised and will replace this text.
        </p>
      </>
    ),
  },
  '/terms': {
    title: 'Terms',
    body: (
      <>
        <p>
          FJ aggregates publicly listed job opportunities. We do not guarantee that any listing is
          accurate, current, or genuine, and no employment relationship exists between you and FJ.
        </p>
        <p>
          Job seekers never pay to apply. Never pay anyone who claims to hire through FJ. Use of FJ
          means you agree to verify listings independently and to use the service lawfully.
        </p>
        <p>These short terms are being expanded into the complete document.</p>
      </>
    ),
  },
  '/scams': {
    title: 'How to spot a job scam',
    body: (
      <>
        <p>
          Real employers do not charge you to apply or to get hired. Watch for these warning signs:
        </p>
        <ul>
          <li>Anyone asking for a registration fee, training fee, “processing” fee or deposit.</li>
          <li>Requests for your BVN, bank details or ID documents before a real interview.</li>
          <li>Offers made only over WhatsApp or SMS, with no verifiable company website.</li>
          <li>
            “Urgent”, “no experience needed”, “earn daily” or salary that is too good to be true.
          </li>
        </ul>
        <p>
          If a listing asks you for money, stop and report it. Check the employer on their official
          website and confirm the vacancy there before you share anything.
        </p>
      </>
    ),
  },
  '/contact': {
    title: 'Contact',
    body: (
      <>
        <p>
          Questions or a listing to report? Reach us through the FJ Telegram bot:{' '}
          <a href="https://t.me/FindJobsForMeBot" target="_blank" rel="noopener noreferrer">
            @FindJobsForMeBot
          </a>
          .
        </p>
        <p>Report suspicious listings any time — no account needed.</p>
      </>
    ),
  },
  '/employers': {
    title: 'For employers',
    body: (
      <>
        <p>
          Employer accounts and job posting are on the way. Until then, publish vacancies on your
          public careers page or an established job board — FJ collects from them automatically.
        </p>
        <p>Verified employer profiles, direct posting and applicant tools are in development.</p>
      </>
    ),
  },
}

export function InfoPage({ path }: { path: string }) {
  const page = PAGES[path] ?? PAGES['/about']
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="/">
          <img className="brand__logo" src="/favicon.svg" alt="" width="36" height="36" />
          <span>
            FJ{' '}
            <span className="brand__separator" aria-hidden="true">
              —
            </span>{' '}
            Find Jobs
          </span>
        </a>
      </header>
      <main className="auth-page">
        <a className="auth-back" href="/">
          <ArrowLeft size={16} /> Back to opportunities
        </a>
        <article className="info-card">
          <h1>{page.title}</h1>
          {page.body}
        </article>
      </main>
      <Footer />
    </div>
  )
}
