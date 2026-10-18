# FJ - Find Jobs

A simple, skill-first job discovery service for Nigeria and the world, across professions. FJ links to opportunities; it is not affiliated with employers and does not verify or endorse listings. Compact results open dedicated job pages with back-to-results navigation.

## Current status

The selected address is **https://fj-find-jobs.pages.dev**. Deployment now targets
this exact project. **Public browsing is restored**, including Nigerian filters,
search and dedicated job pages. A database-independent, robots-aware public-feed
snapshot now serves **8,546 distinct public listings**, including **689 Nigerian**
listings at the latest check. The Cloudflare producer refreshes discovery every
**12 hours**, independently of this workspace or D1. Cloudflare's
exhausted daily D1 allowance still degrades account syncing and ingestion; this
is not full account/AI readiness. See [launch status](docs/LAUNCH-STATUS.md).

Jobs come from live public sources. Runtime demo fallbacks are removed, historical
fictional rows are purged by migration 0011, and synthetic fixtures exist only for
tests. Empty feeds stay empty. Unavailable exchange rates do not become made-up
conversions. Payments and the plan screen are disabled.

The encrypted OpenRouter key is now detected. Cloudflare Access's actual email-code
page is configured for the chosen hostname. Live discovery, pagination beyond 5,000 results and full job-detail responses
are checked during deployment.
Full database-backed account/AI checks still need storage recovery, and real
email/chat delivery needs user confirmation.

The default ranking is eligibility-first (eligible overlap, unknown, then restricted), followed by internal skill/preference overlap and recency. Visitors see a green match ring, not a numeric grade. The score weights required skills (48%), useful skills (14%), role family (18%), seniority (10%) and work mode (10%); missing details are neutral, and eligibility is separate. The work-eligibility picker searches every ISO alpha-2 region except Antarctica. Salary conversion uses dated live rates when available; salary sorting never annualises different pay periods.

See [general jobs and secure AI](docs/GENERAL-JOBS-AND-AI.md) for the new sources,
English translation, tailored tips, salary conversions and the chosen hostname.

## What is implemented

**Opportunity desk**

- Simple results with job, employer, location and salary; dedicated `/jobs/:id` pages with working browser history, saved state and original application links. No repetitive verification/eligibility/source badges.
- Skill/preference scoring remains explainable, with optional detail on the job page. Country, profession, arrangement and experience filters operate in D1 before pagination.
- Number-free match rings with a plain-language explanation and optional qualitative skill/preference detail. Internal weighted scoring remains deterministic. Components that cannot be compared are excluded from the total rather than counted as failures, so a sparse posting is not penalised for being sparse.
- Work-eligibility picker covering every ISO 3166-1 alpha-2 region except Antarctica. The list is **generated** from `i18n-iso-countries` (`npm run data:generate`), never hand-maintained.
- Profile and skill signal with forgiving matching: `node.js`, `NodeJS` and `node` are one skill; `TS` is `TypeScript`.
- CV import for PDF, DOCX and TXT, parsed in the browser. Only the extracted text is sent for suggestions — the file is never uploaded or stored.
- Salary conversion into a chosen display currency using dated reference rates, with the rate date shown. Currencies with no rate keep the employer's original currency. Pay periods are never annualised and mixed results say so.

**Accounts (Cloudflare Access)**

- Simple sign-up/sign-in and email-code recovery. No password to create, forget or reset. The first verified email sign-in creates the account.

- Identity comes from Cloudflare Access. The `Cf-Access-Jwt-Assertion` token is **cryptographically verified** against the team's published JWKS, with issuer and audience checked. The `Cf-Access-Authenticated-User-Email` header is never trusted on its own — it can be forged by anyone who can reach the Worker.
- Public browsing stays anonymous. Only `/api/account/*`, `/api/billing/*` and `/api/telegram/*` require an identity.
- Accounts, profiles, saved roles, applications, alert preferences, subscriptions, entitlements, consents and an audit log live in D1.
- The browser keeps a local copy of everything, so the interface is instant and works with no account. On sign-in the server becomes the source of truth and the browser's data can be imported rather than lost.

**Sources and ingestion**

