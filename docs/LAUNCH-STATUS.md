# Find Jobs launch status

Last verified: 18 October 2026. This is a status report, not a claim that every
integration is connected.

## Deployed and checked

- Site: **https://find-jobs-1is.pages.dev**. Cloudflare's Pages API reports this as
  the assigned hostname of the `find-jobs` project. The exact requested
  `find-jobs.pages.dev` was not assigned; a hostname owned by another project
  cannot be claimed by this deployment. No existing project was deleted.
- 747 real open jobs were confirmed by the deployment runner; the number changes
  as sources refresh. No fictional rows are returned by any job API. Migration
  0011 purges historical demo rows and their saved-job references.
- Ingestion producer, queue, and consumer are deployed. Source writes and search
  indexing are batched, queue sends respect the 100-message limit, and each queue
  invocation handles one source. Migration 0012 requests a fresh normalisation
  pass without overriding disabled sources.
- Public browse, search, profile editing, local saves, reload persistence, apply
  links and pagination are implemented. Saved jobs are fetched independently of
  the currently searched/loaded page.
- Six live Playwright checks passed: 390, 768, 1280 and 1600 px layouts; save,
  preferences and reload; and public API identity/purchase safeguards. Screenshots
  and reports are GitHub Actions artifacts. Browser checks use the actual
  Cloudflare-assigned hostname, not an assumed address.
- Missing salary, level, arrangement, publication date or hiring restrictions are
  not replaced with guessed defaults. A Greenhouse update time is not a posting
  date. Live rates are used when available; otherwise original amounts remain.
- Payments stay disabled (`BILLING_PROVIDER=fake`), fake purchase confirmation is
  unavailable in hosted modes, and the plan tab is removed. Alerts are not gated
  behind a paid plan.

A listing is a source observation, not a guarantee that an employer has not
changed it since the last refresh. The job detail shows the last confirmation
and the original application link. The open feed excludes listings not confirmed
within three days. Broken sources are reported rather than replaced with fixtures.

## Owner actions still required

### 1. Enable Cloudflare Access provisioning

The encrypted Cloudflare token works for Pages, Workers, D1 and Queues, but the
runner receives **HTTP 403, code 10000** for `/access/organizations`.

At <https://dash.cloudflare.com/profile/api-tokens>, edit the deployment token to
include these **Account / Edit** permissions for the same account:

- **Access: Apps and Policies**
- **Access: Organizations, Identity Providers, and Groups**

If a replacement token is issued, update the existing `CLOUDFLARE_API_TOKEN`
GitHub repository secret. Do not paste it into chat.

The provisioning code reuses an existing Access team and email-code provider,
then creates a login-only application. The board remains public; the app verifies
signed Access cookies/headers before granting access to private account routes.
An authenticated email session still needs an owner/user end-to-end confirmation;
unit/worker signature tests cannot prove email delivery to a real inbox.

### 2. Connect Telegram securely

The token pasted into chat must be revoked in BotFather. Save a replacement at
<https://github.com/techoracle123/findjobs/settings/secrets/actions/new> with the
name **`TELEGRAM_BOT_TOKEN`**.

The runner currently reports that this secret is missing. Once saved, deployment
will call `getMe`, discover the bot username, store credentials as encrypted
Cloudflare secrets, register a secret-authenticated webhook at the actual site
hostname, and verify the saved URL with `getWebhookInfo`.

Linking uses a 43-character random one-use token (fits Telegram's 64-character
start parameter), accepts the actual top-level Telegram `message` update, allows
private chats only, checks the webhook secret, records the linked chat, and sends
a confirmation. Tokens expire after 15 minutes and cannot be replayed. Tests
exercise this flow offline; a real chat cannot be claimed to work until a user
links it and receives a message.

After updating permissions/secrets, rerun **Deploy Find Jobs** in GitHub Actions
(or ask the agent to trigger another deployment). Never include credentials in
workflow inputs, repository files, issue comments or chat.

## Limits on the current readiness claim

The public board is deployed and browser-tested. **Account sync and delivered
Telegram alerts are not yet verified live.** A green deployment run deliberately
reports these as warnings rather than inventing working integrations. Full
production readiness remains blocked on the two owner actions and a real
sign-in/chat delivery check. Payments are intentionally outside this launch.
