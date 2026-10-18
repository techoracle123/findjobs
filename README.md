# Role Signal — working title

A Cloudflare-oriented prototype for skill-first global tech-job discovery. The interface is an opportunity desk rather than a generic marketing template: compact job results, eligibility context, explainable skill fit and clear source/freshness labels.

## Current status

This is a **local prototype, not a live job service**. The eight bundled job records and the sample salaries are fictional, clearly labelled preview data. No live employer sources, authentication, payment provider, Telegram bot or production Cloudflare account is connected.

The default ranking is eligibility-first (eligible overlap, unknown, then restricted), followed by an explainable 0–100 match score and recency. The score weights required skills (48%), useful skills (14%), role family (18%), seniority (10%) and work mode (10%); missing details are neutral, and eligibility is separate. The work-eligibility picker searches all ISO alpha-2 regions except Antarctica. Salary conversion uses dated reference rates; salary sorting does not annualize different pay periods.

## Proposed zero-upfront architecture

- React + TypeScript/Vite frontend, deployable to Cloudflare Pages.
- Hono API used by Cloudflare Pages Functions (`functions/api/[[path]].ts`) and the local Wrangler Worker preview.
- Cloudflare D1 for canonical jobs and, after authentication is added, account-specific data.
- Cloudflare Workers AI binding for CV suggestions is required for the planned AI-powered production experience; the local preview intentionally does **not** bind AI or make remote model calls, and uses a clearly labelled deterministic keyword fallback instead.
- Telegram Bot API for alerts after a real bot token, user linking and webhook are configured.
- Frankfurter daily reference rates for indicative salary conversion. The app shows the rate date and falls back to the employer's original currency if a conversion is unavailable.

The prototype reads PDF, DOCX and TXT CVs in the browser and sends only extracted text to the API for suggestions. Raw CV files are not uploaded to or stored by this preview. Scanned/image-only PDFs are not supported here.

Free-tier quotas are not an uptime guarantee. Hosting can start within free allowances, but payment processing fees, source permissions, platform limits and future app-store distribution are separate considerations. Do not assume an AI free allocation is a hard spend cap: verify overage and billing settings before binding the model, and keep it disabled until public-endpoint abuse controls exist.

## Run the local prototype

1. Install Node.js 20.19+.
2. Install dependencies: `npm install`.
3. Run the local API worker: `npm run dev:api`.
4. In another terminal, run the web interface: `npm run dev`.
5. Open the Vite URL printed in the terminal.

The Vite server proxies `/api` to the local Worker. Its API uses local D1 demo records and a deterministic CV keyword fallback; it does not call Workers AI or Telegram.

For a built Cloudflare Pages-style preview, run `npm run build` followed by `npm run preview:pages`. The standard `wrangler.jsonc` is the Pages configuration. The placeholder D1 database ID must be replaced with a real database ID before a Cloudflare deployment.

## Local D1 migration

Run `npm run db:migrate:local`. Migrations create the data model and seed clearly fictional preview jobs. Those rows are not live vacancies.

## Validate before handoff

```sh
npm run check
npm run build
npm audit --audit-level=high
```

The browser CV extractor is lazy-loaded; the production build emits a separate PDF/DOCX parsing chunk. The preview API should return eight clearly labelled demo roles, `aiBinding: false`, and `telegramConfigured: false` until integrations are deliberately configured.

## Cloudflare preview deployment handoff

These steps can publish a **staging preview only** after you run them in your own authenticated environment. They do not make this a paid, production-ready service: the current migrations seed fictional demo roles, and authentication, live job ingestion, Telegram linking/delivery and checkout are still unfinished.

1. Push the project to a repository you control, then create a Cloudflare Pages project from it (or authenticate Wrangler locally with `wrangler login`). Do not put API tokens or bot/payment secrets in this repository or in chat.
2. In Cloudflare, create a separate **staging** D1 database named `rolesignal`. Replace the placeholder `database_id` in `wrangler.jsonc` with the returned ID, and bind that database to the Pages Function as `DB`.
3. From the project root, apply the schema to staging with the bundled Wrangler runtime:

   ```sh
   ./node_modules/node/bin/node ./node_modules/wrangler/bin/wrangler.js d1 migrations apply rolesignal --remote
   ```

   These migrations insert fictional preview listings. Keep the resulting site private or clearly in preview mode; do not present them as live vacancies.
4. Set the Pages build command to `npm run build`, the output directory to `dist`, and `NODE_VERSION` to `22.23.3`. The planned AI feature uses a Workers AI binding named `AI`, but leave it disabled until you have verified free-only billing behavior and added server-side authentication/rate limits. Inference failures fall back to deterministic extraction; that fallback is not a usage or spend cap.
5. Build with `npm ci && npm run build`, then deploy via the Cloudflare dashboard, or after creating the Pages project use:

   ```sh
   ./node_modules/node/bin/node ./node_modules/wrangler/bin/wrangler.js pages deploy dist --project-name role-signal
   ```

6. Before any public paid launch, use a separate production database without demo rows, finish the authentication/authorization and provider integrations, add permitted job sources, then review privacy, retention, source freshness, legal and operational controls. The current UI deliberately reports those capabilities as unconfigured.

## Not ready for a paid public launch

Before charging users, the project still needs:

- Real account authentication and server-side authorization. Current profile, saved-job, application and alert preferences are stored locally in this browser preview.
- A selected payment provider, verified webhooks, subscription entitlements, cancellation/refund rules and real checkout. The billing screen is explicitly preview-only.
- A configured Telegram bot, bot token stored as a Cloudflare secret, user-linking flow and webhook. No alerts are sent yet.
- A permitted global job-source set and tested ingestion/expiry verification. The current feed is demo data only.
- Cloudflare Pages bindings for D1 and Workers AI (the latter is required for planned AI extraction). AI is deliberately disabled in local preview; leave it disabled publicly until free-only billing behavior and safe server-side limits are verified.
- Security, privacy, retention, abuse controls, operational monitoring, backup/recovery and accuracy testing before storing real profiles or accepting subscriptions.

## GitHub and production deployment

Arena's current toolset does not expose GitHub or Cloudflare account connectors. The project can be built and previewed in the shared workspace, but this environment cannot push to your GitHub account or publish to your Cloudflare account. Do not paste credentials or bot/payment secrets into chat. The project and deployment steps can be handed over for an authenticated environment.
