import { createHmac } from 'node:crypto'

export function annotation(level, title, message) {
  const safe = String(message)
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A')
  console.log(`::${level} title=${title}::${safe}`)
}

/** Sign-in is FJ's own email-code flow now. Remove the legacy Cloudflare
 * Access application (it intercepted /api/auth/login with a Cloudflare
 * screen) so no Cloudflare page ever appears in the sign-in journey. */
export async function removeAccess(api, project, hostname = `${project}.pages.dev`) {
  const domain = `${hostname}/api/auth/login`
  const apps = (await api('/access/apps', { optional: true }))?.result ?? []
  const app = apps.find((item) => item.domain === domain)
  if (!app) return { removed: false }
  await api(`/access/apps/${app.id}`, { method: 'DELETE' })
  return { removed: true }
}

export async function telegramSetup(
  token,
  project,
  fetcher = fetch,
  hostname = `${project}.pages.dev`,
) {
  if (!token) return null
  const invoke = async (method, body = {}) => {
    let response
    try {
      response = await fetcher(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      })
    } catch {
      throw new Error(`Telegram ${method} could not be reached.`)
    }
    const data = await response.json()
    if (!response.ok || !data.ok)
      throw new Error(
        `Telegram ${method} failed (HTTP ${response.status}). Check the encrypted bot token.`,
      )
    return data.result
  }
  const me = await invoke('getMe')
  if (!me?.username) throw new Error('Telegram bot has no username.')
  const secret = createHmac('sha256', token).update(`find-jobs:webhook:${project}`).digest('hex')
  return {
    username: me.username,
    secret,
    async register() {
      const url = `https://${hostname}/api/telegram/webhook`
      await invoke('setWebhook', { url, secret_token: secret, allowed_updates: ['message'] })
      const info = await invoke('getWebhookInfo')
      if (info.url !== url) throw new Error('Telegram webhook URL was not saved.')
      return { pending: info.pending_update_count ?? 0 }
    },
  }
}

export async function pageSecrets(api, project, secrets) {
  if (!Object.keys(secrets).length) return
  const existing = (await api(`/pages/projects/${project}`)).result
  const environments = {}
  for (const mode of ['production', 'preview']) {
    const vars = existing.deployment_configs?.[mode]?.env_vars ?? {}
    // Preserve unrelated variables; write credentials only as encrypted values.
    environments[mode] = {
      env_vars: {
        ...vars,
        ...Object.fromEntries(
          Object.entries(secrets).map(([name, value]) => [name, { type: 'secret_text', value }]),
        ),
      },
    }
  }
  await api(`/pages/projects/${project}`, {
    method: 'PATCH',
    body: { deployment_configs: environments },
  })
}

export async function workerSecrets(api, worker, secrets) {
  for (const [name, text] of Object.entries(secrets)) {
    await api(`/workers/scripts/${worker}/secrets`, {
      method: 'PUT',
      body: { name, type: 'secret_text', text },
    })
  }
}

/** A hostname is only confirmed after Cloudflare assigns it. Reserve two
 * alternatives without moving the existing app or changing its login domain. */
export async function reservePageNames(api) {
  const names = ['fj-find-jobs', 'find-jobs-fj']
  const results = []
  for (const name of names) {
    let project = (await api(`/pages/projects/${name}`, { optional: true }))?.result
    if (!project)
      project = (
        await api('/pages/projects', {
          method: 'POST',
          body: { name, production_branch: 'arena/be298902-findjobs' },
        })
      ).result
    if (!project?.subdomain) throw new Error('Cloudflare did not return an alternative hostname.')
    results.push({
      requested: `${name}.pages.dev`,
      assigned: project.subdomain,
      exact: project.subdomain === `${name}.pages.dev`,
    })
  }
  return results
}
