import { defineConfig } from 'vitest/config'
import { cloudflarePool, cloudflareTest } from '@cloudflare/vitest-plugin'

/**
 * Integration tests that run inside the Workers runtime with a real (local)
 * D1 database, so the schema, migrations and query code are exercised the way
 * they run in production.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.test.jsonc' },
      miniflare: { d1Databases: ['DB'] },
    }),
  ],
  test: {
    name: 'worker',
    pool: cloudflarePool({
      wrangler: { configPath: './wrangler.test.jsonc' },
      miniflare: { d1Databases: ['DB'] },
    }),
    include: ['tests/worker/**/*.test.ts'],
  },
})
