# FJ - Find Jobs release status

Updated 18 October 2026. **This release is not fully live yet.** Cloudflare D1
rejected deployment migrations with code 7500: the account has exhausted its
free daily database row-read allowance. No paid hosting plan has been enabled.

## Chosen address

**https://fj-find-jobs.pages.dev** is now the selected deployment project, not
just a reservation. The workflow and the deployer's default both target it.
Cloudflare Access for this exact hostname is configured; its real email-code
page was fetched successfully. Telegram registration will move to this hostname
only after the full deployment passes its database checks.

A first deployment to an otherwise empty reserved project may publish the new
interface while the database is unavailable, rather than leaving an origin error.
That path intentionally FAILS the release, does not invent a job feed, does not
skip arbitrary migration errors, and never replaces an existing working app.
It does not count as successful account, AI, ingestion or production verification.

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
Verified in deployment 39158240890. Database-backed translation/advice endpoints
still await storage recovery; this narrow provider test is not a complete user
session or proof of every AI feature.

## Read-efficiency and checks

- Public GET data has short edge caches. Account data, AI routes, writes, cookie
  responses, private/no-store responses and failures are never cached.
- New ordered/country/freshness/source-status indexes reduce scans and sorts.
- Public source inspection no longer rewrites every registry row. Deployment
  registers sources explicitly and updates metadata only when it changes.
- 114 unit tests and 139 Workers/D1 tests pass locally; production build,
  TypeScript, ESLint and formatting pass. The local live-data smoke suite has
  14 passing checks, including sign-up/recovery dialog behavior.
- **All 16 browser tests pass locally** against genuine public-feed data. The
  browser suite covers **320, 390, 414, 768, 1024, 1280, 1600 and 1920px**,
  navigation, saved state, content, account help and number-free mobile rings.
- CI can run that browser suite in an isolated staging-mode preview by freshly
  ingesting public One Acre Fund/MyJobMag feeds into an isolated local database.
  It refuses to substitute fictional listings if those sources fail.
  That is NOT a successful production/Access/email delivery test. See Actions for
  the current CI outcome; the new production browser stage remains blocked.
  CI **39158244867** passed all 16 browser tests in 19.2 seconds against freshly
  ingested publisher data, along with the unit/worker/build/audit checks.
- Preview on port 5173 retains 10 genuine source listings and current open FX data,
  without using a synthetic runtime fixture. No local OpenRouter secret is stored.

## Hosting blocker

Cloudflare Free includes 5 million rows read and 100,000 written daily. Limits
reset at **00:00 UTC (01:00 Nigeria time)**. An owner can alternatively upgrade
Workers hosting (minimum US$5/month plus possible excess usage charges). This is
separate from enabling payments in FJ; the agent has not authorized any upgrade.

Docs: https://developers.cloudflare.com/d1/platform/pricing/

Latest blocked full release: https://github.com/techoracle123/findjobs/actions/runs/39158240890

A best-effort workspace timer queues a free-tier retry at **00:05 UTC / 01:05 Nigeria
time on 19 October 2026**. It requires the workspace process to remain alive; it
is not a durable production scheduler or a guarantee of successful deployment.

First blocked release: https://github.com/techoracle123/findjobs/actions/runs/39155920179

PR: https://github.com/techoracle123/findjobs/pull/1

Branch: `arena/be298902-findjobs`.
