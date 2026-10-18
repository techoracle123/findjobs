/**
 * Cloudflare Pages Function. Serves every /api/* route from the same Hono app
 * the local worker preview uses.
 */
import { app } from '../../src/server/app'
import type { Env } from '../../src/server/env'

interface PagesContext {
  request: Request
  env: Env
  context: ExecutionContext
}

export const onRequest = (ctx: PagesContext) => app.fetch(ctx.request, ctx.env, ctx.context)
