import type { Job } from '../shared/types'
import { listAlerts, listTelegramSubscribers } from './auth/accounts'
import { formatAlertMessage, deliverAlert } from './telegram'
import { logger } from './logging'
import type { Env } from './env'

export interface AlertSubscriber {
  userId: string
  chatId: number
  alerts: { id: string; label: string; query: string; channels: string[]; enabled: boolean }[]
}

/**
 * Finds the subscribers who should hear about a role.
 *
 * A subscriber needs three things: a linked Telegram chat, an enabled
 * alert, and the entitlement to receive alerts. Anything missing means the
 * alert is not delivered, and the reason is not guessed at.
 */
export async function subscribersFor(db: D1Database): Promise<AlertSubscriber[]> {
  const subscribers = await listTelegramSubscribers(db)
  const result: AlertSubscriber[] = []

  for (const subscriber of subscribers) {
    const alerts = await listAlerts(db, subscriber.userId)
    const deliverable = alerts.filter(
      (alert) => alert.enabled && alert.channels.includes('telegram'),
    )
    if (deliverable.length === 0) continue

    result.push({ ...subscriber, alerts: deliverable })
  }

  return result
}

/**
 * Whether a role matches an alert. An alert with no query matches
 * everything, which is what somebody who watches "everything" means.
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

/**
 * Delivers alerts for the roles that have appeared since a given time.
 *
 * Each delivery is recorded, so a role is not announced twice, and a role
 * that closed and reopened is announced again because that is news.
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

  const since = new Date(sinceMs).toISOString()
  const rows = await db
    .prepare(
      `SELECT id, title, company, location_label, source_name, source_url, salary_min, salary_max,
        salary_currency FROM jobs
       WHERE first_seen_at >= ?1 AND job_status = 'open' AND is_demo = 0
       ORDER BY first_seen_at DESC LIMIT 200`,
    )
    .bind(since)
    .all<{
      id: string
      title: string
      company: string
      location_label: string
      source_name: string
      source_url: string
      salary_min: number
      salary_max: number
      salary_currency: string
    }>()

  const jobs = rows.results ?? []
  let delivered = 0
  let skipped = 0

  for (const subscriber of subscribers) {
    for (const alert of subscriber.alerts) {
      for (const job of jobs) {
        if (
          !jobMatchesAlert(
            { ...job, locationLabel: job.location_label } as unknown as Job,
            alert.query,
          )
        )
          continue

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
          locationLabel: job.location_label,
          sourceName: job.source_name,
          sourceUrl: job.source_url,
          salaryMin: job.salary_min,
          salaryMax: job.salary_max,
          salaryCurrency: job.salary_currency,
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
