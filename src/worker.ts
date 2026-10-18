/**
 * Entry point for the local Wrangler worker preview (`npm run dev:api`).
 * The deployed Pages Function uses the same Hono app via
 * `functions/api/[[path]].ts`.
 */
import { app } from './server/app'

export default app
