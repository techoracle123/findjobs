# Go live: what I need from you, and how to get it to me

Everything below is either a credential only you can create, a decision only you
can make, or work I will do. Nothing here needs to be pasted into a chat.

**The rule for credentials: never send a secret to me in a message, and never
commit one to the repository.** Set them as environment variables on this
session, or as encrypted secrets in Cloudflare. I can read the first; I cannot
read the second, so tell me when it is done.

---

## 1. Cloudflare — blocks everything else (do this first)

Nothing can be hosted until I can reach your account. This is the only hard block.

### What a Cloudflare account is

Cloudflare sits in front of your domain and runs the code that serves the site.
This project needs three things from Cloudflare:

- **Workers & Pages** — the code that serves the app and ingests jobs.
- **D1** — the SQLite database that holds jobs, accounts and alerts.
- **Access** — the identity layer that signs people in (no passwords).

Everything else hangs off these, so this step has to happen before anything else
can be deployed.

### Step by step: create an API token

An API token is a long string that lets me talk to Cloudflare on your behalf,
without your password. It can be revoked at any time.

1. **Sign in or sign up** at <https://dash.cloudflare.com>.
   - If you don't have an account, click **Sign up** — an email and a password is enough.
   - Confirm the account is on at least the **Workers Paid** plan if you intend
     to run ingestion at scale. Free Workers has a 10 ms CPU limit and a
     50-subrequest limit, which is not enough to fan out across hundreds of job
     feeds. Workers Paid is $5/month and includes 10 million requests. For a
     staging preview the free tier is fine.

2. **Open the API tokens page:**
   <https://dash.cloudflare.com/profile/api-tokens>

3. Click **Create Token** → choose the **Edit Cloudflare Workers** template → click
   **Use template** (or **Configure**).

4. You will see a form with **Account Resources**, **Zone Resources** and
   **Permissions**. Leave the template's defaults and **add** these permissions:

   | Scope   | Permission                      | Why                                               |
   | ------- | ------------------------------- | ------------------------------------------------- |
   | Account | Workers Scripts: Edit           | deploy the app and the ingestion worker           |
   | Account | D1: Edit                        | create and migrate the database                   |
   | Account | Workers Queues: Edit            | fan ingestion out across many sources             |
   | Account | Pages: Edit                     | deploy the web app                                |
   | Account | Access: Apps and Policies: Edit | create the sign-in application                    |
   | Account | Account Settings: Read          | confirm the account id                            |
   | Zone    | Workers Routes: Edit            | point a custom domain at the app (if you add one) |
   | Zone    | DNS: Edit                       | create the records for that domain                |
   - Under **Account Resources**, choose **Include → All accounts** (or the one
     account if you have several).
   - Under **Zone Resources**, choose **Include → All zones** for now. You can
     narrow it to one zone later if you add a domain.
   - Leave **TTL** and **IP filtering** empty.
   - Click **Continue to summary** → **Create Token**.

5. **Copy the token** — Cloudflare shows it once. It looks like a long string
   starting with a mix of letters and numbers.

   > **Do not use the "Global API Key".** That key is your account password in
   > another form and grants everything. The token above is scoped to only what
   > this project needs.

6. **Find your Account ID.** You need this alongside the token.
   - In the dashboard, open any Workers page, or look at the right-hand sidebar
     of the overview — it shows **Account ID** as a 32-character hex string.
   - Alternatively, the URL of any Workers page contains it:
     `https://dash.cloudflare.com/<ACCOUNT_ID>/workers`.

7. **Hand both values to me.** Set two environment variables on this session —
   not in a file in the repo:

   ```sh
   export CLOUDFLARE_API_TOKEN='<the token you just created>'
   export CLOUDFLARE_ACCOUNT_ID='<your account id>'
   ```

   I will confirm I can see the account (`wrangler whoami`) before doing
   anything else.

   **Alternative if you prefer not to share a token:** tell me and I will hand
   you the exact deploy commands to run yourself. That works, it is just slower
   for both of us.

### What I will do with it

Once the token is set I will:

1. Create the `rolesignal` D1 database (and `rolesignal-test` for tests).
2. Apply all 10 migrations (jobs, accounts, sources, alerts, billing receipts, AI budget, etc.).
3. Create the `rolesignal-ingest` queue.
4. Deploy the Pages app (the site) and the scheduled ingestion worker.
5. Create the Cloudflare Access application and its policy.
6. Attach a custom domain if you provide one (next section).

You can revoke or rotate the token at any time from the same API tokens page.

---

## 2. A domain (recommended, not required)

`*.pages.dev` is enough to launch. A domain you control is better because the
Access session cookie is tied to the host, webhook URLs look legitimate, and
people trust it.

If you have one, add it to Cloudflare as a zone and give me the name. I will
create the DNS records and attach it to both the Pages app and the Access
application. If you need to buy one, Cloudflare Registrar sells at cost — but
do that from your own browser, not through me.

**How to get it to me:** just tell me the hostname, e.g. `rolesignal.dev`.

