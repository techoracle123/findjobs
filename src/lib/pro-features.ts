export interface PlanFeature {
  id: string
  title: string
  what: string
  why: string
}

export const FREE_FEATURES: PlanFeature[] = [
  {
    id: 'search',
    title: 'Search every job FJ has',
    what: 'Search, filter and open jobs from Nigeria and around the world.',
    why: 'You should not pay just to see public job openings.',
  },
  {
    id: 'apply',
    title: 'Apply on the employer’s site for free',
    what: 'Open the employer’s own application page as many times as you need.',
    why: 'There is no daily application limit and FJ never blocks an application to sell Pro.',
  },
  {
    id: 'fit',
    title: 'Profile fit and reasons',
    what: 'Your skills, target roles, work modes and preferences produce a fit score with plain reasons.',
    why: 'You can quickly tell which adverts deserve a closer look.',
  },
  {
    id: 'cv-import',
    title: 'Basic CV import on your device',
    what: 'Choose a readable PDF or DOCX and FJ suggests skills, roles and seniority from the text it can read.',
    why: 'It saves typing. Nothing is saved as a Pro master CV unless you separately agree.',
  },
  {
    id: 'track',
    title: 'Save jobs and mark them applied',
    what: 'Keep a basic list of jobs you want to revisit and jobs you have already applied for.',
    why: 'Your shortlist stays together when you sign in again.',
  },
  {
    id: 'alerts',
    title: 'Free keyword alerts on Telegram',
    what: 'Create an alert for a role, skill or employer keyword and receive matching new jobs on Telegram.',
    why: 'Basic job alerts stay free.',
  },
]

export const PRO_FEATURES: PlanFeature[] = [
  {
    id: 'cv_analysis',
    title: 'Saved master CV and detailed CV analysis',
    what: 'With your permission, FJ saves the readable text from your CV and reviews contact details, summary, skills, experience, education, projects, dates and readability.',
    why: 'You see exactly what is strong, what is weak, which bullet needs evidence and which fix matters first.',
  },
  {
    id: 'cv_check',
    title: 'CV-to-job comparison',
    what: 'Your saved CV and profile are compared with one exact advert, with matching lines and missing skills separated.',
    why: 'You can tailor the CV you send instead of sending the same version everywhere.',
  },
  {
    id: 'prepared_applications',
    title: 'Complete application packs',
    what: 'FJ prepares a cover letter, common application answers, skills to show first, a final checklist and a ready-to-send email when the advert gives an email address.',
    why: 'It cuts repeated writing while keeping every claim grounded in your own information.',
  },
  {
    id: 'advert_check',
    title: 'Before-you-apply check',
    what: 'Check an FJ job or paste an advert from WhatsApp, Telegram, email or another site. FJ shows Nigeria eligibility evidence and visible fake-job warning signs.',
    why: 'You can avoid spending hours on a job you cannot take or one asking for money and personal documents.',
  },
  {
    id: 'smart_shortlist',
    title: 'Best matches for today',
    what: 'Your strongest current matches are ranked together with the reasons each one made the list.',
    why: 'You start with the most promising adverts instead of paging through thousands.',
  },
  {
    id: 'smart_alerts',
    title: 'Smart Telegram alerts',
    what: 'Add a minimum profile fit, country and work mode, salary/currency, watched companies and words to exclude.',
    why: 'Free keyword alerts continue, but Pro alerts reduce unwanted matches.',
  },
  {
    id: 'application_pipeline',
    title: 'Application stages and follow-ups',
    what: 'Track preparing, applied, interview, offer and closed stages, then add a follow-up date.',
    why: 'You can see what needs attention next instead of keeping it in your head.',
  },
  {
    id: 'skill_plan',
    title: 'Repeated skill-gap plan',
    what: 'FJ finds skills that keep appearing in jobs suited to you and turns the top gaps into a four-week plan.',
    why: 'You learn or demonstrate the skill employers are actually asking for first.',
  },
  {
    id: 'interview_prep',
    title: 'Interview preparation',
    what: 'Likely questions, answer structure, questions to ask the employer and a short preparation checklist based on the advert.',
    why: 'Your preparation is tied to the actual duties and tools in this role.',
  },
  {
    id: 'salary_guide',
    title: 'Salary guide from real adverts',
    what: 'See pay ranges only when enough comparable current adverts state their pay. FJ shows the number of adverts behind the guide.',
    why: 'You get evidence for a salary conversation rather than a made-up average.',
  },
]

export const PRO_LIMITS = [
  'Applying on the employer’s own site is always free and unlimited.',
  'FJ does not apply for you, guarantee an interview or guarantee a job.',
  'FJ does not verify employers. Warning signs are evidence to check, not approval.',
  'Your master CV is saved only with your permission, and you can download or delete the saved text.',
  'FJ never adds employers, qualifications, dates, tools, projects or numbers to your CV for you.',
]
