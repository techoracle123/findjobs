# FJ - Find Jobs release status

Updated 18 October 2026, 21:06 UTC. **Expanded public discovery is live: 8,546 distinct
public listings, including 689 Nigerian listings**, observed after publication
at 20:43 UTC. The API successfully returned a real listing at offset 5,000 and
the complete description of a Nigerian employer-board role. Counts fluctuate;
these are publisher-listed opportunities, not verified or guaranteed vacancies.

**Latest deployment [39166093001](https://github.com/techoracle123/findjobs/actions/runs/39166093001)
SUCCEEDED: all 17 actual live-site browser tests passed in 22.4 seconds**, including
broad-corpus metadata, pagination beyond 5,000 results and complete job descriptions.

**Automatic discovery refresh is deployed every 12 hours.** The Cloudflare cron
runs at **00:00 and 12:00 UTC (01:00 and 13:00 Nigeria time)**. Per-publisher
queue jobs collect current listings; a delayed publication task allows up to
20 minutes for collection/retries. Edge/isolate caches may add a short propagation
delay. The first initial collection ran during deployment; the first natural cron
execution is still upcoming. This is a durable Cloudflare schedule, not a claim
that this workspace timer guarantees regular updates.

Account persistence and database-backed AI remain degraded by D1's daily quota.
The public discovery collector, storage, publication and schedule no longer need
D1. No paid hosting/billing change was made.

## Chosen address

**https://fj-find-jobs.pages.dev** is now the selected deployment project, not
just a reservation. The workflow and the deployer's default both target it.
Cloudflare Access for this exact hostname is configured; its real email-code
page was fetched successfully. Telegram registration will move to this hostname
only after the full deployment passes its database checks.

The recovery intentionally permits a browsing-only deployment on the specific
D1 daily-quota failure, including an existing project. Other migration errors
still fail the deployment. It checks actual job responses and deep links before
reporting public browsing recovered, exports `STORAGE_DEGRADED=true`, and does
not report database readiness. The **database-independent** discovery producer
and consumer are now deployed even in that state; legacy D1 ingestion is not
reported restored.

## Durable, regularly refreshed public discovery

- The small 372-job emergency feed is no longer the primary corpus. The primary
  feed is a Cloudflare KV-backed publication with 8,546 distinct listings from
  **48 successful publishers** in the initial collection. **154 candidates** were
  attempted; 106 unavailable/disallowed candidates contributed no invented jobs.
- Added 25 employer-board candidates spanning healthcare, education, financial
  services, energy/agriculture, non-profits and general operations. Only real,
  successfully retrieved postings count. The full source registry now has 244
  candidates; this is not a claim that all 244 work.
- Eligible public Greenhouse/Lever boards and publisher RSS/public JSON sources
  are collected independently, with robots exclusions, crawl delays and deadlines.
  Restricted Remotive redistribution and robots-blocked publishers stay excluded.
- The durable path does **not** apply the emergency 100-jobs-per-source limit.
  Oversized payloads fail a safety bound rather than silently inflating success.
- Canonical application URLs deduplicate tracking variants. Exact employer/title/
  location syndications across sources are also collapsed, while distinct roles
  and locations remain. Actual original dates, links and observation times remain.
- Full descriptions are stored separately; search indexes contain short excerpts.
  Opening a job fetches its full record, never treats the excerpt as the complete
  description. Search/filter/pagination operates across the full published corpus,
  not only the first 200 results loaded in the browser.
- A publication pointer changes only after its immutable index shards are stored.
  Failed publisher refreshes retain prior observations only within a 36-hour age
  limit; stale sources cannot stay open indefinitely through other publishers.
  A successful source returning no openings replaces its prior source index.
- KV bulk reads and bounded storage waits reduce cold-region latency. Public cache
  writes run in the actual Pages request's `waitUntil`, not on the response path.
- `/api/feed-status` exposes actual corpus count, publication time, refresh interval,
  source coverage and the number of newly added IDs compared with the prior cycle.
  The interface shows publication time and “Updates every 12 hours.”
- The five-source emergency fetch remains a bounded last resort if durable public
  storage is unavailable. No runtime fixtures, invented listings, auth bypass or
  unmetered model calls are used. Original text/listing-based pointers remain the
  honest fallback when metered AI storage is unavailable.
- Re-deploying a fresh publication reuses it rather than recrawling all publishers
  or rewriting all records. Normal twice-daily refresh remains the cron's job.

The old hostname and shared database are retained. Signed-in account records use
the same database. Browser-only data is origin-specific: saves on the old address
are not silently transferred. They can be imported into an account there before
switching addresses.

## Implemented

- Clear **Sign up** and **Sign in** actions; native accessible account dialog,
  focus containment, Escape/close and focus restoration.
- Passwordless email codes. The first email sign-in creates the account; existing
  users use the same email. “Forgot password or can’t sign in?” explains how to
  request a fresh code, check spam and use the latest code. There is no password
  database or pretend password-reset form. Real email delivery still needs a user.
- Validated post-login job return paths; external/protocol-relative redirects and
  forged production identity headers are rejected.
- A hand-authored SVG **briefcase/FJ monogram**, shared by the logo and favicon.
- Number-free green match rings, now visible on mobile as well as desktop. A
  fuller ring means greater overlap with supplied skills/preferences, not a grade,
  employer verification, offer probability or hiring prediction. The interface
  explains this once; optional job detail explains the actual matching signals.
- Unknown profession, experience and work arrangement do not penalize the match.
- Broker/referral positioning and a stronger **always verify the employer,
  requirements and original listing** warning. No affiliation/endorsement claims.
- No API-branded salary banner. CC0 open currency data, with two mirrors and a
  central-bank fallback, replaces the attribution-required provider. NGN is
  supported, original salary/period are retained and estimate details are optional.
- Dedicated job pages, saved jobs/preferences, skills/CV discovery, international
  and Nigerian filters remain. Payments remain disabled.

## More real opportunities

The Greenhouse adapter previously requested HTML from a website URL. It now uses
its documented public JSON endpoint. Active automatically failed Greenhouse
boards are scheduled to retry; operator-disabled boards are not re-enabled.

Confirmed public employer boards added: **One Acre Fund, GiveDirectly, GiveWell,
Acumen**. Their published openings include agriculture, research, fundraising,
finance, operations and development work, including Nigerian roles. General
interest/talent-pool entries are excluded; genuine published dates and application
deadlines are retained. Unexpected payloads fail instead of closing existing jobs.

There are **219 configured source candidates**, not 219 verified working boards.
The last successful production check before the outage observed **3,190 listings,
620 Nigerian**, from existing public sources. These are historical observations,
not a live availability count during the outage. New board ingestion counts await
restoration of database access. Remotive restrictions and robots exclusions remain.

## OpenRouter

The encrypted **OPENROUTER_API_KEY is now detected** and is configured server-side.
The agent reads the encrypted secret, not credentials from chat. Rotate any key
that was exposed; do not paste credentials into chat.

Translation and tailored advice code is ready, with caching, bounded requests,
validated plain-text output, quotas and honest original/listing-based fallback.
**A real OpenRouter call now passes:** the actual server adapter translated an
excerpt from a current public French GiveDirectly job into validated English.
The probe sends no user profile or CV and does not log its key or provider output.
Verified again in recovery deployment 39161116586. Database-backed translation/advice endpoints
still await storage recovery; this narrow provider test is not a complete user
session or proof of every AI feature.

## Read-efficiency and checks

- Public GET data has short edge caches. Account data, AI routes, writes, cookie
  responses, private/no-store responses and failures are never cached.
- New ordered/country/freshness/source-status indexes reduce scans and sorts.
- Public source inspection no longer rewrites every registry row. Deployment
  registers sources explicitly and updates metadata only when it changes.
- 115 unit tests and 149 Workers/D1 tests pass locally; production build,
  TypeScript, ESLint and formatting pass. The local live-data smoke suite has
  14 passing checks, including sign-up/recovery dialog behavior.
- **All 16 browser tests pass locally** against genuine public-feed data. The
  browser suite covers **320, 390, 414, 768, 1024, 1280, 1600 and 1920px**,
  navigation, saved state, content, account help and number-free mobile rings.
- CI can run that browser suite in an isolated staging-mode preview by freshly
  ingesting public One Acre Fund/MyJobMag feeds into an isolated local database.
  It refuses to substitute fictional listings if those sources fail.
  That isolated CI is not an email delivery test. Code CI **39165506142**
  passed unit/worker/build/audit and all 16 real-feed preview browser checks.
  Separately, deployment **39161116586** passed all 16 browser checks against
  **the actual live site** in 24.8 seconds, during the database quota outage.
  That earlier 16-test result applied to the emergency feed. Expanded-feed runs
  exposed intermittent HTTP waits; bulk reads and bounded waits were added.
  The new 17th browser check explicitly requires at least 2,000 real results,
  12-hour refresh metadata, deep pagination and a complete detail response.
  The final expanded-feed deployment **39166093001 passed all 17 tests in 22.4s**;
  the timeout failures described above are superseded by that successful run.
- Preview on port 5173 retains 10 genuine source listings and current open FX data,
  without using a synthetic runtime fixture. No local OpenRouter secret is stored.

## Hosting blocker

Cloudflare Free includes 5 million rows read and 100,000 written daily. Limits
reset at **00:00 UTC (01:00 Nigeria time)**. An owner can alternatively upgrade
Workers hosting (minimum US$5/month plus possible excess usage charges). This is
separate from enabling payments in FJ; the agent has not authorized any upgrade.

Docs: https://developers.cloudflare.com/d1/platform/pricing/

Previous blocked full release (superseded for public browsing): https://github.com/techoracle123/findjobs/actions/runs/39158240890

A best-effort workspace timer requests a fresh deployment of the current branch at **00:05 UTC / 01:05 Nigeria
time on 19 October 2026**. It requires the workspace process to remain alive; it
is not a durable production scheduler or a guarantee of successful deployment.

First blocked release: https://github.com/techoracle123/findjobs/actions/runs/39155920179

PR: https://github.com/techoracle123/findjobs/pull/1

Branch: `arena/be298902-findjobs`.