- A source registry: a table of sources, each with a parser, a kind, a refresh tier, a per-hour rate limit, a country and a verification policy. It has 219 configured public-source candidates and grows by adding rows rather than code; source candidates are not a claim that every endpoint works.
- Ten parsers, which is what makes "thousands of sources" tractable: one parser covers many employers, so a registry of thousands of sources needs only a handful of readers. Greenhouse, Lever, Ashby, Recruitee, SmartRecruiters and Workday read the public JSON endpoints those platforms expose; a schema.org `JobPosting` reader picks up any careers page that publishes structured data; an RSS reader picks up any employer job feed; Arbeitnow and Remotive cover the public aggregators.
- One normalisation path for every source: role family, seniority, work mode, country, skills, salary, whether it is open and whether it is verified are derived once, in one place.
- Postings are upserted by content hash, so a re-run is idempotent, a changed posting is updated, and a posting the source has dropped is closed rather than left to rot.
- A crawler that behaves: `robots.txt` is read before the first request to a host and is obeyed, the crawl delay it asks for is honoured, the bot identifies itself honestly, and every host is rate-limited. A source that fails five times running is disabled rather than retried forever.
- Job lifecycle: a role that stops appearing, that its source marks closed, or that passes its validity date is closed — with the date and the reason — and every posting keeps a history of what happened to it. A role that reappears is reopened, not duplicated. Closed roles stay visible, marked closed, rather than disappearing.
- Verification with a reason: `verified` means the posting was read from the employer's own board; `unverified` means it came from a public listing we could not confirm with the employer; `stale` means it has not been seen in a recent refresh. The reason is stored and shown.
- Sources are refreshed on their own tier, several at a time, with a per-source budget so one unresponsive host costs seconds rather than the run. Work is spread across a Cloudflare Queue, so the number of sources is not limited by how long one Worker invocation may run.
- The feed is searched and paged in the database rather than shipped whole to the browser.
- Recorded API fixtures drive the tests, so the pipeline is exercised end to end without touching the network.

**Billing**

- A payment-provider interface with Paystack, Flutterwave and Stripe behind one seam. The plan and the price live on the server, never in the browser.
- Entitlements are always derived server-side from the subscription row. The client is never trusted to grant itself a feature.
- Paystack and Stripe webhooks are verified with an HMAC over the raw body (or `timestamp.payload` for Stripe) and checked against a replay window; Flutterwave's static `verif-hash` is verified and the payment is then confirmed with the provider's own API before anything is granted. Retries are deduped.
- When no provider is configured the app runs with a safe fake provider that never charges and never accepts a webhook. The UI says so plainly.

**AI with a budget**

- CV extraction uses Workers AI when it is bound, with a clearly labelled keyword fallback when it is not. Every real model call is counted against the account that made it and against the deployment as a whole.

**Readiness in one place**

- `GET /api/readiness` (and `npm run doctor`) reports what is working and what is missing — database, identity, payments, Telegram, sources, queue, AI, rates — and what to do about each.

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

| Route                                       | Purpose                                                    |
| ------------------------------------------- | ---------------------------------------------------------- |
| `GET /api/health`                           | Mode, bindings, data source, rate vintage, sign-in URL     |
| `GET /api/jobs`                             | The feed; `?q=`, `?status=`, `?limit=`, `?offset=` page it |
| `GET /api/jobs/:id`                         | A single posting                                           |
| `POST /api/score`                           | Scores postings against a supplied profile                 |
| `POST /api/cv/suggest`                      | Profile suggestions from extracted CV text                 |
| `GET /api/rates`                            | Reference rates, their date and their source               |
| `GET /api/account`                          | The signed-in account, profile, saved roles and alerts     |
| `PUT /api/account/profile`                  | Saves the profile                                          |
| `GET/POST/DELETE /api/account/saved`        | Saved roles and applications                               |
| `GET/POST/PATCH/DELETE /api/account/alerts` | Alert preferences                                          |
| `POST /api/account/import`                  | Imports data the browser was keeping locally               |
| `DELETE /api/account`                       | Deletes the account and everything attached to it          |
| `GET /api/sources`                          | The source registry and the state of every source          |
| `POST /api/sources/ingest`                  | Runs the sources that are due, within a budget             |
| `GET /api/readiness`                        | What is working and what is missing, in one place          |
| `GET /api/billing/plans`                    | Available plans, their price and the provider              |
| `GET /api/billing/subscription`             | Current subscription and entitlements                      |
| `POST /api/billing/checkout`                | Starts a checkout                                          |
| `POST /api/billing/portal`                  | Opens the provider's customer portal                       |
| `POST /api/billing/cancel`                  | Cancels the plan at the end of the paid period             |
| `POST /api/billing/webhook`                 | The provider's webhook (signature verified)                |
| `GET /api/account/export`                   | Everything held about the signed-in account                |
| `GET /api/telegram/status`                  | Whether this account has linked a chat                     |
| `POST /api/telegram/link`                   | Returns a signed deep link to link Telegram                |
| `POST /api/telegram/webhook`                | The bot's webhook (secret token verified)                  |

