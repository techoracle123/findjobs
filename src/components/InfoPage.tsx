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
          listing before applying. Never pay to apply.
        </p>
        <p>Our job is to make it easy to find opportunities — applying well is yours.</p>
      </>
    ),
  },
  '/privacy': {
    title: 'Privacy',
    body: (
      <>
        <p>
          <strong>What we collect.</strong> Your account email, the profile you build (skills,
          preferences), saved jobs, your confirmed application history, and job alerts. Anonymous
          browsing needs no account and stores only device-local preferences.
        </p>
        <p>
          <strong>Your CV stays on your device.</strong> When you upload a CV to improve your
          matches, the text is read and matched against skills in your own browser. Your CV file is
          not uploaded to FJ or to any third party.
        </p>
        <p>
          <strong>Sign-in codes.</strong> When you sign in, we send a one-time code to your email
          through our email delivery partner, which processes your email address only to deliver
          that message.
        </p>
        <p>
          <strong>Payments.</strong> Paid plans are not open yet. When they launch, card payments
          will be handled by our payment partner; we will never see or store your card details.
        </p>
        <p>
          <strong>Retention.</strong> Account data is kept until you delete your account. Aggregated
          application history is retained so your monthly progress works. Operational logs are kept
          for up to 30 days.
        </p>
        <p>
          <strong>Your rights (NDPA and similar laws).</strong> You may access, correct, export or
          erase your personal data, object to processing, and withdraw consent at any time. Use the
          account export/delete controls, or contact us below. We respond within the periods the law
          requires.
        </p>
        <p>
          <strong>Contact.</strong> Privacy requests: the FJ Telegram bot{' '}
          <a href="https://t.me/FindJobsForMeBot" target="_blank" rel="noopener noreferrer">
            @FindJobsForMeBot
          </a>
          . This page is a plain-English summary; the complete policy is being finalised and we
          recommend a legal review before launch.
        </p>
      </>
    ),
  },
  '/terms': {
    title: 'Terms',
    body: (
      <>
        <p>
          <strong>What FJ is.</strong> FJ aggregates publicly listed job opportunities. We do not
          guarantee that any listing is accurate, current, genuine, or that any employer will
          respond. No employment relationship exists between you and FJ.
        </p>
        <p>
          <strong>Job seekers never pay.</strong> We do not charge job seekers to browse, save or
          apply. Anyone asking you for money to get a job found through FJ should be reported.
        </p>
        <p>
          <strong>Your use of FJ.</strong> Use the service lawfully, do not scrape or abuse it, and
          verify listings independently before sharing personal information.
        </p>
        <p>
          <strong>Liability.</strong> FJ is provided “as is”. To the extent permitted by law, we are
          not liable for decisions made based on listings, or for the conduct of employers.
        </p>
        <p>These short terms are being expanded into the complete document.</p>
      </>
    ),
  },
  '/faq': {
    title: 'Questions',
    body: (
      <>
        <p>
          <strong>Do I pay to apply?</strong> No. Applying on the employer’s own site is always free
          and unlimited. FJ never asks you to pay for a job or an application.
        </p>
        <p>
          <strong>Are the jobs verified?</strong> We collect public listings and point you to the
          original posting. We do not verify or endorse employers. Always check the employer’s
          official website and confirm the vacancy there.
        </p>
        <p>
          <strong>How do I spot a job scam?</strong> See <a href="/scams">How to spot a job scam</a>
          . The short version: never pay to apply, and never share your BVN or bank details with a
          “recruiter”.
        </p>
        <p>
          <strong>How often does FJ refresh?</strong> Listings are recollected automatically every
          12 hours; publishers can add or remove roles at any time.
        </p>
        <p>
          <strong>Why do I see fewer non-English jobs?</strong> The default feed is English-first
          for Nigerian users. Turn on Worldwide in the More filter to see every language.
        </p>
        <p>
          <strong>How do I save jobs and track applications?</strong> Tap the bookmark on any job.
          When you apply through the original listing, mark the role as applied — your Progress
          dashboard counts what you confirm each month.
        </p>
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
          <li>
            “Pay small token”, “send your details to” a personal WhatsApp, or “refundable deposit”.
          </li>
          <li>Requests for your BVN, bank details or ID documents before a real interview.</li>
          <li>Offers made only over WhatsApp or SMS, with no verifiable company website.</li>
          <li>“Urgent”, “immediate”, “no experience needed”, “earn daily”, “daily payment”.</li>
          <li>Salary that is far above the market for the role.</li>
        </ul>
        <p>
          If a listing asks you for money, stop and report it from the job page — no account needed.
          Check the employer on their official website and confirm the vacancy there before you
          share anything.
        </p>
      </>
    ),
  },
  '/contact': {
    title: 'Contact',
    body: (
      <>
        <p>
          Questions, feedback or a listing to report? Reach us through the FJ Telegram bot:{' '}
          <a href="https://t.me/FindJobsForMeBot" target="_blank" rel="noopener noreferrer">
            @FindJobsForMeBot
          </a>
          .
        </p>
        <p>Report suspicious listings any time — no account needed.</p>
      </>
    ),
  },
}

export function InfoPage({ path }: { path: string }) {
  const page = PAGES[path] ?? PAGES['/about']
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
