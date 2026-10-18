# Role Signal

A skill-first global tech-job opportunity desk. The interface is a dense results list rather than a marketing template: compact job results, eligibility context, an explainable skill-fit score, and clear source and freshness labels on every row.

## Current status

This is a **working application, not yet a paid public service**. The account, ingestion, billing and alerting pipelines are implemented and tested, but the pieces that need a real account with a real provider — Cloudflare Access, a payment provider, a Telegram bot, live job sources — are not connected in this repository. The UI says so plainly instead of pretending.

The eight bundled job records and their salaries are fictional, clearly labelled preview data. They exist so the ranking, scoring and eligibility logic have something to work against.

The default ranking is eligibility-first (eligible overlap, unknown, then restricted), followed by an explainable 0–100 match score and recency. The score weights required skills (48%), useful skills (14%), role family (18%), seniority (10%) and work mode (10%); missing details are neutral, and eligibility is separate. The work-eligibility picker searches every ISO alpha-2 region except Antarctica. Salary conversion uses dated reference rates; salary sorting never annualises different pay periods.

## What is implemented

**Opportunity desk**

- Dense results list with a score badge, eligibility verdict, pay period, freshness and source on every row, and a detail panel that explains exactly how the score was reached.
- Eligibility-first ranking: eligible roles outrank unknown ones, which outrank restricted ones, regardless of score. The reasoning is shown, never hidden.
- Explainable 0–100 score across five weighted components, each showing the weight it carries and what it earned. Components that cannot be compared are excluded from the total rather than counted as failures, so a sparse posting is not penalised for being sparse.
- Work-eligibility picker covering every ISO 3166-1 alpha-2 region except Antarctica. The list is **generated** from `i18n-iso-countries` (`npm run data:generate`), never hand-maintained.
- Profile and skill signal with forgiving matching: `node.js`, `NodeJS` and `node` are one skill; `TS` is `TypeScript`.
- CV import for PDF, DOCX and TXT, parsed in the browser. Only the extracted text is sent for suggestions — the file is never uploaded or stored.
- Salary conversion into a chosen display currency using dated reference rates, with the rate date shown. Currencies with no rate keep the employer's original currency. Pay periods are never annualised and mixed results say so.

**Accounts (Cloudflare Access)**

- Identity comes from Cloudflare Access. The `Cf-Access-Jwt-Assertion` token is **cryptographically verified** against the team's published JWKS, with issuer and audience checked. The `Cf-Access-Authenticated-User-Email` header is never trusted on its own — it can be forged by anyone who can reach the Worker.
- Public browsing stays anonymous. Only `/api/account/*`, `/api/billing/*` and `/api/telegram/*` require an identity.
- Accounts, profiles, saved roles, applications, alert preferences, subscriptions, entitlements, consents and an audit log live in D1.
- The browser keeps a local copy of everything, so the interface is instant and works with no account. On sign-in the server becomes the source of truth and the browser's data can be imported rather than lost.

**Ingestion**

- A source-adapter interface with two real adapters (Arbeitnow and Remotive, both key-free public APIs) behind it.
- One normalisation path for every source: role family, seniority, work mode, country, skills and salary are derived once, in one place.
- Postings are upserted by content hash, so a re-run is idempotent, a changed posting is updated, and a posting the source has dropped is retired rather than left to rot.
- Each run is logged with its counts, and a failing source records its error against itself instead of taking the others down.
- Recorded API fixtures drive the tests, so the pipeline is exercised end to end without touching the network.

**Billing**

- A payment-provider interface with a Stripe implementation (checkout, customer portal, webhook signature verification) and a local fake provider for development.
- Entitlements are always derived server-side from the subscription row. The client is never trusted to grant itself a feature.
- Webhooks are verified by HMAC over `timestamp.payload` with a replay window, and applied idempotently.

**Alerts**

- Telegram account linking through a signed, short-lived deep-link token. A link cannot be minted for somebody else's account.
- The bot's webhook is checked against Telegram's secret token before the update is read.

**Operations**

- Continuous integration: type check, lint, format check, unit tests, worker integration tests against a real local D1, build, dependency audit, and a check that generated data matches its source.
- Structured single-line JSON logging with a request id on every request.
- D1-backed rate limiting on the expensive endpoints, in particular the AI-backed CV suggestion route.

