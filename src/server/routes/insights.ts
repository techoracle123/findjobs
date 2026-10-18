import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { franc } from 'franc-min'
import type { AppEnv } from '../env'
import type { ApplicationTip, Job, JobAdvice, JobTranslation } from '../../shared/types'
import { findPublishedJob } from '../public-feed'
import { findJob } from '../jobs'
import { livePublicEnabled, livePublicJobs } from '../live-public'
import { cleanJobText } from '../sources/html'
import { openRouterJson } from '../openrouter'
import { readConfig } from '../config'
import { takeAiBudget } from '../aiquota'
import { enforceRateLimit, rateLimitSubject } from '../ratelimit'
import { stringList, type AppContext } from '../http'

export const insightRoutes = new Hono<AppEnv>()
insightRoutes.use(
  '/jobs/:id/*',
  bodyLimit({ maxSize: 8000, onError: (c) => c.json({ error: 'request_too_large' }, 413) }),
)

export function detectLanguage(text: string): string {
  return franc(text.slice(0, 5000), { minLength: 60 })
}

async function hash(text: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function availableJob(c: AppContext): Promise<Job | null> {
  const published = await findPublishedJob(c.env?.PUBLIC_JOBS, c.req.param('id') || '')
  if (published) return published
  try {
    const job = await findJob(c.env?.DB, c.req.param('id') || '')
    if (job) return job
  } catch (error) {
    if (!livePublicEnabled(c.env?.APP_MODE)) throw error
  }
  return livePublicEnabled(c.env?.APP_MODE)
    ? (await livePublicJobs(new URL(c.req.url).origin)).find(
        (job) => job.id === c.req.param('id'),
      ) || null
    : null
}

async function budget(c: AppContext): Promise<boolean> {
  if (!c.env?.DB || !c.env.OPENROUTER_API_KEY) return false
  try {
    return (await takeAiBudget(c.env.DB, `insights:${rateLimitSubject(c)}`, readConfig(c.env)))
      .allowed
  } catch {
    return false
  }
}

export function fallbackTips(job: Job, skills: string[] = []): ApplicationTip[] {
  const mentioned = [...new Set([...job.requiredSkills, ...job.usefulSkills])].slice(0, 3)
  const shared = mentioned.filter((skill) =>
    skills.some((item) => item.toLowerCase() === skill.toLowerCase()),
  )
  return [
    {
      title: `Make your case for ${job.title}`,
      text: mentioned.length
        ? `The listing mentions ${mentioned.join(', ')}. Use a concrete example of your work with ${shared[0] || mentioned[0]}, with a result you can honestly support.`
        : `Choose a past task most relevant to the ${job.title} responsibilities at ${job.company || 'this employer'}. Explain what you did and the outcome, instead of copying the job description.`,
    },
    {
      title: 'Prepare a relevant example',
      text:
        job.roleFamily === 'healthcare'
          ? 'Prepare an anonymised example of safe patient care or a clinical task relevant to this role. Never include identifiable patient information; check the original listing for registration requirements.'
          : job.roleFamily === 'sales'
            ? `Prepare a short example of how you handled a prospect, customer objection or sales target relevant to ${job.company || 'this employer'}. Only use results you actually achieved.`
            : job.roleFamily === 'education'
              ? 'Pick a lesson or learning activity relevant to this subject or age group. Describe how you assessed understanding and adapted your teaching.'
              : `Select one project or work example that demonstrates the main responsibilities in this listing. Remove confidential information before sharing it with ${job.company || 'the employer'}.`,
    },
    {
      title: 'Plan the practical details',
      text:
        job.workMode === 'remote'
          ? `Check the original listing’s permitted countries, time zones and working hours before tailoring your application. “Remote” alone does not establish eligibility for ${job.locationLabel}.`
          : `Check the stated work location (${job.locationLabel}), application method and deadline in the original listing before you send your application.`,
    },
  ]
}

export function validatedTips(input: unknown): ApplicationTip[] {
  if (!Array.isArray(input)) throw new Error('Invalid tips')
  const tips = input.slice(0, 4).flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return []
    const tip = item as Record<string, unknown>
    if (typeof tip.title !== 'string' || typeof tip.text !== 'string') return []
    const title = cleanJobText(tip.title).slice(0, 100)
    const text = cleanJobText(tip.text).slice(0, 700)
    if (!title || !text || /https?:\/\/|guaranteed (?:job|offer)|pay.*(?:fee|deposit)/i.test(text))
      return []
    return [{ title, text }]
  })
  if (tips.length < 2) throw new Error('Invalid tips')
  return tips
}

