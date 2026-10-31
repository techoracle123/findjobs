import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { roleFamilyLabel } from '../../src/shared/taxonomy'

let signupCounter = 0

/**
 * Creates a fresh free account and signs this page in with it. The job
 * board sits behind a free account now, so board tests start here. Each
 * test gets its own account so saved jobs and progress never leak across.
 */
async function signUp(page: Page): Promise<string> {
  signupCounter += 1
  const email = `fj-browser-${Date.now()}-${signupCounter}@example.com`
  const response = await page.request.post('/api/auth/signup', {
    data: { name: 'Browser Test', email, password: 'browser test password' },
  })
  expect(response.ok()).toBe(true)
  return email
}

/** Runs an action and waits until its account write has reached the server. */
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
}

async function writeAndWait(
  page: Page,
  pathPart: string,
  method: string,
  action: () => Promise<void>,
): Promise<void> {
  const done = page.waitForResponse(
    (r) => r.url().includes(pathPart) && r.request().method() === method && r.ok(),
    { timeout: 20_000 },
  )
  await action()
  await done
}

for (const width of [320, 390, 414, 768, 1024, 1280, 1600, 1920]) {
  test(`job board stays aligned at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await signUp(page)
    await page.goto('/jobs')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Find work that fits your skills',
    )
    // The live corpus is large and a cold edge isolate assembles it on the
    // first request; allow for that rather than the 5s default.
    await expect(page.locator('.joblist .jobrow').first()).toBeVisible({ timeout: 20_000 })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await expect(page.getByText(/left today|Fast Apply/)).toHaveCount(0)
    await expect(page.getByText('Preview dataset')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Plan$/ })).toHaveCount(0)
    await expect(page.locator('.site-footer')).toBeVisible()
    const first = page.locator('.joblist .jobrow').first()
    await first.click()
    await expect(page).toHaveURL(/\/jobs\/[^/]+$/)
    await expect(page.locator('.detail__title')).toBeVisible()
    await expect(page.locator('.joblist')).toHaveCount(0)
    await expect(page.getByText('Unverified', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Needs checking', { exact: true })).toHaveCount(0)
    await expect(page.getByText(/left today|Fast Apply/)).toHaveCount(0)
    await expect(page.locator('.site-footer')).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    const apply = page.getByRole('link', { name: /Apply for this role|Open original listing/ })
    await expect(apply).toHaveAttribute('href', /^https?:\/\//)
    await page.screenshot({ path: testInfo.outputPath(`find-jobs-${width}.png`), fullPage: false })
    expect(errors).toEqual([])
  })
}

test('homepage explains the platform in plain words and sends people to sign up', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Thousands of job opportunities',
  )
  await expect(page.locator('.joblist')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'What decides if you get the job?' }),
  ).toBeVisible()
  await expect(page.locator('body')).toContainText('pay in dollars')
  await expect(page.locator('body')).toContainText('never ask you to pay money to get a job')
  await expect(
    page.getByRole('heading', { name: 'Pro helps you choose better and apply stronger' }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Try it free for 3 days' })).toBeVisible()
  await expect(page.locator('.home-price-grid')).toContainText('₦5,000/month')
  await expect(page.locator('.home-price-grid')).toContainText('₦40,000/year')
  await expect(page.locator('.home-price-grid')).toContainText('₦3,000/month')
  await expect(page.locator('body')).toContainText('Payments open in the next stage')
  await page
    .getByRole('link', { name: /Create a free account/ })
    .first()
    .click()
  await expect(page).toHaveURL(/\/auth\/signup/)
})

test('jobs send a visitor without an account to sign in first', async ({ page }) => {
  await page.goto('/jobs')
  await expect(page).toHaveURL(/\/auth\/login\?returnTo=%2Fjobs/)
  await expect(page.getByRole('heading', { name: 'Welcome back. Sign in.' })).toBeVisible()
})

test('first job card lands within one screen on a phone and search is full width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signUp(page)
  await page.goto('/jobs')
  await expect(page.locator('.joblist .jobrow').first()).toBeVisible()
  const firstCardY = await page.evaluate(
    () => document.querySelector('.jobrow')!.getBoundingClientRect().top + window.scrollY,
  )
  expect(firstCardY).toBeLessThanOrEqual(500) // measured 1146px before the revamp
  const searchWidth = await page.evaluate(
    () => document.querySelector('.searchbar')!.getBoundingClientRect().width,
  )
  const contentWidth = await page.evaluate(
    () => document.querySelector('.content.browse')!.getBoundingClientRect().width,
  )
  expect(searchWidth / contentWidth).toBeGreaterThan(0.9)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})

test('saving and preferences work with a free account', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signUp(page)
  await page.goto('/jobs')
  await expect(page.locator('.joblist .jobrow').first()).toBeVisible()
  await writeAndWait(page, '/api/account/saved', 'POST', () =>
    page.locator('.jobrow__save').first().click(),
  )
  await page.goto('/dashboard')
  await page
    .locator('.tabs')
    .getByRole('button', { name: /^Saved/ })
    .click()
  await expect(page.getByRole('heading', { name: 'Saved & applied' })).toBeVisible()
  await expect(page.locator('.saved-card')).toHaveCount(1)
  await page.goto('/profile')
  await page.getByLabel('Skills', { exact: true }).fill('Python')
  await writeAndWait(page, '/api/account/profile', 'PUT', () =>
    page.getByLabel('Skills', { exact: true }).press('Enter'),
  )
  await expect(page.getByRole('button', { name: 'Remove Python' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Remove Python' })).toBeVisible()
  await page.goto('/dashboard')
  await page
    .locator('.tabs')
    .getByRole('button', { name: /^Saved/ })
    .click()
  await expect(page.locator('.saved-card')).toHaveCount(1)
})

test('jobs API needs an account, serves real jobs to one, and rejects forged identity', async ({
  request,
}) => {
  // Local preview honours a documented dev header so the stack can be
  // exercised without Access; hosted modes must reject forged identity.
  const devHeaderWorks =
    (
      await request.get('/api/account', { headers: { 'x-dev-user-email': 'local@example.com' } })
    ).status() === 200
  // No account, no jobs: the list itself is behind sign-in now.
  expect((await request.get('/api/jobs?status=open&limit=20')).status()).toBe(401)
  expect((await request.get('/api/account')).status()).toBe(401)
  if (!devHeaderWorks)
    expect(
      (
        await request.get('/api/account', {
          headers: { 'x-dev-user-email': 'spoof@example.com', 'CF-Access-Jwt-Assertion': 'forged' },
        })
      ).status(),
    ).toBe(401)
  let headers: Record<string, string> = {}
  if (devHeaderWorks) headers = { 'x-dev-user-email': 'local@example.com' }
  else {
    const signup = await request.post('/api/auth/signup', {
      data: {
        name: 'API Test',
        email: `fj-api-${Date.now()}@example.com`,
        password: 'browser test password',
      },
    })
    expect(signup.ok()).toBe(true)
  }
  const response = await request.get('/api/jobs?status=open&limit=20', { headers })
  expect(response.ok()).toBe(true)
  const feed = await response.json()
  expect(feed.total).toBeGreaterThan(0)
  for (const job of feed.jobs) {
    // Hosted modes must never serve demo rows. The local preview uses the
    // bundled test fixture (is_demo=1) so the stack can run offline; that is
    // the same local-only scope as the dev header above.
    if (!devHeaderWorks) expect(job.isDemo).toBe(false)
    expect(job.jobStatus).toBe('open')
    expect(job.applyUrl || job.sourceUrl).toMatch(/^https?:\/\//)
    expect(job.lastSeenAt).toBeTruthy()
  }
  expect([401, 404]).toContain(
    (await request.post('/api/billing/confirm', { data: { plan: 'pro' } })).status(),
  ) // never a usable anonymous purchase
})

test('job deep links, browser history and scroll return to the results', async ({ page }) => {
  await signUp(page)
  await page.goto('/jobs')
  await expect(page.locator('.joblist .jobrow').first()).toBeVisible()
  const title = await page.locator('.joblist .jobrow .jobrow__title').nth(1).innerText()
  await page.locator('.joblist .jobrow').nth(1).click()
  const jobUrl = page.url()
  await expect(page.locator('.detail__title')).toHaveText(title)
  await page.goBack()
  await expect(page.locator('.joblist .jobrow').first()).toBeVisible()
  await page.locator('.joblist .jobrow').nth(1).click()
  await page.getByRole('button', { name: 'Back to results' }).click()
  await expect(page.locator('.joblist .jobrow').first()).toBeVisible()
  await expect(page).not.toHaveURL(jobUrl)
})

test('pricing is linked in the header and the page loads', async ({ page }) => {
  await page.goto('/')
  await page.locator('.topnav').getByRole('link', { name: 'Pricing' }).click()
  await expect(page).toHaveURL(/\/pricing$/)
  await expect(
    page.getByRole('heading', { name: 'Free to find and apply. Pro to apply stronger.' }),
  ).toBeVisible()
  const pricingTable = page.locator('.pricing-table')
  await expect(page.locator('.pricing-cards')).toContainText('Pro for Graduates')
  await expect(page.locator('.pricing-cards')).toContainText('₦5,000')
  await expect(page.locator('.pricing-cards')).toContainText('₦40,000')
  await expect(page.locator('.pricing-cards')).toContainText('₦3,000')
  await expect(pricingTable.getByText('Complete application packs')).toBeVisible()
  await expect(pricingTable.getByText('CV-to-job comparison')).toBeVisible()
  await expect(pricingTable.getByText('Before-you-apply check')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Try Pro free for 3 days' })).toBeVisible()
  await expect(page.locator('body')).toContainText(
    'One full CV analysis, three complete application packs',
  )
  await expect(page.getByRole('heading', { name: 'Payments open in the next stage' })).toBeVisible()
  await expect(page.getByText(/Employer accounts and direct job posting are paused/)).toBeVisible()
  await expect(page.getByText(/Desk\+/)).toHaveCount(0)
})

test('homepage and pricing explain Phase 2 cleanly at phone, tablet and desktop widths', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  for (const width of [320, 360, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Thousands of job opportunities',
    )
    await expect(page.locator('.home-price-grid')).toContainText('Pro for Graduates')
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: testInfo.outputPath(`phase2-home-${width}.png`) })

    await page.goto('/pricing')
    await expect(
      page.getByRole('heading', { name: 'Free to find and apply. Pro to apply stronger.' }),
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Try Pro free for 3 days' })).toBeVisible()
    await expect(page.locator('.pricing-table')).toContainText('Saved master CV')
    await expect(page.locator('.pricing-table')).toContainText('Smart Telegram alerts')
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: testInfo.outputPath(`phase2-pricing-${width}.png`) })
  }
})

test('employers page records interest only and offers no job posting', async ({ page }) => {
  await page.goto('/employers')
  await expect(page.getByRole('heading', { name: 'Employer posting is not open' })).toBeVisible()
  await expect(page.getByText('No direct job posting.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Record my interest' })).toBeVisible()
  await expect(page.getByText(/publish a vacancy in minutes|founding pricing/)).toHaveCount(0)
})

test('work type filter is visible and employers link is gone', async ({ page }) => {
  await signUp(page)
  await page.goto('/jobs')
  await page.getByRole('button', { name: /Work type/ }).click()
  await page.getByRole('button', { name: 'Remote', exact: true }).click()
  await expect(page).toHaveURL(/mode=remote/)
  await expect(page.getByText('What does the green circle mean?')).toHaveCount(0)
  await expect(page.locator('.topnav').getByText('For employers')).toHaveCount(0)
})

test('job detail shows a plain before-you-apply checklist and no AI panels', async ({ page }) => {
  await signUp(page)
  await page.goto('/jobs')
  await page.locator('.joblist .jobrow').first().click()
  await expect(page.getByRole('heading', { name: 'Before you apply' })).toBeVisible()
  await expect(page.locator('.detail')).toContainText(/Never pay anyone/)
  await expect(page.getByText(/Original listing ·/)).toHaveCount(0)
  await expect(page.getByText(/AI-generated|Get application tips/)).toHaveCount(0)
})

test('Pro tools prepare help on a job and unlock the salary guide', async ({ page }) => {
  test.setTimeout(180_000)
  await signUp(page)
  await page.goto('/jobs')
  await page.locator('.joblist .jobrow').first().click()
  await expect(page.getByRole('heading', { name: 'More help with this application' })).toBeVisible()

  const confirmed = await page.request.post('/api/billing/confirm', { data: { plan: 'pro' } })
  // The confirmation shortcut exists only in local/test. Hosted production
  // correctly refuses it, and the worker suite covers the entitled API path.
  if (!confirmed.ok()) return

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Pro tools for this job' })).toBeVisible()
  await page.getByText('Your saved application answers').click()
  await page.getByLabel('Full name').fill('Browser Test User')
  await page
    .getByLabel('Short summary of your experience')
    .fill('Relevant experience for this role.')
  await page.getByRole('button', { name: 'Save answers' }).click()
  await expect(page.getByText('Your application answers are saved.')).toBeVisible()

  await page.getByRole('button', { name: 'Prepare application' }).click()
  await expect(page.getByText('Your prepared application is ready below.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy cover letter' })).toBeVisible()

  await page.getByRole('button', { name: 'Compare my CV with this job' }).click()
  await expect(page.getByText(/Advert wording match|No percentage is available/)).toBeVisible()

  await page.getByRole('button', { name: 'Prepare me for interview' }).click()
  await expect(page.getByRole('heading', { name: 'Questions to practise' })).toBeVisible()

  await page.getByRole('button', { name: 'Show salary guide' }).first().click()
  await expect(
    page.getByText(/From [0-9]+ adverts|not enough real data|No matching live adverts/),
  ).toBeVisible()

  await page.goto('/dashboard?tab=salary')
  await expect(page.getByRole('heading', { name: 'Salary guide' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Show salary guide' })).toBeVisible()
})

test('3-day trial unlocks the saved CV, job tools and dashboard tools without a card', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000)
  const sampleCv = `Ada Lovelace
ada@example.com | +234 801 234 5678 | Lagos, Nigeria
https://example.com/ada

Professional Summary
Frontend engineer who builds accessible health dashboards with TypeScript, React, CSS and GraphQL.

Skills
TypeScript, React, CSS, GraphQL, accessibility, testing

Experience
Frontend Engineer, Example Health, Jan 2024 - Present
Built a GraphQL dashboard used by 25 clinic staff every week.
Reduced repeated form errors by 18% with clearer validation messages.
Responsible for fixing dashboards and helping the team.

Projects
Built a public appointment checker with React forms and clear error messages.

Education
BSc Computer Science, Example University, 2023
NYSC completed in 2024.`

  await page.setViewportSize({ width: 390, height: 844 })
  await signUp(page)
  await page.goto('/dashboard?tab=plan')
  await expect(page.getByRole('heading', { name: '3-day Pro free trial' })).toBeVisible()
  await expect(page.locator('body')).toContainText('No card, no automatic charge')
  await expect(page.locator('body')).toContainText('No payment provider is active today')
  await writeAndWait(page, '/api/pro/trial/start', 'POST', () =>
    page.getByRole('button', { name: 'Start my 3-day free trial' }).click(),
  )
  await expect(page.getByRole('heading', { name: 'What is left in your trial' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('phase2-plan-390.png') })

  await page.goto('/profile')
  const masterCv = page.locator('.master-cv-panel')
  await expect(masterCv.getByRole('heading', { name: 'Your saved master CV' })).toBeVisible()
  await masterCv.getByText('Paste CV text instead').click()
  await masterCv.getByLabel('CV text').fill(sampleCv)
  await masterCv.getByLabel(/I agree that FJ may save/).check()
  await writeAndWait(page, '/api/pro/cv', 'PUT', () =>
    masterCv.getByRole('button', { name: 'Analyse my CV' }).click(),
  )
  await expect(masterCv.getByRole('heading', { name: 'Fix these first' })).toBeVisible()
  await expect(masterCv.getByRole('button', { name: 'View saved text' })).toBeVisible()
  await expect(masterCv.getByRole('button', { name: 'Download report' })).toBeVisible()
  await expect(masterCv.getByRole('button', { name: 'Delete saved CV' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('phase2-master-cv-390.png') })

  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/jobs')
  await page.locator('.joblist .jobrow').first().click()
  await expect(page.getByText(/left today|Fast Apply/)).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Apply for this role/ })).toBeVisible()
  const proTools = page.locator('.pro-tools')
  await proTools.getByRole('button', { name: 'Run before-you-apply check' }).click()
  await expect(proTools).toContainText('not employer verification')
  await proTools.getByRole('button', { name: 'Prepare application' }).click()
  await expect(proTools.getByRole('button', { name: 'Copy cover letter' })).toBeVisible()
  await proTools.getByRole('button', { name: 'Compare my CV with this job' }).click()
  await expect(proTools).toContainText(/Advert wording match|No percentage is available/)
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('phase2-job-tools-1280.png') })

  await writeAndWait(page, '/api/account/saved', 'POST', () =>
    page.getByRole('button', { name: 'Save', exact: true }).click(),
  )
  await page.goto('/dashboard?tab=saved')
  const savedCard = page.locator('.saved-card').first()
  await expect(savedCard).toBeVisible()
  await writeAndWait(page, '/api/account/saved', 'POST', async () => {
    await savedCard.getByLabel('Stage').selectOption('interview')
  })
  const followUpDate = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
  await writeAndWait(page, '/api/account/saved', 'POST', () =>
    savedCard.getByLabel('Follow-up date').fill(followUpDate),
  )
  await page.reload()
  await expect(page.locator('.saved-card').first().getByLabel('Stage')).toHaveValue('interview')
  await expect(page.locator('.saved-card').first().getByLabel('Follow-up date')).toHaveValue(
    followUpDate,
  )
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('phase2-saved-pipeline-1280.png') })

  await page.goto('/dashboard?tab=alerts')
  await page.getByLabel('Alert name').fill('Smart frontend')
  await page.getByLabel('Keywords').fill('frontend')
  await page.getByLabel(/Pro smart alert/).check()
  await page.getByLabel('Minimum fit score').selectOption('55')
  await page.getByLabel('Countries (two-letter codes)').fill('NG')
  await page.getByLabel('Remote', { exact: true }).check()
  await page.getByLabel('Only jobs that state pay').check()
  await writeAndWait(page, '/api/account/alerts', 'POST', () =>
    page.getByRole('button', { name: 'Create alert' }).click(),
  )
  const smartAlert = page.locator('.alert-card', { hasText: 'Smart frontend' })
  await expect(smartAlert).toContainText('55+ fit score')
  await expect(smartAlert).toContainText('NG')
  await expect(smartAlert).toContainText('pay stated')
  await page.reload()
  await expect(page.locator('.alert-card', { hasText: 'Smart frontend' })).toContainText(
    'Smart alert',
  )
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('phase2-smart-alert-1280.png') })

  await page.goto('/dashboard?tab=tools')
  await expect(page.getByRole('heading', { name: 'Best matches and skill gaps' })).toBeVisible()
  await expect(page.locator('.best-match-card').first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Show repeated skill gaps' }).click()
  await expect(page.getByRole('heading', { name: 'Your repeated skill-gap plan' })).toBeVisible()
  await page
    .getByLabel('Full advert text')
    .fill(
      'Urgent guaranteed job. No interview needed. WhatsApp us now, pay a registration fee and send your BVN and bank account number today to start earning daily. This role has no official website application.',
    )
  await page.getByRole('button', { name: 'Check this advert' }).click()
  await expect(page.locator('body')).toContainText('Warning signs found')
  await expect(page.locator('body')).toContainText(
    'does not clearly state whether someone in Nigeria',
  )
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('phase2-dashboard-tools-1280.png') })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Best matches and skill gaps' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('phase2-dashboard-tools-390.png') })
})

test('Nigeria and general professions are selectable without repetitive badges', async ({
  page,
}) => {
  await signUp(page)
  const response = await page.request.get('/api/jobs?status=open&country=NG&limit=20', {
    timeout: 20000,
  })
  expect(response.ok()).toBe(true)
  const result = await response.json()
  expect(result.total).toBeGreaterThan(0)
  expect(
    result.jobs.every((job: { locationCountry: string }) => job.locationCountry === 'NG'),
  ).toBe(true)
  await page.goto('/jobs')
  await page.getByRole('button', { name: /^Location/ }).click()
  await page.getByRole('combobox', { name: 'Job location' }).fill('Nigeria')
  await page.getByRole('option', { name: /^Nigeria/ }).click()
  await expect(page.locator('.joblist .jobrow').first()).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: /^Profession/ }).click()
  await expect(page.getByRole('button', { name: /^Healthcare/ })).toHaveCount(1)
  await expect(page.getByText('Unverified', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Needs checking', { exact: true })).toHaveCount(0)
  await expect(page.locator('.joblist')).not.toContainText('Job Board API')
})

test('homepage is public, jobs are not, and sign-in is our own page', async ({ request }) => {
  test.setTimeout(150_000)
  const health = await (await request.get('/api/health')).json()
  expect(health).toEqual({ ok: true }) // never a stack map to anonymous callers
  const status = await (await request.get('/api/auth/status')).json()
  expect((await request.get('/')).ok()).toBe(true)
  expect(status.authenticated).toBe(false)
  // Plain totals stay public for the homepage; job data does not.
  expect([200, 503]).toContain(
    (await request.get('/api/public-stats', { timeout: 60_000 })).status(),
  )
  expect((await request.get('/api/jobs')).status()).toBe(401)
  // Sign-in is FJ's own page. No Cloudflare Access screen anywhere.
  const login = await request.get('/api/auth/login', { maxRedirects: 0 })
  expect([302, 303]).toContain(login.status())
  expect(login.headers().location).toMatch(/\/auth\/login/)
  expect(login.headers().location).not.toMatch(/cloudflareaccess/)
  expect((await request.get('/')).ok()).toBe(true)
})

test('sign up, sign in and forgot password work on small phones', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 320, height: 750 })
  const email = `fj-auth-${Date.now()}@example.com`
  // Create the account with email and password.
  await page.goto('/auth/signup')
  await expect(page.getByRole('heading', { name: 'Create your free account' })).toBeVisible()
  await page.getByLabel('Your name').fill('Auth Tester')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill('my first password')
  // There is clear space between the password box and the button.
  const inputBox = await page.getByLabel('Password', { exact: true }).boundingBox()
  const buttonBox = await page.getByRole('button', { name: 'Create free account' }).boundingBox()
  expect(inputBox && buttonBox && buttonBox.y - (inputBox.y + inputBox.height)).toBeGreaterThan(12)
  await page.getByRole('button', { name: 'Create free account' }).click()
  await expect(page).toHaveURL(/\/jobs/)
  await expect(page.locator('.joblist .jobrow').first()).toBeVisible({ timeout: 60_000 })
  // Sign out from the account page, then a wrong password is refused plainly.
  await page.goto('/auth/login')
  await expect(page.getByRole('heading', { name: 'You are signed in' })).toBeVisible()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back. Sign in.' })).toBeVisible()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill('the wrong password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('do not match')
  // Forgot password asks for the email and confirms plainly.
  await page.getByRole('link', { name: 'Forgot password?' }).click()
  await expect(page).toHaveURL(/\/auth\/recovery/)
  await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible()
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(page.locator('.auth-card')).toContainText('we have sent a reset link')
  // The right password signs in and lands on the jobs.
  await page.getByRole('link', { name: 'Back to sign in' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill('my first password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/jobs/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})

test('match rings are visible on phones and never show a numeric grade', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signUp(page)
  await page.goto('/profile')
  await page.getByLabel('Skills', { exact: true }).fill('Python')
  await writeAndWait(page, '/api/account/profile', 'PUT', () =>
    page.getByLabel('Skills', { exact: true }).press('Enter'),
  )
  await writeAndWait(page, '/api/account/profile', 'PUT', async () => {
    await page.getByLabel('preferred profession', { exact: false }).selectOption('administration')
  })
  await page.goto('/jobs')
  await expect(page.locator('.scorebadge').first()).toBeVisible()
  const ringText = await page.locator('.joblist').first().innerText()
  expect(ringText).not.toMatch(/\b\d{1,3}%\b/)
  // The green-circle explainer was removed by product decision.
  await expect(page.locator('.match-help')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})

test('expanded live corpus is paginated, regularly refreshed and opens complete listings', async ({
  request,
}, testInfo) => {
  const status = await request.get('/api/feed-status', { timeout: 45000 })
  if (!status.ok() && !String(testInfo.project.use.baseURL).startsWith('https://'))
    test.skip(
      true,
      'Isolated preview uses a small genuine-source D1 dataset, not the production snapshot.',
    )
  expect(status.ok()).toBe(true)
  const metadata = await status.json()
  expect(metadata.total).toBeGreaterThanOrEqual(2000)
  expect(metadata.refreshHours).toBe(12)
  expect(metadata.sourceCount).toBeGreaterThan(10)
  expect(Date.now() - Date.parse(metadata.updatedAt)).toBeLessThan(36 * 3600000)
  // Job data needs an account now; sign this request context in.
  const signup = await request.post('/api/auth/signup', {
    data: {
      name: 'Corpus Test',
      email: `fj-corpus-${Date.now()}@example.com`,
      password: 'browser test password',
    },
  })
  expect(signup.ok()).toBe(true)
  const offset = Math.min(5000, Math.floor(metadata.total / 2))
  const response = await request.get(`/api/jobs?status=open&offset=${offset}&limit=2`, {
    timeout: 45000,
  })
  expect(response.ok()).toBe(true)
  const feed = await response.json()
  expect(feed.dataSource).toBe('public-snapshot')
  expect(feed.total).toBe(metadata.total)
  expect(feed.jobs).toHaveLength(2)
  expect(feed.jobs[0].isDemo).toBe(false)
  expect(feed.jobs[0].descriptionPreview).toBe(true)
  const detail = await request.get(`/api/jobs/${feed.jobs[0].id}`, { timeout: 45000 })
  expect(detail.ok()).toBe(true)
  const { job } = await detail.json()
  expect(job.descriptionPreview).not.toBe(true)
  expect(job.description.length).toBeGreaterThanOrEqual(feed.jobs[0].description.length)
  expect(job.applyUrl || job.sourceUrl).toMatch(/^https?:\/\//)
})

test('personal monthly progress counts confirmations, not link clicks', async ({ page }) => {
  await signUp(page)
  await page.goto('/jobs')
  await page.locator('.joblist .jobrow').first().click()
  await writeAndWait(page, '/api/account/saved', 'POST', () =>
    page.getByRole('button', { name: 'Mark as applied', exact: true }).click(),
  )
  await page.getByRole('button', { name: 'Back to results' }).click()
  await page.goto('/dashboard')
  await page.locator('.tabs').getByRole('button', { name: 'Progress', exact: true }).click()
  await expect(
    page.locator('.progress-panel .stat-grid > div').first().locator('strong'),
  ).toHaveText('1')
  await expect(page.locator('.progress-panel')).toContainText('no number guarantees')
  await page.reload()
  await expect(
    page.locator('.progress-panel .stat-grid > div').first().locator('strong'),
  ).toHaveText('1')
})

test('changing filters does not refetch account, health or exchange rates', async ({ page }) => {
  await signUp(page)
  await page.goto('/jobs')
  await expect(page.locator('.joblist .jobrow').first()).toBeVisible()
  const metadata: string[] = []
  page.on('request', (request) => {
    if (/\/api\/(health|rates|account)(?:[?]|$)/.test(request.url())) metadata.push(request.url())
  })
  await page.getByRole('button', { name: /^Profession/ }).click()
  await page
    .locator('.chip-popover')
    .getByRole('button', { name: /Cybersecurity/ })
    .click()
  await page.waitForTimeout(700)
  await page
    .getByRole('button', { name: /Cybersecurity|Profession/ })
    .first()
    .click()
  await page
    .locator('.chip-popover')
    .getByRole('button', { name: /Data analytics/ })
    .click()
  await page.waitForTimeout(700)
  expect(metadata).toEqual([])
  // The chip reflects the specialist category chosen from the popover.
  await expect(page.getByRole('button', { name: /Data analytics/ }).first()).toBeVisible()
})

test('switching accounts never reuses another person’s browser profile', async ({ page }) => {
  let identity = 'alice',
    authenticated = true
  await page.route('**/api/account', async (route) => {
    if (!authenticated)
      return route.fulfill({ status: 401, json: { error: { message: 'Sign in required' } } })
    return route.fulfill({
      json: {
        user: { id: identity, email: identity + '@example.com' },
        profile: {
          skills: [identity === 'alice' ? 'AlicePrivateSkill' : 'BobPrivateSkill'],
          targetRoleFamilies: [],
          targetSeniority: [],
          preferredWorkModes: [],
          workCountry: '',
        },
        saved: [],
        alerts: [],
        entitlements: [],
      },
    })
  })
  await page.route('**/api/account/activity?*', (route) =>
    route.fulfill({
      json: {
        thisMonth: identity === 'alice' ? 7 : 2,
        totalApplied: identity === 'alice' ? 7 : 2,
        undated: 0,
        saved: 0,
      },
    }),
  )
  await page.goto('/profile')
  await expect(page.locator('.panel').first()).toContainText('AlicePrivateSkill')
  identity = 'bob'
  await page.evaluate(() =>
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'rolesignal:account-owner',
        newValue: JSON.stringify('bob'),
      }),
    ),
  )
  await expect(page.locator('.panel').first()).toContainText('BobPrivateSkill')
  await expect(page.locator('body')).not.toContainText('AlicePrivateSkill')
  await page.goto('/dashboard')
  await expect(page.locator('.stat-grid strong').first()).toHaveText('2')
  authenticated = false
  await page.reload()
  // With no account the app sends you to sign in, showing nobody's data.
  await expect(page).toHaveURL(/\/auth\/login/)
  await expect(page.locator('body')).not.toContainText('BobPrivateSkill')
  await expect(page.locator('body')).not.toContainText('AlicePrivateSkill')
})

test('country search supports code lookup and keyboard selection', async ({ page }) => {
  await signUp(page)
  await page.goto('/jobs')
  await page.getByRole('button', { name: /^Location/ }).click()
  const country = page.getByRole('combobox', { name: 'Job location' })
  await country.fill('NG')
  await country.press('Enter')
  await expect(country).toHaveValue('Nigeria')
  await expect(page.getByText('Listings explicitly located in Nigeria.')).toBeVisible()
  await country.fill('United King')
  await country.press('Enter')
  await expect(country).toHaveValue('United Kingdom')
})

test('What and Where search suggestions are keyboard navigable', async ({ page }) => {
  await signUp(page)
  await page.goto('/jobs')
  const what = page.getByRole('combobox', { name: 'What' })
  await what.click()
  await expect(what).toHaveAttribute('aria-expanded', 'true')
  await what.fill('data')
  await what.press('ArrowDown')
  await what.press('Enter')
  await expect(what).not.toHaveValue('')
  const where = page.getByRole('combobox', { name: 'Where' })
  await where.click()
  await where.fill('Lagos')
  await expect(page.getByRole('option', { name: /Lagos/ }).first()).toBeVisible()
  await where.press('ArrowDown')
  await where.press('Enter')
  await expect(page).toHaveURL(/loc=|country=/)
})

test('filter combinations are shareable and survive reload', async ({ page }) => {
  test.setTimeout(180_000)
  // Pick a profession that exists in whatever real corpus is loaded. The
  // probe retries: right after a deploy the public snapshot republish can
  // make the first request slow (observed >60s on 2026-10-27).
  await signUp(page)
  let facets: { professions: Record<string, number> } | undefined
  await expect
    .poll(
      async () => {
        const response = await page.request.get('/api/jobs?status=open&limit=1', {
          timeout: 20_000,
        })
        if (!response.ok()) return false
        facets = ((await response.json()) as { facets: typeof facets }).facets
        return facets !== undefined
      },
      { timeout: 90_000, intervals: [1000, 2000, 5000] },
    )
    .toBe(true)
  const profession = Object.entries(facets!.professions)
    .filter(([id, count]) => id !== 'unknown' && count > 0)
    .sort((a, b) => b[1] - a[1])[0]?.[0]
  expect(profession).toBeTruthy()
  await page.goto('/jobs')
  await page.getByRole('button', { name: /^Profession/ }).click()
  await page
    .locator('.chip-popover')
    .getByRole('button', { name: roleFamilyLabel(profession!), exact: true })
    .click()
  await expect(page).toHaveURL(/role=/)
  const url = page.url()
  await expect(page.locator('.jobrow__title').first()).toBeVisible({ timeout: 20_000 })
  const firstTitle = await page.locator('.jobrow__title').first().innerText()
  await page.reload()
  await expect(page).toHaveURL(/role=/)
  await expect(page.locator('.jobrow__title').first()).toHaveText(firstTitle, { timeout: 20_000 })
  await page.goto(url)
  await expect(page.locator('.jobrow__title').first()).toHaveText(firstTitle, { timeout: 20_000 })
})

test('pagination moves through 20-result pages and keeps the page in the URL', async ({ page }) => {
  await signUp(page)
  await page.goto('/jobs')
  await expect(page.locator('.joblist .jobrow').first()).toBeVisible()
  await page.locator('.pagination').getByRole('button', { name: '2', exact: true }).click()
  await expect(page).toHaveURL(/page=2/)
  await expect(page.locator('.joblist .jobrow').first()).toBeVisible()
  await page.reload()
  await expect(page).toHaveURL(/page=2/)
})

test('footer is present on every route with the safety links', async ({ page }) => {
  await signUp(page)
  for (const path of ['/', '/jobs', '/dashboard', '/profile', '/about', '/auth/login']) {
    await page.goto(path)
    const footer = page.locator('.site-footer')
    await expect(footer).toBeVisible()
    await expect(footer.getByRole('link', { name: 'How to spot a job scam' })).toBeVisible()
  }
})

test('no serious accessibility violations on the main routes', async ({ page }) => {
  await signUp(page)
  for (const path of [
    '/',
    '/auth/login',
    '/pricing',
    '/jobs',
    '/profile',
    '/dashboard',
    '/dashboard?tab=tools',
    '/dashboard?tab=plan',
  ]) {
    await page.goto(path)
    await expect(page.locator('h1')).toBeVisible()
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    const serious = results.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact ?? ''),
    )
    expect(serious.map((violation) => `${path}: ${violation.id} — ${violation.help}`)).toEqual([])
  }
})

test('UI controls with no backing data stay hidden unless admin override', async ({ page }) => {
  // Judge the page by the facets of the first home-feed response it
  // applied (limit=20): coverage is computed over the matched subset, and
  // the preview corpus keeps warming while the suite runs, so any later
  // or narrower snapshot can sit on the other side of the 0.6 threshold.
  await signUp(page)
  const feedResponse = page.waitForResponse(
    (r) =>
      r.url().includes('/api/jobs?') &&
      r.url().includes('limit=20') &&
      r.request().method() === 'GET',
  )
  await page.goto('/jobs')
  const facets = (await (await feedResponse).json()).facets
  expect(facets?.coverage).toBeTruthy()
  await expect(page.locator('.joblist .jobrow').first()).toBeVisible()
  // Work type is always visible by product decision, whatever the coverage.
  // Chips may exist in both the filter bar and the mobile drawer (>= 1).
  expect(await page.getByRole('button', { name: /Work type/ }).count()).toBeGreaterThanOrEqual(1)
  const experienceCount = await page.getByRole('button', { name: /Experience/ }).count()
  if (facets.coverage.seniority < 0.6) expect(experienceCount).toBe(0)
  else expect(experienceCount).toBeGreaterThanOrEqual(1)
  if (facets.coverage.salary < 0.6) await expect(page.locator('#sort option')).toHaveCount(2)
  // The admin override always exposes every control for testing.
  await page.goto('/jobs?adminControls=1')
  await expect(page.locator('.joblist .jobrow').first()).toBeVisible({ timeout: 20_000 })
  expect(await page.getByRole('button', { name: /Work type/ }).count()).toBeGreaterThanOrEqual(1)
  expect(await page.getByRole('button', { name: /Verified only/ }).count()).toBeGreaterThanOrEqual(
    1,
  )
})
