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
        <p>
          FJ also has a separate practical ideas section. It uses local figures and trending
          searches to suggest physical products, websites and apps for different places. The figures
          give background, but they do not prove that people will buy an idea.
        </p>
        <p>
          We help you find work and research ideas. You decide where to apply and what to build, and
          you do the checks yourself.
        </p>
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
          <strong>Public user total.</strong> The homepage shows the total number of registered
          accounts. It does not show your name, email address or anything about your account.
        </p>
        <p>
          <strong>Product ideas stay on your device.</strong> You can browse local figures and
          trending searches without an account. Saved ideas and checklists are stored only in your
          browser. FJ does not receive them. World Bank and Google process ordinary technical
          requests when their public data feeds are loaded, but FJ does not send them your profile,
          CV or saved ideas.
        </p>
        <p>
          <strong>Free CV import stays on your device.</strong> When you use basic CV import to
          improve your matches, the file is read in your browser for skill suggestions. It is not
          saved in that step.
        </p>
        <p>
          <strong>Saved CV text on Free or Pro.</strong> Saving CV text is a separate choice for any
          signed-in user. Only when you tick the permission box does FJ save the readable text from
          your CV, a code that identifies that text, and a short summary in your account. A full
          report is included while everything is free. FJ does not keep the original PDF, DOCX or
          TXT file. The saved text is used only to give you the CV check, job checks, prepared
          applications and interview practice. FJ does not send it to an employer for you. You can
          view it, download it, replace it or delete it from your profile and Pro tools. It is
          included in account export and removed when you delete it or delete your account.
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
          flagged check may be reviewed by an FJ admin with permission to review it.
        </p>
        <p>
          <strong>Your password.</strong> You sign in with your email and password. We store only a
          scrambled form of your password that cannot be turned back into the password itself, so
          even we cannot read it. If you forget it, we email you a one-time reset link through our
          email delivery partner, which uses your email address only to deliver that message.
        </p>
        <p>
          <strong>Payments are paused.</strong> Every current FJ tool is free for now and there is
          no way to make a new payment. If payments reopen later, FJ will explain the price and the
          payment partner before asking you to choose. Existing payment records remain protected. FJ
          never sees or stores your full card number.
        </p>
        <p>
          <strong>How long we keep information.</strong> Account information is kept until you
          delete the item or your account. Saved CV text is kept until you delete or replace it, or
          delete your account. Monthly totals from your application history are kept so your
          progress page works. Technical logs are kept for up to 30 days.
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
          <strong>What FJ is.</strong> FJ collects publicly listed jobs, gigs and contracts. We do
          not guarantee that any listing is accurate, current or genuine, or that any employer or
          client will respond. No employment relationship exists between you and FJ.
        </p>
        <p>
          <strong>Everything is free for now.</strong> You can browse, save, receive alerts, apply
          and use the current preparation tools without paying. Payments are paused. Account,
          privacy and safety rules still apply. FJ never charges for a job, gig, application or
          pitch. Anyone asking you for money to get a job found through FJ should be reported.
        </p>
        <p>
          <strong>Your use of FJ.</strong> Use FJ legally and fairly. Do not use automated tools to
          copy it, and check listings yourself before sharing personal information.
        </p>
        <p>
          <strong>Free preparation tools.</strong> While everything is free, you do not need a trial
          or paid plan. CV suggestions and prepared applications are drafts. You must check that
          every statement is true before sending it. FJ does not submit applications for you and
          does not guarantee a reply, interview, client call, offer, job or gig. FJ Match
          Intelligence compares your CV with an advert, but it cannot predict whether you will get
          the job. The advert checker shows words and warning signs from the advert; it does not
          prove that an employer or client is safe.
        </p>
        <p>
          <strong>Payment records.</strong> New payments are paused. Existing payment and paid-plan
          records are kept so we can support your account. If paid plans return, FJ will show the
          current terms before you choose to pay. Product ideas and trending searches are starting
          points for your own research. They do not guarantee sales, profit or business success.
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
          <strong>Are the listings checked?</strong> We collect public listings and point you to the
          original posting. We do not approve employers or clients. Always check the official
          website and confirm the work there.
        </p>
        <p>
          <strong>How do I spot a job scam?</strong> See <a href="/scams">How to spot a job scam</a>
          . The short version: never pay to apply, and never share your BVN or bank details with a
          “recruiter”.
        </p>
        <p>
          <strong>How often does FJ add new listings?</strong> FJ checks for new adverts
          automatically throughout the day. Timing varies by source. Employers and job boards can
          add or remove adverts at any time, so check the original advert before applying.
        </p>
        <p>
          <strong>Why do I see fewer non-English jobs?</strong> FJ mainly shows English listings at
          first. To see listings in every language, turn on Worldwide under More.
        </p>
        <p>
          <strong>Why do I need an account to see listings?</strong> So we can save your jobs, gigs,
          alerts and applications and show them to you on any device. The account is free, and
          applying on the original site is always free.
        </p>
        <p>
          <strong>Are all tools free?</strong> Yes, for now. That includes the full CV check, FJ
          Match Intelligence, application preparation, advert checks, best matches, Telegram alerts,
          tracking, skill guidance, interview help and pay checks. Create a free account and open
          Plan to see the tools. Payments are paused, so you cannot buy or renew a plan.
        </p>
        <p>
          <strong>Do I need to start a trial?</strong> No. All current tools are free for now. Your
          account and private work are still protected by sign-in and permission checks.
        </p>
        <p>
          <strong>What are practical ideas?</strong> This public section uses local figures to
          suggest physical products, websites and apps for different places. It shows the exact
          figure, the year and where it came from. Trending searches are shown separately. Neither
          the figures nor the searches prove that people will buy an idea. Browse{' '}
          <a href="/ideas">practical ideas</a> without an account and save your work on your device.
        </p>
        <p>
          <strong>Does FJ save my CV?</strong> Only if you choose the separate saved-CV action and
          tick the permission box. Every signed-in user can save readable CV text and a short
          summary. The full report is included while everything is free. FJ does not keep the
          original file. Basic CV import remains on your device until you choose to save it. You can
          download or delete the saved text.
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
          <li>Offers made only over WhatsApp or SMS, with no company website you can check.</li>
          <li>“Urgent”, “immediate”, “no experience needed”, “earn daily”, “daily payment”.</li>
          <li>Salary that is far above the market for the role.</li>
        </ul>
        <p>
          The free advert check can review jobs on FJ and adverts you paste from WhatsApp, Telegram,
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
