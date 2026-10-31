export interface PlanFeature {
  id: string
  title: string
  what: string
  why: string
}

export const FREE_FEATURES: PlanFeature[] = [
  {
    id: 'search',
    title: 'Search all jobs',
    what: 'Search and open jobs in Nigeria and other countries.',
    why: 'You do not pay to see a public job advert.',
  },
  {
    id: 'apply',
    title: 'Apply free on the company website',
    what: 'Open the company application page as many times as you need.',
    why: 'FJ does not limit your applications.',
  },
  {
    id: 'fit',
    title: 'See why a job fits you',
    what: 'FJ uses your skills and job choices to give each job a score.',
    why: 'You can see which jobs need a closer look.',
  },
  {
    id: 'cv-import',
    title: 'Fill your profile from your CV',
    what: 'Choose a PDF or DOCX. Your device reads it and suggests skills and job types.',
    why: 'This saves typing. The CV is not saved in this step.',
  },
  {
    id: 'track',
    title: 'Save jobs and mark applied jobs',
    what: 'Keep the jobs you want and the jobs you have applied for in one list.',
    why: 'Your list is there when you sign in again.',
  },
  {
    id: 'alerts',
    title: 'Free Telegram alerts',
    what: 'Set a word for a job, skill or company. Get matching new jobs on Telegram.',
    why: 'Basic alerts are free.',
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
    title: 'Compare your CV with a job',
    what: 'FJ compares your saved CV and profile with one job advert.',
    why: 'You can change your CV for that job before you apply.',
  },
  {
    id: 'prepared_applications',
    title: 'Prepare your application',
    what: 'FJ writes a cover letter and common answers from your own details. It also gives you a checklist.',
    why: 'You spend less time writing the same things again.',
  },
  {
    id: 'advert_check',
    title: 'Check a job advert',
    what: 'Check a job on FJ or paste an advert from another place. FJ looks for Nigeria rules and warning signs in the text.',
    why: 'You can avoid jobs you cannot take and jobs that ask for money.',
  },
  {
    id: 'smart_shortlist',
    title: 'See your best matches',
    what: 'FJ puts your best current matches in one list and says why each job is there.',
    why: 'You can start with the jobs that fit you best.',
  },
  {
    id: 'smart_alerts',
    title: 'Telegram alerts with filters',
    what: 'Choose a minimum score, country, work type, pay, companies and words to avoid.',
    why: 'You get fewer jobs that do not fit.',
  },
  {
    id: 'application_pipeline',
    title: 'Track your applications',
    what: 'Mark each job as preparing, applied, interview, offer or closed. Add a date to follow up.',
    why: 'You can see what to do next.',
  },
  {
    id: 'skill_plan',
    title: 'See skills to learn',
    what: 'FJ finds skills that appear again and again in jobs that fit you. It makes a plan for four weeks.',
    why: 'You learn the skills employers ask for most.',
  },
  {
    id: 'interview_prep',
    title: 'Prepare for an interview',
    what: 'Get likely questions, a simple way to answer, questions to ask, and a short checklist.',
    why: 'Your practice is based on the job advert.',
  },
  {
    id: 'salary_guide',
    title: 'Check pay from real adverts',
    what: 'See pay ranges only when enough similar adverts state pay. FJ shows how many adverts were used.',
    why: 'You have real adverts to guide a pay talk.',
  },
]

export const PRO_LIMITS = [
  'Applying on the company website is always free.',
  'FJ does not apply for you.',
  'FJ does not promise an interview or a job.',
  'FJ does not check or approve employers. Always check the company yourself.',
  'FJ saves your CV text only if you agree. You can download or delete it.',
  'FJ will not add work, school, dates, tools, projects or numbers that are not in your details.',
]
