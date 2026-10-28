import { describe, expect, it, vi } from 'vitest'
import producerConfig from '../../wrangler.ingest.jsonc?raw'
import consumerConfig from '../../wrangler.ingest-consumer.jsonc?raw'
// @ts-expect-error Node deployment scripts are deliberately plain JavaScript.
import * as deployment from '../../scripts/deploy-cloudflare.mjs'

const { client, credentials, deploymentConfig, findResource, provision } = deployment

const account = 'a'.repeat(32)

describe('Cloudflare deployment automation', () => {
  it('requires encrypted credentials and validates the account without echoing secrets', () => {
    expect(() => credentials({})).toThrow('GitHub Settings')
    expect(() =>
      credentials({ CLOUDFLARE_API_TOKEN: 'private', CLOUDFLARE_ACCOUNT_ID: 'invalid' }),
    ).toThrow('32 hexadecimal')
    expect(
      credentials({ CLOUDFLARE_API_TOKEN: ' private ', CLOUDFLARE_ACCOUNT_ID: account }),
    ).toEqual({ token: 'private', account })
  })

  it('uses bearer authorization and sanitises API failures', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ success: false, errors: [{ code: 10000, message: 'private' }] }),
          { status: 403 },
        ),
      )
    await expect(client({ token: 'private', account }, fetcher)('/d1/database')).rejects.toThrow(
      'HTTP 403; codes: 10000',
    )
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer private')
    await expect(
      client({ token: 'private', account }, fetcher)('/d1/database'),
    ).rejects.not.toThrow('private')
  })

  it('treats only an explicitly optional 404 as absent', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 404 }))
    await expect(
      client({ token: 'private', account }, fetcher)('/pages/projects/example', { optional: true }),
    ).resolves.toBeNull()
    await expect(
      client({ token: 'private', account }, fetcher)('/pages/projects/example'),
    ).rejects.toThrow('HTTP 404')
  })

  it('paginates existing resources rather than creating duplicates', async () => {
    const api = vi
      .fn()
      .mockResolvedValueOnce({
        result: Array.from({ length: 50 }, (_, i) => ({ name: String(i) })),
        result_info: { total_pages: 2 },
      })
      .mockResolvedValueOnce({ result: [{ name: 'rolesignal' }] })
    await expect(
      findResource(api, '/d1/database', (db: { name: string }) => db.name === 'rolesignal'),
    ).resolves.toEqual({ name: 'rolesignal' })
    expect(api).toHaveBeenLastCalledWith('/d1/database?page=2&per_page=50')
  })

  it('creates missing infrastructure', async () => {
    const api = vi
      .fn()
      .mockResolvedValueOnce({ result: [] })
      .mockResolvedValueOnce({ result: { uuid: 'database-id' } })
      .mockResolvedValueOnce({ result: [] })
      .mockResolvedValueOnce({ result: { queue_id: 'queue-id' } })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ result: { production_branch: 'arena/be298902-findjobs' } })
    await expect(provision(api, 'role-signal')).resolves.toEqual({
      databaseId: 'database-id',
      productionBranch: 'arena/be298902-findjobs',
    })
    expect(api).toHaveBeenCalledWith('/d1/database', {
      method: 'POST',
      body: { name: 'rolesignal' },
    })
    expect(api).toHaveBeenCalledWith('/queues', {
      method: 'POST',
      body: { queue_name: 'rolesignal-ingest' },
    })
    expect(api).toHaveBeenCalledWith('/pages/projects', {
      method: 'POST',
      body: { name: 'role-signal', production_branch: 'arena/be298902-findjobs' },
    })
  })

  it('reuses existing resources and preserves an existing Pages production branch', async () => {
    const api = vi
      .fn()
      .mockResolvedValueOnce({ result: [{ name: 'rolesignal', uuid: 'existing-id' }] })
      .mockResolvedValueOnce({ result: [{ queue_name: 'rolesignal-ingest' }] })
      .mockResolvedValueOnce({ result: { production_branch: 'existing-production' } })
    await expect(provision(api, 'role-signal')).resolves.toEqual({
      databaseId: 'existing-id',
      productionBranch: 'existing-production',
    })
    expect(api).toHaveBeenCalledTimes(3)
  })

  it('does not replace permission failures with resource creation', async () => {
    const api = vi.fn().mockRejectedValue(new Error('HTTP 403'))
    await expect(provision(api, 'role-signal')).rejects.toThrow('HTTP 403')
    expect(api).toHaveBeenCalledTimes(1)
  })

  it('parses JSONC, preserves bindings, and enforces safe production', () => {
    const config = JSON.parse(
      deploymentConfig(
        `{
      // Original deployment config
      "d1_databases": [{"binding":"DB","database_id":"placeholder",}, {"binding":"OTHER","database_id":"keep"}],
      "vars": {"BILLING_PRICE_PRO":"5000", "APP_MODE":"preview",},
      "queues": {"producers": [{"binding":"INGEST_QUEUE","queue":"rolesignal-ingest"}]},
    }`,
        'wrangler.jsonc',
        'real-id',
      ),
    )
    expect(config.d1_databases[0].database_id).toBe('real-id')
    expect(config.d1_databases[1].database_id).toBe('keep')
    expect(config.vars).toEqual({
      BILLING_PRICE_PRO: '5000',
      APP_MODE: 'production',
      BILLING_PROVIDER: 'fake',
    })
    expect(config.queues.producers[0].binding).toBe('INGEST_QUEUE')
  })

  it('rejects broken configs before deploying', () => {
    expect(() => deploymentConfig('{broken', 'wrangler.jsonc', 'id')).toThrow('Cannot parse')
    expect(() => deploymentConfig('{}', 'wrangler.jsonc', 'id')).toThrow('Missing DB binding')
  })
})

