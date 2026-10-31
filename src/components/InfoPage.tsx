import { ArrowLeft } from 'lucide-react'
import { Footer } from './Footer'
import { SiteHeader } from './SiteHeader'

const PAGES: Record<string, { title: string; body: JSX.Element }> = {
  '/about': {
    title: 'About FJ',
    body: (
      <>
        <p>
          FJ Find Jobs helps people in Nigeria and around the world find real jobs in many types of
          work. We collect public job adverts from company career pages and job boards. We put them
          in one place and link to the original advert.
        </p>
        <p>
          FJ is not an employer or a recruiter. We do not approve companies or jobs. Finding jobs
          and applying on the company website are free. Pro tools can help you check an advert,
          check your CV and prepare an application. Check the company and the original advert
          yourself before you apply. Never pay to apply.
        </p>
        <p>We help you find jobs. You apply on the company website.</p>
      </>
    ),
  },
  '/privacy': {
    title: 'Privacy',
    body: (
      <>
        <p>
          <strong>What we collect.</strong> Your account email, the profile you build (skills,
          preferences), saved jobs and stages, your confirmed application history, job alerts, saved
          application answers and prepared applications, trial use, and graduate price answers if
          you use that check. The homepage and information pages need no account. Seeing the jobs
          needs the free account, so your saved jobs and alerts follow you on any device.
        </p>
        <p>
          <strong>Free CV import stays on your device.</strong> When you use basic CV import to
          improve your matches, the file is read in your browser for skill suggestions. It is not
          saved in that step.
        </p>
        <p>
          <strong>Saved CV in Pro or the free trial.</strong> The full CV check is a separate
          choice. Only when you tick the permission box does FJ save the readable text from your CV,
          a code that identifies that text, and the report in your account. The original PDF or DOCX
          file is not retained. The saved text is used only to give you the CV check, job checks,
          prepared applications and interview practice. FJ does not send it to an employer for you.
          You can view it, download it, replace it or delete it from your profile and Pro tools. It
          is included in account export and removed when you delete it or delete your account.
        </p>
        <p>
          <strong>One-off checks.</strong> CV text pasted into a single job check is not saved as
          your saved CV by that tool. A job advert pasted into the advert checker is used for that
          check and is not saved.
        </p>
        <p>
          <strong>Graduate price check.</strong> If you check the graduate price, FJ stores your
          answers, month and year answers, work history group, confirmation and the result so the
          correct price can be offered and reviewed. We do not ask for your age, BVN or NIN. A
          flagged check may be reviewed by an authorised FJ administrator.
        </p>
        <p>
          <strong>Your password.</strong> You sign in with your email and password. We store only a
          scrambled form of your password that cannot be turned back into the password itself, so
          even we cannot read it. If you forget it, we email you a one time reset link through our
          email delivery partner, which processes your email address only to deliver that message.
        </p>
        <p>
          <strong>Payments.</strong> Paid plans are not open yet. Card and bank transfer payments
          will come later and will be handled by our payment partner; we will never see or store
          your card details.
        </p>
        <p>
          <strong>Retention.</strong> Account data is kept until you delete the relevant item or
          your account. Saved CV text is kept until you delete or replace it, or delete your
          account. Aggregated application history is retained so your monthly progress works.
          Operational logs are kept for up to 30 days.
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
          <strong>Finding and applying are free.</strong> We do not charge to browse, save, receive
          basic alerts or apply on an employer's own site. Optional Pro tools may be paid when
          payments open, but Pro is never a fee for a job or for submitting an application. Anyone
          asking you for money to get a job found through FJ should be reported.
        </p>
        <p>
          <strong>Your use of FJ.</strong> Use the service lawfully, do not scrape or abuse it, and
          verify listings independently before sharing personal information.
        </p>
        <p>
          <strong>Pro tools and the free trial.</strong> The trial lasts 3 days. It includes one
          full CV check and help for three jobs. It ends on its own. We do not take card details. CV
          suggestions and prepared applications are drafts. You must check that every statement is
          true before sending it. FJ does not submit applications for you and does not guarantee a
          reply, interview, offer or job. The advert checker shows evidence and warning signs; it is
          not employer verification.
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
          <strong>Why do I need an account to see jobs?</strong> So we can save your jobs, alerts
          and applications and show them to you on any device. The account is free, and applying on
          the employer's site is always free.
        </p>
        <p>
          <strong>What is Pro?</strong> Pro adds a saved CV, a full CV check, a check of your CV
          against one job, help to prepare applications, advert checks, best matches, Telegram
          alerts with filters, application stages, a list of skills to learn, interview practice and
          pay checks. See <a href="/pricing">Pricing</a> to compare plans.
        </p>
        <p>
          <strong>How does the free trial work?</strong> After creating a free account, you can
          start one free Pro trial for 3 days. We do not ask for card details. It includes one full
          CV check and help for three jobs. It ends on its own. Work you create stays in your
          account.
        </p>
        <p>
          <strong>Who gets Pro for Graduates?</strong> Final-year students, recent graduates and
          current or recent NYSC members with less than two years of full time paid work. The
          pricing page has the checker and exact time windows.
        </p>
        <p>
          <strong>Does FJ save my CV?</strong> Only if you choose the Pro CV check and tick the
          permission box. FJ then saves readable text and the report, not the original file. Basic
          CV import remains on your device. You can download or delete saved text.
        </p>
        <p>
          <strong>Does FJ apply for me?</strong> No. FJ can prepare the words, but you review and
          submit every application yourself on the employer's site.
        </p>
        <p>
          <strong>How do I save jobs and track applications?</strong> Tap the bookmark on any job.
          When you apply through the original listing, mark the role as applied. Your Progress
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
          Pro and the free trial can check jobs on FJ and adverts you paste from WhatsApp, Telegram,
          email or another site. The check looks for fees, requests for ID, contact by message only,
          and words about who can work from Nigeria. It does not approve a company. Check the
          company website yourself.
        </p>
        <p>
          If a listing asks you for money, stop and report it from the job page. You do not need an
          account. Check the employer on their official website and confirm the vacancy there before
          you share anything.
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
        <p>You can report a bad job at any time. You do not need an account.</p>
      </>
    ),
  },
}

export function InfoPage({ path }: { path: string }) {
  const page = PAGES[path] ?? PAGES['/about']
  return (
    <div className="app">
      <SiteHeader current={path === '/about' ? 'about' : undefined} />
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