## Configuration

Set these as Pages environment variables, or as Wrangler secrets where the value is sensitive.

| Variable                     | Purpose                                                                  |
| ---------------------------- | ------------------------------------------------------------------------ |
| `APP_MODE`                   | `production` enables the strict identity rules                           |
| `ACCESS_TEAM_DOMAIN`         | Your Cloudflare Access team domain                                       |
| `ACCESS_AUD`                 | The Access application AUD tag                                           |
| `BILLING_PROVIDER`           | `paystack`, `flutterwave`, `stripe` or `fake` (auto-inferred when unset) |
| `BILLING_CURRENCY`           | The currency the paid plan is settled in (default `NGN`)                 |
| `BILLING_PRICE_PRO`          | The price of the paid plan, in major units (default `5000`)              |
| `PAYSTACK_SECRET_KEY`        | Paystack secret key (`sk_test_…` / `sk_live_…`)                          |
| `FLUTTERWAVE_SECRET_KEY`     | Flutterwave secret key (`FLWSECK_…`)                                     |
| `FLUTTERWAVE_WEBHOOK_SECRET` | The hash Flutterwave echoes back in `verif-hash`                         |
| `STRIPE_SECRET_KEY`          | Stripe secret key (also supported)                                       |
| `STRIPE_WEBHOOK_SECRET`      | Stripe webhook signing secret                                            |
| `STRIPE_PRICE_PRO`           | Stripe price id for the paid plan                                        |
| `TELEGRAM_BOT_TOKEN`         | Telegram bot token                                                       |
| `TELEGRAM_BOT_USERNAME`      | Bot handle, used to build the deep link                                  |
| `TELEGRAM_WEBHOOK_SECRET`    | Telegram webhook secret token                                            |
| `AI_DAILY_LIMIT`             | How many AI calls one account may make in a day                          |
| `AI_GLOBAL_DAILY_LIMIT`      | How many AI calls the whole deployment may make in a day                 |

Access protects _paths_, so create an Access application that covers `/api/account/*`, `/api/billing/*` and `/api/telegram/*`. Public job browsing stays anonymous.

## Validate before handoff

```sh
npm run check          # type check
npm run lint           # eslint
npm run format:check   # prettier
npm run test           # unit + worker integration tests
npm run build          # production build
npm run test:smoke     # browser smoke test (needs the API running on 8787)
npm run doctor         # what is working and what is missing (needs the API on 8787)
npm audit --audit-level=high
```

`npm run test:smoke` builds the app as a single bundle, runs it in jsdom against the local API worker, and asserts that the desk renders, ranks, scores and explains itself. `npm run doctor` hits `GET /api/readiness` and prints every check with what to do about it.

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
- **Live job sources, checked one by one.** The ten parsers and the 209-source registry are real, but the terms of each source, its rate limit and its attribution requirements have to be checked before the feed is presented as live. A board that does not answer is not a silent problem: it is disabled after five failures and listed in the operator view, so the registry can be pruned to what actually works. The feed currently mixes fictional demo rows with whatever ingestion has fetched, and the interface says which is which.
- **A decision on closed roles.** They are kept, marked closed with the date and the reason, and hidden from the default feed. If they should be removed instead, or kept for a fixed window and then purged, that is a policy choice rather than a code change.
- **A currency feed that covers the currencies people are paid in.** Frankfurter is ECB-based, so NGN, AED, KES, GHS and SAR cannot be converted with it. Roles paid in those currencies keep the employer's original figure, which is honest but less useful.
- **OCR for scanned CVs.** Text-based PDFs and DOCX files are handled; a scanned image is not.
- **Privacy, retention, deletion and accessibility review**, and a decision on how long profiles and audit rows are kept.
- **An AI spend cap.** Rate limiting bounds abuse; it does not bound spend. A hard budget must be set on the AI account itself.

Free-tier quotas are not an uptime guarantee. Hosting can start within free allowances, but payment processing fees, source permissions and platform limits are separate considerations. Do not assume an AI free allocation is a hard spend cap.