---

## 3. Payments — Paystack or Flutterwave (deferred, nothing to do now)

You asked to use **Paystack or Flutterwave** and to do payments last. That is
the right call — everything else works without a payment provider.

### How it works in this build

- The plan, the price and the currency live on the **server** (environment
  variables), so the price a customer is charged is never something the browser
  can choose.
- The default is **₦5,000/month** in **NGN** — change `BILLING_PRICE_PRO` and
  `BILLING_CURRENCY` to whatever you want.
- When no payment provider is configured, the app runs with a **fake provider**
  that never charges anyone. The Plan tab says "No payment provider is
  configured" and the checkout button is disabled. A crafted webhook cannot
  grant a paid plan — the fake provider refuses every webhook and the local
  confirm route is blocked in production.
- When you are ready, you set one of these:

  | Provider        | Variables to set                                                                                     | Dashboard                                              |
  | --------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
  | **Paystack**    | `PAYSTACK_SECRET_KEY` (sk_test_… or sk_live_…)                                                       | https://dashboard.paystack.com/#/settings/developer    |
  | **Flutterwave** | `FLUTTERWAVE_SECRET_KEY` + `FLUTTERWAVE_WEBHOOK_SECRET` (the hash you set under Settings → Webhooks) | https://app.flutterwave.com/dashboard/settings/account |

  Then tell me which one and I will wire the checkout, the redirect and the
  webhook. Stripe is also implemented if you ever need it.

- How to tell me when ready:

  ```sh
  export PAYSTACK_SECRET_KEY='sk_test_...'        # or sk_live_...
  # — or —
  export FLUTTERWAVE_SECRET_KEY='FLWSECK_TEST-...'
  export FLUTTERWAVE_WEBHOOK_SECRET='your_hash'
  ```

  Or set them as encrypted Pages secrets — I will read the readiness report.

### What this build does not do until you connect a provider

- No checkout can be started — the button is disabled and the API answers 503.
- No webhook can grant anything — every unsigned webhook is rejected with 400.
- The local `POST /api/billing/confirm` route (used in development to simulate
  a payment) is blocked in production.

So there is nothing to configure now, and leaving it unconfigured is safe.

---

## 4. Telegram (needed for alerts — send the token when ready)

You said you will provide the Telegram bot token later. Nothing to do now.

For reference, when you are ready:

1. Open Telegram and message **@BotFather**.
2. Send `/newbot`, give it a name and a username ending in `bot`.
3. BotFather replies with a **token**.

Then:

```sh
export TELEGRAM_BOT_TOKEN='123456:ABC-DEF...'
export TELEGRAM_BOT_USERNAME='my_role_signal_bot'
```

I will register the webhook against the deployed domain, wire the deep link
that links a Telegram chat to an account, and build the delivery job.

The bot only ever reads `/start` messages and sends role matches. It does not
read your personal chats, and it does not message anyone who has not linked
their account.

Until then, alerts are recorded but not delivered — the readiness report will
say so.

---

## 5. Decisions only you can make

These do not need a credential, just an answer.

**a. How aggressive should the crawler be?**
My default, and what I will build unless you say otherwise: respect
`robots.txt`, rate-limit every host to a few requests per minute, identify
the bot honestly in the user agent, and never attempt to log in to anything.
"Thousands of sources" is reachable with that posture because most employers
publish their openings through a shared applicant-tracking system, and those
systems have public JSON endpoints. I will implement adapters for Greenhouse,
Lever, Ashby, Recruitee, Teamtailor, SmartRecruiters and Workday, plus a
generic schema.org/`JobPosting` reader and an RSS reader — roughly ten
adapters that together cover a very large share of employer career pages, and
each one serves hundreds of employers.

Tell me if you want something else. I will not implement a mode that
deliberately evades `robots.txt` or a site block, and I will not scrape
anything behind a login.

**b. Which sources first?**
I have a seed list of well-known employers on the public platforms. If you
have a specific market in mind — say, German Mittelstand, or African
tech-hubs, or remote-first employers — say so and I will weight the registry
toward it.

**c. Verified versus unverified — how strict?**
My proposal, which I will build unless you say otherwise:

| Level        | Meaning                                                                  |
| ------------ | ------------------------------------------------------------------------ |
| `verified`   | Read straight from the employer's own ATS, or a signed partner feed      |
| `unverified` | Found by aggregation; we have not confirmed it with the employer         |
| `stale`      | Not seen in the last refresh window; shown, but marked as possibly stale |

Each badge carries the _reason_, so the interface can say "verified — the
employer's own Greenhouse board" rather than a bare tick.

**d. What happens when a role closes?**
My proposal: the posting stays visible, marked **Closed** with the date it
closed, and drops out of the default feed and out of alerts. Deleting it
would rob people of the fact that it existed. Tell me if you want closed
roles removed entirely, or kept for a fixed window (say 90 days) and then
purged.

**e. The free tier.**
I have assumed: anonymous browsing, unlimited alerts for signed-in people on
the free plan, and Telegram delivery on the paid plan. Correct me.