## Architecture

- React + TypeScript/Vite frontend, deployable to Cloudflare Pages.
- Hono API used by both the Cloudflare Pages Function (`functions/api/[[path]].ts`) and the local Wrangler Worker preview (`src/worker.ts`). One app, two entry points.
- Cloudflare D1 for postings, accounts and everything else.
- Cloudflare Workers AI for CV suggestions. The local preview deliberately binds no AI and makes no remote model calls, using a clearly labelled deterministic keyword fallback instead.
- A separate scheduled Worker (`src/ingest.ts`, `wrangler.ingest.jsonc`) for ingestion. Cloudflare Pages does not support cron triggers, so ingestion is a second Worker pointing at the same database; the same pipeline can also be triggered on demand through the API.

`src/shared/` is imported by both the browser bundle and the Worker, so the score the user sees and the score the API returns are computed by the same code.

```
src/
  shared/      types, country list, skill matching, scoring, formatting
  server/      Hono app, D1 access, auth, sources, billing, Telegram, rate limits
  lib/         client API client, browser storage, CV parsers, ranking
  components/  React components
  hooks/       account state and write-through synchronisation
functions/api/ Cloudflare Pages Function entry
migrations/    D1 schema, demo seed, accounts, sources, rate limits
scripts/       seed generator, country generator, smoke test
tests/
  unit/        pure domain logic, plain Node
  worker/      integration, inside the Workers runtime against a real D1
  fixtures/    recorded source API responses
```

## Run it locally

1. Install Node.js 20.19+ (CI uses 22.23.3).
2. `npm install`.
3. `npm run db:migrate:local` — creates the schema and seeds the fictional preview roles.
4. `npm run dev:api` — the local Worker on port 8787.
5. In another terminal, `npm run dev` — the web interface.
6. Open the Vite URL it prints.

The Vite server proxies `/api` to the local Worker. In local preview the API serves the local D1 rows and uses the deterministic CV keyword fallback; it calls neither Workers AI nor Telegram.

For a built Cloudflare Pages-style preview: `npm run build` then `npm run preview:pages`. The standard `wrangler.jsonc` is the Pages configuration — the placeholder D1 database ID must be replaced with a real one before deploying.

## Accounts in local preview

Local preview and test runs accept an `x-dev-user-email` header in place of a Cloudflare Access identity, so the account flows can be exercised without an Access application:

```sh
curl -H 'x-dev-user-email: person@example.com' http://localhost:8787/api/account
```

**This bypass is refused when `APP_MODE` is `production`.** In production an identity must come from a verified Access token or the request is anonymous.

## API reference

| Route                                       | Purpose                                                |
| ------------------------------------------- | ------------------------------------------------------ |
| `GET /api/health`                           | Mode, bindings, data source, rate vintage, sign-in URL |
| `GET /api/jobs`                             | All live postings                                      |
| `GET /api/jobs/:id`                         | A single posting                                       |
| `POST /api/score`                           | Scores postings against a supplied profile             |
| `POST /api/cv/suggest`                      | Profile suggestions from extracted CV text             |
| `GET /api/rates`                            | Reference rates, their date and their source           |
| `GET /api/account`                          | The signed-in account, profile, saved roles and alerts |
| `PUT /api/account/profile`                  | Saves the profile                                      |
| `GET/POST/DELETE /api/account/saved`        | Saved roles and applications                           |
| `GET/POST/PATCH/DELETE /api/account/alerts` | Alert preferences                                      |
| `POST /api/account/import`                  | Imports data the browser was keeping locally           |
| `DELETE /api/account`                       | Deletes the account and everything attached to it      |
| `GET /api/sources`                          | Configured sources and their last run                  |
| `POST /api/sources/ingest`                  | Runs every enabled source now                          |
| `GET /api/billing/plans`                    | Available plans                                        |
| `GET /api/billing/subscription`             | Current subscription and entitlements                  |
| `POST /api/billing/checkout`                | Starts a checkout                                      |
| `POST /api/billing/portal`                  | Opens the provider's customer portal                   |
| `POST /api/billing/webhook`                 | The provider's webhook (signature verified)            |
| `GET /api/telegram/status`                  | Whether this account has linked a chat                 |
| `POST /api/telegram/link`                   | Returns a signed deep link to link Telegram            |
| `POST /api/telegram/webhook`                | The bot's webhook (secret token verified)              |

