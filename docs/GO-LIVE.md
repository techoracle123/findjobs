# Go live: what I need from you, and how to get it to me

Everything below is either a credential only you can create, a decision only you
can make, or work I will do. Nothing here needs to be pasted into a chat.

**The rule for credentials: never send a secret to me in a message, and never
commit one to the repository.** Set them as environment variables on this
session, or as encrypted secrets in Cloudflare. I can read the first; I cannot
read the second, so tell me when it is done.

---

## 1. Cloudflare — blocks everything else

Nothing can be hosted until I can reach your account, so this is first and it
gates the other steps.

**What to create**

1. Sign in at <https://dash.cloudflare.com>.
2. Confirm the account is a **paid plan**. Free Workers has a 10 ms CPU limit
   and a 50-subrequest limit, which is not enough to fan out across hundreds
   of job feeds. Workers Paid ($5/month, includes 10 million requests) is the
   minimum sensible target. The free tier is fine for a staging preview.
3. Create an API token: <https://dash.cloudflare.com/profile/api-tokens> →
   **Create Token** → **Edit Cloudflare Workers** template → **Configure** →
   add these permissions:

   | Scope   | Permission                      | Why                                     |
   | ------- | ------------------------------- | --------------------------------------- |
   | Account | Workers Scripts: Edit           | deploy the ingestion worker and the API |
   | Account | D1: Edit                        | create and migrate the database         |
   | Account | Workers Queues: Edit            | fan ingestion out across many sources   |
   | Account | Workers KV Storage: Edit        | cache source responses and rate tables  |
   | Account | Pages: Edit                     | deploy the web app                      |
   | Account | Access: Apps and Policies: Edit | create the identity application         |
   | Account | Account Settings: Read          | resolve the account id                  |
   | Zone    | Workers Routes: Edit            | point the custom domain at the app      |
   | Zone    | DNS: Edit                       | create the records for that domain      |

   Scope the token to your account and to the one zone if you add a domain.
   Do not use the "Global API Key".

4. Find your **Account ID** (right-hand sidebar of the Cloudflare dashboard,
   or the URL of any Workers page).

**How to get it to me**

Set two environment variables on this session — not in a file in the repo:

```sh
export CLOUDFLARE_API_TOKEN='<the token you just created>'
export CLOUDFLARE_ACCOUNT_ID='<your account id>'
```

I will confirm I can see the account before going further. If you would
rather not hand over a token, the alternative is for you to run the deploy
commands yourself and I will hand you the exact list — that works, it is just
slower for both of us.

**What I will do with it:** create the `rolesignal` D1 database and the
`rolesignal-test` database, apply the migrations, create the ingestion queue,
deploy the Pages app, deploy the scheduled ingestion worker, create the
Cloudflare Access application and its policy, and register the custom domain.

---

## 2. A domain (recommended, not required)

`*.pages.dev` is enough to launch. A domain you control is better because the
Access session cookie is tied to the host, Stripe webhook URLs look
legitimate, and people trust it.

If you have one, add it to Cloudflare as a zone and give me the name. I will
create the DNS records and attach it to both the Pages app and the Access
application. If you need to buy one, Cloudflare Registrar sells at cost — but
do that from your own browser, not through me.

**How to get it to me:** just tell me the hostname, e.g. `rolesignal.dev`.

---

## 3. Stripe (needed for the paid plan)

A Stripe account takes about ten minutes: <https://dashboard.stripe.com> →
**Sign up**. You do not need to complete business verification to create
products or to test; you do need it before taking real money.

**What to create:** nothing yourself, if you give me the key. I will create
the recurring price, the product, the customer portal configuration and the
webhook endpoint, then read back the webhook signing secret.

**How to get it to me**

```sh
export STRIPE_SECRET_KEY='sk_test_...'   # or sk_live_...
```

Start with the **test** key. When you are ready for real money, swap to the
live key and I will re-point the webhook. I will not ask you for a card
number, a bank detail or a password at any point.

**What I need you to do later:** complete Stripe's business verification, and
decide the price. I have assumed $9/month on the basis of the original plan
panel — tell me if it should be different, or if there should be more than one
tier.

---

## 4. Telegram (needed for alerts)

1. Open Telegram and message **@BotFather**.
2. Send `/newbot`, give it a name and a username ending in `bot`.
3. BotFather replies with a **token**.

**How to get it to me**

```sh
export TELEGRAM_BOT_TOKEN='123456:ABC-DEF...'
export TELEGRAM_BOT_USERNAME='my_role_signal_bot'
```

I will register the webhook against the deployed domain, wire the deep link
that links a Telegram chat to an account, and build the delivery job.

The bot only ever reads `/start` messages and sends role matches. It does not
read your personal chats, and it does not message anyone who has not linked
their account.

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
3. **You**: Stripe key, Telegram token, domain name.
4. **Me**: price, webhook, bot webhook, live ingestion, first real run.
5. **Both**: point the sources at the registry, watch the first real feed
   come in, fix what the normalisation gets wrong.
6. **You**: Stripe business verification, then flip the paid plan on.

Step 1 is the only hard block. Everything else can be done in parallel once
the token lands.