insightRoutes.post('/jobs/:id/translation', async (c) => {
  const job = await availableJob(c)
  if (!job) return c.json({ error: 'not_found' }, 404)
  const description = cleanJobText(job.description)
  const originalLanguage = detectLanguage(description)
  const original: JobTranslation = {
    description,
    originalLanguage,
    translated: false,
    available: true,
  }
  if (!description || originalLanguage === 'eng') return c.json(original)
  const db = c.env?.DB
  const cacheKey = await hash(
    `translation-v1:${c.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini'}:${description}`,
  )
  const cached = await db
    ?.prepare('SELECT english_text FROM job_translations WHERE job_id = ?1 AND content_hash = ?2')
    .bind(job.id, cacheKey)
    .first<{ english_text: string | null }>()
    .catch(() => null)
  if (cached?.english_text)
    return c.json({
      ...original,
      description: cached.english_text,
      translated: cached.english_text !== description,
    })
  const unavailable = (message: string) => c.json({ ...original, available: false, message })
  if (!c.env.OPENROUTER_API_KEY || !db)
    return unavailable(
      'English translation is not configured yet. This is the original description.',
    )
  try {
    const limited = await enforceRateLimit(c, {
      bucket: 'translation',
      limit: 30,
      windowSeconds: 60,
    })
    if (limited) return limited
  } catch {
    return unavailable(
      'English translation is temporarily unavailable. This is the original description.',
    )
  }
  // A database lease prevents simultaneous page views paying for the same translation.
  const owner = crypto.randomUUID()
  const lease = await db
    .prepare(
      `INSERT INTO job_translations (job_id, content_hash, lease_owner, lease_until) VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT(job_id) DO UPDATE SET content_hash = ?2, english_text = NULL, lease_owner = ?3, lease_until = ?4
    WHERE content_hash != ?2 OR (english_text IS NULL AND lease_until < ?5)`,
    )
    .bind(job.id, cacheKey, owner, Date.now() + 35000, Date.now())
    .run()
    .catch(() => null)
  if (!lease)
    return unavailable(
      'English translation is temporarily unavailable. This is the original description.',
    )
  if (!(lease.meta.changes ?? 0))
    return unavailable('English translation is being prepared. Try again shortly.')
  try {
    if (!(await budget(c)))
      return unavailable(
        'The daily translation allowance has been reached. This is the original description.',
      )
    const result = await openRouterJson(
      c.env,
      'Translate this complete job description into clear English. Preserve every factual requirement, number, salary, deadline and paragraph. If it is already English, return it unchanged. Do not add commentary, advertisements, a summary or application tips. Return {"description":"complete English plain text"}.',
      { description: description.slice(0, 16000) },
      6500,
    )
    if (
      typeof result.description !== 'string' ||
      result.description.trim().length < Math.min(60, description.length)
    )
      throw new Error('Invalid translation')
    const translated = cleanJobText(result.description).slice(0, 30000)
    if (translated.length > 150 && detectLanguage(translated) !== 'eng')
      throw new Error('Translation is not English')
    await db
      .prepare(
        'UPDATE job_translations SET english_text = ?1 WHERE job_id = ?2 AND content_hash = ?3 AND lease_owner = ?4',
      )
      .bind(translated, job.id, cacheKey, owner)
      .run()
    return c.json({ ...original, description: translated, translated: translated !== description })
  } catch {
    return unavailable(
      'English translation is temporarily unavailable. This is the original description.',
    )
  } finally {
    await db
      .prepare(
        'DELETE FROM job_translations WHERE job_id = ?1 AND lease_owner = ?2 AND english_text IS NULL',
      )
      .bind(job.id, owner)
      .run()
  }
})

insightRoutes.post('/jobs/:id/tips', async (c) => {
  let storageDown = false
  try {
    const limited = await enforceRateLimit(c, { bucket: 'job-tips', limit: 10, windowSeconds: 60 })
    if (limited) return limited
  } catch {
    storageDown = true
  }
  const job = await availableJob(c)
  if (!job) return c.json({ error: 'not_found' }, 404)
  const body = (await c.req.json().catch(() => ({}))) as { skills?: unknown }
  const skills = stringList(body.skills, 30).map((skill) => cleanJobText(skill).slice(0, 80))
  const fallback: JobAdvice = { tips: fallbackTips(job, skills), provider: 'listing-based' }
  const db = c.env?.DB
  if (storageDown)
    return c.json({
      ...fallback,
      message:
        'These pointers are based on the listing while account syncing is temporarily unavailable.',
    })
  if (!db || !c.env.OPENROUTER_API_KEY)
    return c.json({
      ...fallback,
      message: 'AI advice is not configured yet. These pointers are based on the listing.',
    })
  const cacheKey = await hash(
    JSON.stringify([
      'tips-v1',
      c.env.OPENROUTER_MODEL,
      job.id,
      job.description,
      [...skills].sort(),
    ]),
  )
  const cached = await db
    .prepare(
      "SELECT tips FROM job_advice_cache WHERE cache_key = ?1 AND created_at >= datetime('now', '-7 days')",
    )
    .bind(cacheKey)
    .first<{ tips: string }>()
    .catch(() => null)
  if (cached)
    return c.json({ tips: JSON.parse(cached.tips), provider: 'openrouter' } satisfies JobAdvice)
  if (!(await budget(c)))
    return c.json({
      ...fallback,
      message: 'The daily AI allowance has been reached. These pointers are based on the listing.',
    })
  try {
    const result = await openRouterJson(
      c.env,
      'Write 3 or 4 specific, practical application tips for this job and the supplied skills. Write in English. Use distinct actions and evidence from this listing, not generic repeated advice. Suggest honest CV tailoring, a relevant work example and preparation. If a qualification is not stated, do not call it required. Do not infer eligibility, promise success, fabricate achievements, invent contacts or application instructions, or recommend fees. Return {"tips":[{"title":"short heading","text":"one or two sentences"}]}.',
      {
        title: job.title,
        company: job.company,
        description: job.description.slice(0, 12000),
        skills,
      },
      1400,
    )
    const tips = validatedTips(result.tips)
    await db
      .prepare('INSERT OR REPLACE INTO job_advice_cache (cache_key, tips) VALUES (?1, ?2)')
      .bind(cacheKey, JSON.stringify(tips))
      .run()
    await db
      .prepare("DELETE FROM job_advice_cache WHERE created_at < datetime('now', '-7 days')")
      .run()
    return c.json({ tips, provider: 'openrouter' } satisfies JobAdvice)
  } catch {
    return c.json({
      ...fallback,
      message: 'AI advice is temporarily unavailable. These pointers are based on the listing.',
    })
  }
})