## Configuration

Set these as Pages environment variables, or as Wrangler secrets where the value is sensitive.

| Variable                  | Purpose                                        |
| ------------------------- | ---------------------------------------------- |
| `APP_MODE`                | `production` enables the strict identity rules |
| `ACCESS_TEAM_DOMAIN`      | Your Cloudflare Access team domain             |
| `ACCESS_AUD`              | The Access application AUD tag                 |
| `STRIPE_SECRET_KEY`       | Stripe secret key                              |
| `STRIPE_WEBHOOK_SECRET`   | Stripe webhook signing secret                  |
| `STRIPE_PRICE_PRO`        | Stripe price id for the paid plan              |
| `TELEGRAM_BOT_TOKEN`      | Telegram bot token                             |
| `TELEGRAM_BOT_USERNAME`   | Bot handle, used to build the deep link        |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram webhook secret token                  |

Access protects _paths_, so create an Access application that covers `/api/account/*`, `/api/billing/*` and `/api/telegram/*`. Public job browsing stays anonymous.

## Validate before handoff

```sh
npm run check          # type check
npm run lint           # eslint
npm run format:check   # prettier
npm run test           # unit + worker integration tests
npm run build          # production build
npm run test:smoke     # browser smoke test (needs the API running on 8787)
npm audit --audit-level=high
```

`npm run test:smoke` builds the app as a single bundle, runs it in jsdom against the local API worker, and asserts that the desk renders, ranks, scores and explains itself.

## Deployment

These steps publish a **staging preview only**, and they need your own authenticated Cloudflare account. Do not put API tokens or bot/payment secrets in this repository or in chat.

1. Create a D1 database named `rolesignal` and replace the placeholder `database_id` in `wrangler.jsonc` with the returned ID.
2. Apply the schema:

   ```sh
   ./node_modules/node/bin/node ./node_modules/wrangler/bin/wrangler.js d1 migrations apply rolesignal --remote
   ```

3. Set the Pages build command to `npm run build`, the output directory to `dist`, and `NODE_VERSION` to `22.23.3`.
4. Bind D1 as `DB`. Bind Workers AI as `AI` only after you have verified free-only billing behaviour; inference failures fall back to deterministic extraction, and that fallback is not a usage or spend cap.
5. Create the Cloudflare Access application covering the account, billing and Telegram paths, and set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`.
6. Deploy the scheduled ingestion worker from `wrangler.ingest.jsonc` with the same D1 binding, and point it at the same database id.
7. Deploy the Pages project.

```sh
./node_modules/node/bin/node ./node_modules/wrangler/bin/wrangler.js pages deploy dist --project-name role-signal
```

## Not ready for a paid public launch

The code for these exists; what is missing is the real account and real provider behind them.

- **A Cloudflare Access application** in your own account, with the paths above protected and the AUD set.
- **A Stripe account** with a live price, plus the real refund and cancellation rules, and a decision about what happens when a webhook is missed.
- **A Telegram bot** with its token as a Cloudflare secret, and a decision about what the bot may send and how often.
- **Live job sources.** The two adapters are real, but the terms of each source, its rate limit and its attribution requirements have to be checked before the feed is presented as live. The feed currently mixes fictional demo rows with whatever ingestion has fetched, and the interface says which is which.
- **A currency feed that covers the currencies people are paid in.** Frankfurter is ECB-based, so NGN, AED, KES, GHS and SAR cannot be converted with it. Roles paid in those currencies keep the employer's original figure, which is honest but less useful.
- **OCR for scanned CVs.** Text-based PDFs and DOCX files are handled; a scanned image is not.
- **Privacy, retention, deletion and accessibility review**, and a decision on how long profiles and audit rows are kept.
- **An AI spend cap.** Rate limiting bounds abuse; it does not bound spend. A hard budget must be set on the AI account itself.

Free-tier quotas are not an uptime guarantee. Hosting can start within free allowances, but payment processing fees, source permissions and platform limits are separate considerations. Do not assume an AI free allocation is a hard spend cap.
