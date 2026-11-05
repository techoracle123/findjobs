export interface PlanFeature {
  id: string
  title: string
  what: string
  why: string
}

export const FREE_FEATURES: PlanFeature[] = [
  {
    id: 'search',
    title: 'Search jobs, gigs and contracts',
    what: 'Search full-time and part-time jobs, freelance gigs, short projects and contracts in Nigeria and other countries.',
    why: 'You do not pay to see a public advert.',
  },
  {
    id: 'apply',
    title: 'Apply free on the original website',
    what: 'Open the employer or client application page as many times as you need.',
    why: 'FJ does not limit your applications or submissions.',
  },
  {
    id: 'fit',
    title: 'See why work fits you',
    what: 'FJ uses your skills and the kind of work you want to show which adverts may fit you.',
    why: 'You can see which adverts need a closer look.',
  },
  {
    id: 'cv-import',
    title: 'Fill your profile from your CV',
    what: 'Choose a PDF or DOCX. Your device reads it and suggests skills and kinds of work.',
    why: 'This saves typing. The CV is not saved in this step.',
  },
  {
    id: 'track',
    title: 'Save work and mark what you applied for',
    what: 'Keep jobs and gigs you want, plus the ones you already applied or pitched for, in one list.',
    why: 'Your list is there when you sign in again.',
  },
  {
    id: 'alerts',
    title: 'Free Telegram alerts',
    what: 'Watch a skill, company or kind of work. Choose jobs, gigs and contracts, or all work.',
    why: 'Basic alerts and the jobs or gigs choice are free.',
  },
]

export const PRO_FEATURES: PlanFeature[] = [
  {
    id: 'cv_analysis',
    title: 'Save and check your CV',
    what: 'If you agree, FJ saves the text from one CV and checks contact details, skills, work, school, projects and dates.',
    why: 'You see what to fix first.',
  },
  {
    id: 'cv_check',
    title: 'FJ Match Intelligence',
    what: 'FJ compares your CV with an advert. It shows which requirements you meet, which skills are missing, whether the location works for you, and other adverts that may fit you better.',
    why: 'You can decide where your time is best spent before applying.',
  },
  {
    id: 'prepared_applications',
    title: 'Prepare your application or pitch',
    what: 'FJ writes a cover letter and common answers from your own details. It also gives you a checklist.',
    why: 'You spend less time writing the same things again.',
  },
  {
    id: 'advert_check',
    title: 'Check an advert before you apply',
    what: 'Check work on FJ or paste an advert from another place. FJ looks for rules about working from Nigeria, missing details and warning signs in the text.',
    why: 'You can avoid work you cannot take and adverts that ask for money.',
  },
  {
    id: 'smart_shortlist',
    title: 'See your best matches',
    what: 'FJ puts your best current jobs, gigs and contracts in one list and says why each one is there.',
    why: 'You can start with the work that fits you best.',
  },
  {
    id: 'smart_alerts',
    title: 'Telegram alerts with more filters',
    what: 'Choose a minimum match score, country, work setting, pay, companies and words to avoid. The jobs or gigs choice stays free.',
    why: 'You get fewer alerts that do not fit.',
  },
  {
    id: 'application_pipeline',
    title: 'Track your applications',
    what: 'Mark each job or gig as preparing, applied, interview, offer or closed. Add a date to follow up.',
    why: 'You can see what to do next.',
  },
  {
    id: 'skill_plan',
    title: 'See skills to learn',
    what: 'FJ finds skills that appear again and again in work that fits you. It makes a plan for four weeks.',
    why: 'You learn the skills employers and clients ask for most.',
  },
  {
    id: 'interview_prep',
    title: 'Prepare for an interview or client call',
    what: 'Get likely questions, a simple way to answer, questions to ask, and a short checklist.',
    why: 'Your practice is based on the advert.',
  },
  {
    id: 'salary_guide',
    title: 'Check pay from real adverts',
    what: 'See pay ranges only when enough similar adverts state pay. FJ shows how many adverts were used.',
    why: 'You have real adverts to guide a pay talk.',
  },
]

export const PRO_LIMITS = [
  'Applying on the original website is always free.',
  'FJ does not apply or pitch for you.',
  'FJ does not promise an interview, a job, a gig or payment from a client.',
  'FJ does not check or approve employers or clients. Always check them yourself.',
  'FJ saves your CV text only if you agree. You can download or delete it.',
  'FJ will not add work, school, dates, tools, projects or numbers that are not in your details.',
]