describe('ingestion deployment configuration', () => {
  it('deploys a producer without a consumer binding and a separate consumer', () => {
    const producer = JSON.parse(deploymentConfig(producerConfig, 'wrangler.ingest.jsonc', 'db'))
    const consumer = JSON.parse(
      deploymentConfig(consumerConfig, 'wrangler.ingest-consumer.jsonc', 'db'),
    )
    expect(producer.queues.consumers).toBeUndefined()
    expect(producer.queues.producers[0].queue).toBe(consumer.queues.consumers[0].queue)
    expect(consumer.main).toBe('src/ingest-consumer.ts')
    expect(producer.workers_dev).toBe(false)
    expect(consumer.workers_dev).toBe(false)
    expect(producer.preview_urls).toBe(false)
    expect(consumer.preview_urls).toBe(false)
  })
})

it('registers public sources without changing operator enablement or rewriting unchanged metadata', async () => {
  const { sourceRegistrySql } = deployment
  const sql = sourceRegistrySql([
    {
      id: 'board',
      name: "Employer's board",
      parser: 'greenhouse',
      kind: 'ats',
      listingUrl: 'https://boards-api.greenhouse.io/v1/boards/example/jobs',
      enabled: true,
      tier: 'daily',
      rateLimitPerHour: 2,
      country: 'NG',
      tags: ['public'],
    },
  ])
  expect(sql).toContain("Employer''s board")
  expect(sql).toContain('ON CONFLICT(id) DO UPDATE')
  expect(sql).toContain('IS NOT excluded.')
  expect(sql).not.toContain('enabled=excluded.enabled')
})

it('binds durable public storage to Pages and configures the tiered database-independent cron', () => {
  const config = JSON.parse(
    deploymentConfig(producerConfig, 'wrangler.ingest.jsonc', 'db', {}, 'public-namespace'),
  )
  expect(config.kv_namespaces).toEqual([{ binding: 'PUBLIC_JOBS', id: 'public-namespace' }])
  // Hourly trigger; dueForRun holds ATS hourly, feeds 6-hourly, daily 24-hourly.
  expect(config.triggers.crons).toEqual(['0 * * * *'])
  expect(config.vars.PUBLIC_FEED_ONLY).toBe('1')
})
