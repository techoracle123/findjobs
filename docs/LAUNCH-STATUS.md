# FJ - Find Jobs launch status

Verified 18 October 2026. This report distinguishes working deployment checks
from integrations that still need a real user or an encrypted credential.

## Live app

**https://find-jobs-1is.pages.dev**

- 3,190 current, non-synthetic open listings reported by public feeds/boards;
  **620 in Nigeria**. Counts change as sources refresh. These are source
  observations, not employer verification or endorsements.
- New Nigerian feeds: MyJobMag (100 individual listings) and Hot Nigerian Jobs
  (520 individual listings). We Work Remotely added 88 international/remote
  listings. Inaccessible sources remain failures, not invented jobs.
- General professions alongside technology; country, profession, work arrangement
  and experience filters run against D1 before pagination.
- Simple FJ branding, welcome and a clear referral-only/non-affiliation disclaimer.
  Repetitive verification, eligibility and API/source badges are removed from rows.
- Dedicated `/jobs/:id` pages support deep links, reload, normal/modified clicks,
  browser back/forward and returning to the current results/scroll position.
- HTML/encoded markup and the Arbeitnow promotional footer are removed. Original
  listing links retain necessary publisher credit, without ATS/API labels on rows.
- Salary conversion includes NGN, with dated reference rates, approximation
  markers, original amounts, provider attribution and honest unavailable states.
  Unstated periods and ambiguous currency symbols are not guessed.
- Local profile/save/reload works without signing in. Device data can be merged
  after sign-in without silently losing it. Telegram alert changes include
  channel-only edits. Payments remain disabled.
- Real-data preview restored on port 5173 with 10 genuine production-feed listings (6 Nigerian, 4 international);
  no synthetic fixture is used at runtime. The deployed site has the full feed.

## Cloudflare Access: configured and login page verified

The permission fix worked. The remaining 403 was specifically
`access.api.error.not_enabled`, meaning the Zero Trust organization did not yet
exist—not a reason to keep changing token permissions.

The deployer now uses Cloudflare's documented organization creation endpoint only
for that explicit state. It does not treat ordinary authorization failures as
permission to create resources. Cloudflare generated the team domain, and the
runner then configured email-code identity and a login-path-only application.

Verified:

- Public `/` and job APIs remain public.
- `/api/auth/login` redirects to Cloudflare Access.
- Following that URL reaches the real **Email / Send login code** sign-in page.
- Account endpoints still reject anonymous requests and forged identity headers.
- Signed JWT issuer, audience, expiry and signature checks are covered by worker
  tests. The bare email header is never trusted.

**Still requires a real user:** receipt of the email code and completing a signed-in
account session. No real inbox/code was used by the agent, so successful delivery
and a completed real-user login are not claimed.

Successful bootstrap deployment:
https://github.com/techoracle123/findjobs/actions/runs/39152392018

## OpenRouter: implemented, credential not yet present

The runner reports **`OPENROUTER_API_KEY` is missing**. Revoke the key exposed in
chat and save a replacement as an encrypted repository secret at:
https://github.com/techoracle123/findjobs/settings/secrets/actions/new

Code is in place for automatic English descriptions, cached translations,
job/skill-specific application tips and CV suggestions. Requests are server-only,
bounded, quota-limited and use no-data-collection provider routing. Source/CV text
is untrusted model input; output is validated and rendered as plain text.

Until the secret is provided, non-English text remains original with an honest
notice, CV extraction uses keywords, and application advice is explicitly
listing-based. **Live AI translation/advice has not been claimed or tested with
an owner credential.** Offline tests exercise the provider boundary, translation
cache, fallback, quotas and output validation.

See [general jobs and secure AI](GENERAL-JOBS-AND-AI.md) for implementation details.

## Telegram: bot and webhook verified

The encrypted bot credential is now available. Deployment verifies
**@FindJobsForMeBot**, registers the secret-authenticated webhook on the actual
live hostname and confirms it with `getWebhookInfo`.

Linking uses a 43-character one-use random token, hashed in D1, with a 15-minute
expiry. Only private chats are accepted. Standard Telegram `message` updates,
webhook secrets, replay rejection and confirmation messages are regression-tested.

**Still requires a real user:** sign in, link the bot, and confirm delivery to
that chat. Bot/webhook configuration alone is not proof of end-to-end delivery.
Any credential previously exposed in chat must be rotated, not merely copied into
a secret.

## Alternative names: exact assignments reserved

Cloudflare assigned both exact names to projects in this account:

- **`fj-find-jobs.pages.dev`** — closest to the FJ branding.
- **`find-jobs-fj.pages.dev`** — closest to the earlier requested name.

These are empty project reservations, **not additional live app deployments**.
The current live app has not been moved or deleted. Availability is proven by
Cloudflare's actual assignment, not by a missing DNS record. The earlier requested
`find-jobs.pages.dev` was not assigned to this project.

## Checks

- TypeScript, ESLint, formatting, production build and dependency audit pass CI.
- **108 unit tests**, **124 Workers/D1 integration tests** and **11 local smoke
  checks** pass.
- **10 live Playwright tests** pass: four responsive widths (390/768/1280/1600),
  saving/preferences/reload, real APIs/security, dedicated-page deep links and
  history/scroll, application advice/content, Nigeria/general professions, and
  public browsing versus Access sign-in availability. Once Access was bootstrapped,
  the sign-in test exercised the real redirect, not its unavailable fallback.
- Successful full run with Access bootstrapped: **39152392018**, 10 browser tests in
  15.1 seconds. The final UI/currency/preview-diagnostic update passed in
  **39152548727**, with 10 browser tests in 14.7 seconds.
- PR: https://github.com/techoracle123/findjobs/pull/1
- Working branch: `arena/be298902-findjobs`.

Publisher restrictions are respected: Remotive redistribution is disabled;
Reddit/social sources are not scraped behind authentication. Newly registered
Accor/H&M/IKEA candidates were blocked by their host's robots policy and are not
represented as working sources.
