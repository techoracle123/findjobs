# FJ - Find Jobs release status

Updated 18 October 2026, 20:00 UTC. **Public job browsing is restored.**
Deployment [39161116586](https://github.com/techoracle123/findjobs/actions/runs/39161116586)
published the recovery and passed **all 16 browser checks against the actual live site**.
It observed **372 genuine public listings**. A subsequent independent live query
returned **106 Nigerian listings**, and its individual-job endpoint worked.
These are observations, not guaranteed or verified vacancies.

Full account/AI/ingestion readiness remains degraded: Cloudflare D1 migrations
still encounter the free account's daily read allowance. No paid plan was enabled.

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
not report database readiness or deploy ingestion workers in that state.

## Database-independent browsing recovery

- Database failures no longer turn the public feed into an empty list/error screen.
  The API fetches real public MyJobMag, We Work Remotely, One Acre Fund,
  GiveDirectly and Arbeitnow listings through existing publisher parsers.
- Publisher robots exclusions, crawl delays and request timeouts apply. Each
  feed contributes at most 100 parsed jobs. Observations are coalesced per isolate
  and cached for 30 minutes in memory and the Cloudflare Cache API.
- Stable IDs match normal ingestion. Posted dates, original application links
  and actual observation timestamps are retained. Closed/expired listings are
  excluded. No runtime fixture, invented job, auth bypass or paid-AI budget bypass.
- Search, filters, totals, pagination and direct job links use the same snapshot
  while the database is unavailable. Healthy database queries can still work.
- Listing-based application pointers remain available; metered model calls are
  not attempted when the database-backed limiter/budget is unavailable. An
  unavailable translation keeps the original text with an honest explanation.
- If every permitted publisher fails and the snapshot has expired, return an
  honest service error, not fabricated/stale availability.

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
- 114 unit tests and 143 Workers/D1 tests pass locally; production build,
  TypeScript, ESLint and formatting pass. The local live-data smoke suite has
  14 passing checks, including sign-up/recovery dialog behavior.
- **All 16 browser tests pass locally** against genuine public-feed data. The
  browser suite covers **320, 390, 414, 768, 1024, 1280, 1600 and 1920px**,
  navigation, saved state, content, account help and number-free mobile rings.
- CI can run that browser suite in an isolated staging-mode preview by freshly
  ingesting public One Acre Fund/MyJobMag feeds into an isolated local database.
  It refuses to substitute fictional listings if those sources fail.
  That isolated CI is not an email delivery test. Latest code CI **39161121973**
  passed unit/worker/build/audit and all 16 real-feed preview browser checks.
  Separately, deployment **39161116586** passed all 16 browser checks against
  **the actual live site** in 24.8 seconds, during the database quota outage.
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
