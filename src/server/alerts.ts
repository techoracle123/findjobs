import { scoreJob } from '../shared/scoring'
import type { AlertPreference, Job, Profile } from '../shared/types'
import {
  getEntitlements,
  getProfile,
  getSubscription,
  listAlerts,
  listTelegramSubscribers,
} from './auth/accounts'
import { planEntitlements, subscriptionHasFeature } from './billing/types'
import { listOpenJobs } from './jobs'
import { logger } from './logging'
import { getTrialState } from './phase2'
import { publishedPublicJobs } from './public-feed'
import { formatAlertMessage, deliverAlert } from './telegram'
import type { Env } from './env'

export interface AlertSubscriber {
  userId: string
  chatId: number
  alerts: AlertPreference[]
  profile: Profile
  smartAllowed: boolean
}

async function smartAlertsAllowed(db: D1Database, userId: string): Promise<boolean> {
  const [entitlements, subscription, trial] = await Promise.all([
    getEntitlements(db, userId),
    getSubscription(db, userId),
    getTrialState(db, userId),
  ])
  return (
    trial.status === 'active' ||
    entitlements.includes('smart_alerts') ||
    subscriptionHasFeature(
      subscription,
      subscription ? planEntitlements(subscription.plan) : [],
      'smart_alerts',
    )
  )
}

/**
 * Finds the subscribers who should hear about a role.
 *
 * Basic keyword alerts are free. Smart filters are applied only while the
 * account has Pro or an active trial; otherwise the alert safely falls back
 * to its basic keyword query rather than silently stopping.
 */
export async function subscribersFor(db: D1Database): Promise<AlertSubscriber[]> {
  const subscribers = await listTelegramSubscribers(db)
  const result: AlertSubscriber[] = []

  for (const subscriber of subscribers) {
    const [alerts, profile, smartAllowed] = await Promise.all([
      listAlerts(db, subscriber.userId),
      getProfile(db, subscriber.userId),
      smartAlertsAllowed(db, subscriber.userId),
    ])
    const deliverable = alerts.filter(
      (alert) => alert.enabled && alert.channels.includes('telegram'),
    )
    if (deliverable.length === 0) continue
    result.push({ ...subscriber, alerts: deliverable, profile, smartAllowed })
  }

  return result
}

/**
 * Whether a role matches a basic keyword alert. An alert with no query
 * matches everything, which is what somebody who watches “everything” means.
 */
export function jobMatchesAlert(job: Job, query: string): boolean {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean)
  if (terms.length === 0) return true
  const haystack = [
    job.title,
    job.company,
    job.locationLabel ?? '',
    ...(job.requiredSkills ?? []),
    ...(job.usefulSkills ?? []),
  ]
    .join(' ')
    .toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

export function jobMatchesSmartAlert(job: Job, alert: AlertPreference, profile: Profile): boolean {
  if (!jobMatchesAlert(job, alert.query)) return false
  if (alert.kind !== 'smart') return true

  const searchable =
    `${job.title} ${job.company} ${job.locationLabel} ${job.requiredSkills.join(' ')} ${job.usefulSkills.join(' ')} ${job.description}`.toLowerCase()
  const exclusions = (alert.exclude ?? '')
    .split(/[,\n]/)
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean)
  if (exclusions.some((term) => searchable.includes(term))) return false

  if (alert.companies?.length) {
    const company = job.company.toLowerCase()
    if (!alert.companies.some((name) => company.includes(name.trim().toLowerCase()))) return false
  }
  if (alert.countries?.length) {
    const countries = new Set(
      [job.locationCountry, ...(job.eligibleCountries ?? [])].map((code) => code.toUpperCase()),
    )
    if (!alert.countries.some((code) => countries.has(code.toUpperCase()))) return false
  }
  if (alert.workModes?.length && !alert.workModes.includes(job.workMode)) return false
  if (alert.salaryOnly && !(job.salaryMin > 0 || job.salaryMax > 0)) return false
  if (alert.currency && job.salaryCurrency.toUpperCase() !== alert.currency.toUpperCase())
    return false
  if (typeof alert.minScore === 'number' && scoreJob(job, profile).score < alert.minScore)
    return false
  return true
}

async function recentJobs(env: Env, sinceMs: number): Promise<Job[]> {
  const published = await publishedPublicJobs(env.PUBLIC_JOBS).catch(() => null)
  const source = published?.jobs ?? (await listOpenJobs(env.DB)).jobs
  return source
    .filter((job) => {
      const seen = Date.parse(job.firstSeenAt ?? job.postedAt ?? '')
      return job.jobStatus !== 'closed' && !job.isDemo && Number.isFinite(seen) && seen >= sinceMs
    })
    .sort(
      (a, b) => Date.parse(b.firstSeenAt ?? b.postedAt) - Date.parse(a.firstSeenAt ?? a.postedAt),
    )
    .slice(0, 200)
}

/**
 * Delivers alerts for roles that appeared since a given time. Each delivery
 * is recorded so a role is not announced twice for the same alert.
 */
export async function deliverNewAlerts(
  env: Env,
  sinceMs: number = Date.now() - 6 * 60 * 60 * 1000,
): Promise<{ delivered: number; skipped: number }> {
  const db = env.DB
  const botToken = env.TELEGRAM_BOT_TOKEN
  if (!db || !botToken) return { delivered: 0, skipped: 0 }

  const subscribers = await subscribersFor(db)
  if (subscribers.length === 0) return { delivered: 0, skipped: 0 }

  const jobs = await recentJobs(env, sinceMs)
  let delivered = 0
  let skipped = 0

  for (const subscriber of subscribers) {
    for (const alert of subscriber.alerts) {
      for (const job of jobs) {
        const matches = subscriber.smartAllowed
          ? jobMatchesSmartAlert(job, alert, subscriber.profile)
          : jobMatchesAlert(job, alert.query)
        if (!matches) continue

        const already = await db
          .prepare(
            'SELECT 1 AS sent FROM alert_deliveries WHERE alert_id = ?1 AND job_id = ?2 AND channel = ?3',
          )
          .bind(alert.id, job.id, 'telegram')
          .first<{ sent: number }>()
        if (already) {
          skipped += 1
          continue
        }

        const message = formatAlertMessage({
          title: job.title,
          company: job.company,
          locationLabel: job.locationLabel,
          sourceName: job.sourceName,
          sourceUrl: job.sourceUrl,
          salaryMin: job.salaryMin,
          salaryMax: job.salaryMax,
          salaryCurrency: job.salaryCurrency,
        })
        const sent = await deliverAlert(botToken, subscriber.chatId, message)
        if (sent) {
          await db
            .prepare(
              `INSERT INTO alert_deliveries (alert_id, job_id, channel, delivered_at)
               VALUES (?1, ?2, ?3, ?4) ON CONFLICT DO NOTHING`,
            )
            .bind(alert.id, job.id, 'telegram', new Date().toISOString())
            .run()
          delivered += 1
        }
      }
    }
  }

  logger.info('alert delivery complete', { delivered, skipped, subscribers: subscribers.length })
  return { delivered, skipped }
}
