# FJ — general jobs and AI

Implemented 18 October 2026. See LAUNCH-STATUS.md for deployment results rather
than assuming that a configured provider has passed a live test.

## Browsing

- FJ - Find Jobs welcomes people looking for skill-matched work in Nigeria and
  worldwide. General professions are first-class categories alongside tech.
- `/jobs/:id` is a separate, deep-linkable page. Ordinary clicks use browser
  history; modified clicks open a normal link. Back restores the current result
  list, search, filters, loaded pages, tab and scroll during that browsing session.
- Listing rows have no verification, eligibility or infrastructure/source badges.
  One disclaimer makes the non-affiliation, non-verification and referral-only
  positioning explicit. A small original-listing link on each job page preserves
  publisher attribution without putting API/ATS labels on every row.
- Country, profession, arrangement and experience filters execute against D1
  before pagination; they are not restricted to the first 200 browser results.

## Content and sources

- HTML entities (including numeric Unicode) are decoded before tags are removed,
  including multiply escaped markup. Paragraphs/list items survive as plain text;
  scripts/styles and the specific Arbeitnow promotional footer do not.
- The publisher-provided MyJobMag individual-job feed and Hot Nigerian Jobs RSS
  add Nigerian occupations; We Work Remotely broadens international coverage. Accor/H&M/IKEA are
  additional ATS candidates in the registry; the first live attempt was blocked
  by their host’s robots policy, so no successful ingestion is claimed for them. An inaccessible or empty feed is reported by
  the registry, not replaced with fictional listings. Collected recruitment
  roundups and supplier/procurement notices are not treated as individual jobs.
- Reviewed publisher feed directory: https://www.myjobmag.com/feeds/
  and robots: https://www.myjobmag.com/robots.txt .
- Hot Nigerian Jobs permits search/reference in its robots content signals;
  training remains prohibited: https://www.hotnigerianjobs.com/robots.txt .
- Remotive is disabled and its existing rows excluded because its public terms
  restrict redistribution to third-party job sites. The parser is kept only for
  tests/operator-authorised use: https://github.com/remotive-com/remote-jobs-api .
- Reddit/social sources are not scraped behind authentication or added on the
  assumption that public visibility grants redistribution rights. An approved
  feed/API and its publisher permissions are prerequisites.
- The crawler keeps its established RoleSignalBot identity. Robots groups match
  that identity, not every unrelated bot; wildcard/query rules and explicit
  denials are honoured. Failed/forbidden robots requests fail closed.

## English descriptions and application advice

- Save a **rotated** `OPENROUTER_API_KEY` as an encrypted GitHub repository secret.
  Never paste it in chat, source, workflow inputs, `.env.example` or browser code.
  Deployment writes it as a Cloudflare Pages `secret_text`, not a build variable.
- Default model: `openai/gpt-4o-mini`; optional server binding
  `OPENROUTER_MODEL` overrides it. There is no client-side provider request.
- Language detection is local. Non-English/uncertain descriptions automatically
  request English translation on their job page. English text avoids a paid call.
  Translations are cached against the exact source description/model; a database
  lease avoids duplicate calls across simultaneous page views. Original wording
  remains available, and failed/unconfigured translations are labelled honestly.
- Application tips are requested explicitly, specific to the listing and listed
  skills. Only those skills and public job text are sent for advice, not a CV.
  Responses are bounded, validated, and cached by a hash of job content + skills;
  raw CVs/profiles are not stored in the advice cache. When AI is unavailable,
  role-specific listing-based guidance is clearly labelled instead.
- CV import uses OpenRouter when configured, otherwise Workers AI or deterministic
  keyword extraction. The file stays on the device, but choosing it sends
  extracted text for analysis; the UI explains that before file selection.
- Source descriptions/CV content are untrusted data in a separate model message,
  never system instructions. Output is JSON and rendered as text, not HTML.
  AI advice is not an employer requirement, eligibility decision or hiring promise.
- Limits default to 20 calls per caller/IP/day and 1,000 globally, shared with CV
  inference. Expensive routes also have request limits, timeouts and body limits.
  Translation/advice fail gracefully when keys, credits or quota are unavailable.

## Salary conversion

CC0-licensed open currency data includes NGN. Independently hosted mirrors are
tried before the central-bank fallback. Rates are validated and cached in memory
and D1 for 24 hours, exposing only the app's supported fiat currencies. Conversion
never invents a salary, changes the period or claims to be a bank quote. The
original amount and approximation marker remain; the reference date is available
under “About this estimate”, not in an API-branded results banner. Unavailable
currencies retain the employer's original amount.

Public data and CC0 license: https://github.com/fawazahmed0/exchange-api

## Selected Pages name

The user selected **fj-find-jobs.pages.dev**. Workflow and deployer target that
exact reserved project. The older project/database remain for safety; no silent
cross-origin transfer of browser-only data is claimed. See LAUNCH-STATUS.md for
the database-quota blocker and the distinction between UI publication and a fully
operational release. The other reserved name is not an additional live deployment.