**f. Do users need an account to browse?**
I have assumed no — public browsing stays anonymous, because requiring a login
to look at a job board suppresses almost everyone. Accounts are needed only to
save, to get alerts and to subscribe. Cloudflare Access protects the account
paths, not the site.

---

## 6. Optional, and genuinely optional

- **Transactional email** (Resend, Postmark) — only if the weekly digest
  should go by email as well as Telegram. Skip it otherwise.
- **Error monitoring** (Sentry) — I will emit structured JSON logs either way;
  Sentry just makes them searchable. A free DSN is enough.
- **A support address** — a real mailbox for "this role is wrong" reports.
  Worth having before launch; a form that writes to a D1 table is enough to
  start.

---

## 7. What is already built and does not need a credential

So this is not a queue of blocked work, here is what is done and working
today, waiting only for an account to point it at:

**The source registry.** A table of sources, each with a parser, a kind, a
refresh tier, a per-hour rate limit, a country, tags and a verification
policy. It is seeded with 209 real public feeds and grows by adding rows,
not code. `GET /api/sources` shows the whole registry with the last run, the
last error, the consecutive failure count and how many live and closed roles
each source holds.

**Ten parsers, which is what makes "thousands of sources" tractable.** One
parser covers many employers, so a registry of thousands of sources needs
only a handful of readers:

| Parser                  | Covers                             | How                         |
| ----------------------- | ---------------------------------- | --------------------------- |
| Greenhouse              | hundreds of employers              | public JSON board           |
| Lever                   | hundreds of employers              | public JSON API             |
| Ashby                   | hundreds of employers              | public job board API        |
| Recruitee               | dozens of employers                | public offers API           |
| SmartRecruiters         | dozens of employers                | public postings API         |
| Workday                 | dozens of employers                | public careers endpoint     |
| schema.org `JobPosting` | any careers page that publishes it | structured data in the page |
| RSS / Atom              | any employer job feed              | feed parsing                |
| Arbeitnow               | one aggregator                     | public job board API        |
| Remotive                | one aggregator                     | public job board API        |

**A crawler that behaves.** `robots.txt` is read before the first request to
a host and is actually obeyed, the crawl delay it asks for is honoured, the
bot identifies itself honestly, and every host is rate-limited. A source
that fails five times in a row is disabled rather than retried forever.

**Job lifecycle.** A role that stops appearing in its source, or that the
source marks closed, or that passes its validity date, is closed — with the
date and the reason — rather than silently deleted. Every posting has a
history of what happened to it. A role that reappears is reopened, not
duplicated.

**Verification with a reason.** `verified` means the posting was read from
the employer's own board; `unverified` means it came from a public listing
we could not confirm with the employer; `stale` means it has not been seen
in a recent refresh. The reason is stored and shown, so the badge says
"verified — the employer's own Greenhouse board" rather than a bare tick.

**Scale.** Sources are refreshed on their own tier, several at a time, with
a per-source budget so one unresponsive host costs seconds rather than the
run. Work is spread across a Cloudflare Queue, so the number of sources is
not limited by how long one Worker invocation may run. The feed is searched
and paged in the database rather than shipped whole to the browser.

**Billing, ready to connect.** The payment layer speaks Paystack, Flutterwave
and Stripe behind one interface. The plan and the price live on the server,
webhooks are verified (HMAC for Paystack/Stripe, static hash for Flutterwave
with a follow-up API confirmation), every payment is confirmed with the
provider before anything is granted, and retries are deduped. When no provider
is configured the app runs in a safe mode where nothing can be charged and
no webhook can grant a plan.

**AI with a budget.** CV extraction uses Workers AI when it is bound, with a
clearly labelled keyword fallback when it is not. Every real model call is
counted against the account that made it and against the deployment as a
whole, with a per-day limit enforced in the database.

**Readiness in one place.** `GET /api/readiness` (and `npm run doctor`) says
what is working and what is missing — database, identity, payments, Telegram,
sources, queue, AI, rates — and what to do about each. It is the first thing
to look at when a deployment misbehaves.

**The interface.** Verified, unverified, stale and closed badges on every
row, filters for each, a direct apply link, and the closed date and reason
in the detail panel.

**Alerts.** Enabled alerts are matched against new roles and delivered to a
linked Telegram chat, once per role, with the delivery recorded so nothing
is announced twice.

---

## 8. The order, end to end

1. **You**: Cloudflare API token + account id → **me**: everything else.
2. **Me**: database, migrations, queue, Access application, workers, deploy.
3. **You**: domain name (if you have one).
4. **Me**: live ingestion, first real run.
5. **Both**: point the sources at the registry, watch the first real feed
   come in, fix what the normalisation gets wrong.
6. **You**: Paystack or Flutterwave key, Telegram token — when you are ready.
7. **Me**: price, webhook, bot webhook, flip the paid plan on.

Step 1 is the only hard block. Payment and Telegram can wait — the app runs
without them and says so honestly.
