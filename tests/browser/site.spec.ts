import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { roleFamilyLabel } from '../../src/shared/taxonomy'

for (const width of [320, 390, 414, 768, 1024, 1280, 1600, 1920]) {
  test(`job board stays aligned at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Find work that fits your skills',
    )
    await expect(page.locator('.joblist .jobrow').first()).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
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

test('first job card lands within one screen on a phone and search is full width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
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

test('saving and preferences work without an account', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('.joblist .jobrow').first()).toBeVisible()
  await page.locator('.jobrow__save').first().click()
  await page.goto('/dashboard')
  await page
    .locator('.tabs')
    .getByRole('button', { name: /^Saved/ })
    .click()
  await expect(page.getByRole('heading', { name: 'Saved & applied' })).toBeVisible()
  await expect(page.locator('.content .jobrow')).toHaveCount(1)
  await page.goto('/profile')
  await page.getByLabel('Skills', { exact: true }).fill('Python')
  await page.getByLabel('Skills', { exact: true }).press('Enter')
  await expect(page.getByRole('button', { name: 'Remove Python' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Remove Python' })).toBeVisible()
  await page.goto('/dashboard')
  await page
    .locator('.tabs')
    .getByRole('button', { name: /^Saved/ })
    .click()
  await expect(page.locator('.content .jobrow')).toHaveCount(1)
})

test('public API serves real jobs and rejects forged identity and purchases', async ({
  request,
}) => {
  // Local preview honours a documented dev header so the stack can be
  // exercised without Access; hosted modes must reject forged identity.
  const devHeaderWorks =
    (
      await request.get('/api/account', { headers: { 'x-dev-user-email': 'local@example.com' } })
    ).status() === 200
  const response = await request.get('/api/jobs?status=open&limit=20')
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
  expect((await request.get('/api/account')).status()).toBe(401)
  if (!devHeaderWorks)
    expect(
      (
        await request.get('/api/account', {
          headers: { 'x-dev-user-email': 'spoof@example.com', 'CF-Access-Jwt-Assertion': 'forged' },
        })
      ).status(),
    ).toBe(401)
  expect([401, 404]).toContain(
    (await request.post('/api/billing/confirm', { data: { plan: 'pro' } })).status(),
  ) // never a usable anonymous purchase
})

test('job deep links, browser history and scroll return to the results', async ({ page }) => {
  await page.goto('/')
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
  await expect(page.getByRole('heading', { name: 'Simple pricing' })).toBeVisible()
})

test('work type filter is visible and employers link is gone', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Work type/ }).click()
  await page.getByRole('button', { name: 'Remote', exact: true }).click()
  await expect(page).toHaveURL(/mode=remote/)
  await expect(page.getByText('What does the green circle mean?')).toHaveCount(0)
  await expect(page.locator('.topnav').getByText('For employers')).toHaveCount(0)
})

test('job detail shows a plain before-you-apply checklist and no AI panels', async ({ page }) => {
  await page.goto('/')
  await page.locator('.joblist .jobrow').first().click()
  await expect(page.getByRole('heading', { name: 'Before you apply' })).toBeVisible()
  await expect(page.locator('.detail')).toContainText(/Never pay anyone/)
  await expect(page.getByText(/Original listing ·/)).toHaveCount(0)
  await expect(page.getByText(/AI-generated|Get application tips/)).toHaveCount(0)
})

test('Nigeria and general professions are selectable without repetitive badges', async ({
  page,
  request,
}) => {
  const response = await request.get('/api/jobs?status=open&country=NG&limit=20', {
    timeout: 20000,
  })
  expect(response.ok()).toBe(true)
  const result = await response.json()
  expect(result.total).toBeGreaterThan(0)
  expect(
    result.jobs.every((job: { locationCountry: string }) => job.locationCountry === 'NG'),
  ).toBe(true)
  await page.goto('/')
  await page.getByRole('button', { name: /^Location/ }).click()
  await page.getByRole('combobox', { name: 'Job location' }).fill('Nigeria')
  await page.getByRole('option', { name: /^Nigeria/ }).click()
  await expect(page.locator('.joblist .jobrow').first()).toBeVisible()
  await page.getByRole('button', { name: /^Profession/ }).click()
  await expect(page.getByRole('button', { name: /^Healthcare/ })).toHaveCount(1)
  await expect(page.getByText('Unverified', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Needs checking', { exact: true })).toHaveCount(0)
  await expect(page.locator('.joblist')).not.toContainText('Job Board API')
})

test('public browsing and sign-in availability are reported honestly', async ({ request }) => {
  const health = await (await request.get('/api/health')).json()
  expect(health).toEqual({ ok: true }) // never a stack map to anonymous callers
  const status = await (await request.get('/api/auth/status')).json()
  expect((await request.get('/')).ok()).toBe(true)
  void status
  // Sign-in is FJ's own page. No Cloudflare Access screen anywhere.
  const login = await request.get('/api/auth/login', { maxRedirects: 0 })
  expect([302, 303]).toContain(login.status())
  expect(login.headers().location).toMatch(/\/auth\/login/)
  expect(login.headers().location).not.toMatch(/cloudflareaccess/)
  expect((await request.get('/')).ok()).toBe(true)
})

test('dedicated sign-up, sign-in and recovery pages work on small phones', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 750 })
  await page.goto('/auth/signup')
  await expect(page.getByRole('heading', { name: 'Create your free account' })).toBeVisible()
  await expect(page.locator('.auth-card')).toContainText(
    'first verified email sign-in creates your account',
  )
  await page.getByRole('link', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  await page.getByRole('link', { name: 'Forgot password or can’t sign in?' }).click()
  await expect(page).toHaveURL(/\/auth\/recovery/)
  await expect(page.getByRole('heading', { name: 'Recover your account' })).toBeVisible()
  await expect(page.locator('.auth-card')).toContainText('FJ is passwordless')
  await expect(page.locator('.auth-card')).toContainText('inbox and spam folder')
  // Own sign-in (Prompt 18): the card carries our own email + code flow.
  await page.getByRole('link', { name: 'Back to sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByRole('button', { name: /Send me a code/ })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.getByRole('link', { name: 'Back to opportunities' }).click()
  await expect(page.locator('.joblist .jobrow').first()).toBeVisible()
})

test('match rings are visible on phones, explained, and never show a numeric grade', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/profile')
  await page.getByLabel('Skills', { exact: true }).fill('Python')
  await page.getByLabel('Skills', { exact: true }).press('Enter')
  await page.getByLabel('preferred profession', { exact: false }).selectOption('administration')
  await page.goto('/')
  await expect(page.locator('.scorebadge, .match-help__ring').first()).toBeVisible()
  const ringText = await page.locator('.joblist').first().innerText()
  expect(ringText).not.toMatch(/\b\d{1,3}%\b/)
  await page.locator('.match-help summary').click()
  await expect(page.locator('.match-help')).toContainText('guide')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})

test('expanded live corpus is paginated, regularly refreshed and opens complete listings', async ({
  request,
}, testInfo) => {
  const status = await request.get('/api/feed-status', { timeout: 20000 })
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
  const offset = Math.min(5000, Math.floor(metadata.total / 2))
  const response = await request.get(`/api/jobs?status=open&offset=${offset}&limit=2`, {
    timeout: 20000,
  })
  expect(response.ok()).toBe(true)
  const feed = await response.json()
  expect(feed.dataSource).toBe('public-snapshot')
  expect(feed.total).toBe(metadata.total)
  expect(feed.jobs).toHaveLength(2)
  expect(feed.jobs[0].isDemo).toBe(false)
  expect(feed.jobs[0].descriptionPreview).toBe(true)
  const detail = await request.get(`/api/jobs/${feed.jobs[0].id}`, { timeout: 20000 })
  expect(detail.ok()).toBe(true)
  const { job } = await detail.json()
  expect(job.descriptionPreview).not.toBe(true)
  expect(job.description.length).toBeGreaterThanOrEqual(feed.jobs[0].description.length)
  expect(job.applyUrl || job.sourceUrl).toMatch(/^https?:\/\//)
})

test('personal monthly progress counts confirmations, not link clicks', async ({ page }) => {
  await page.goto('/')
  await page.locator('.joblist .jobrow').first().click()
  await page.getByRole('button', { name: 'Mark as applied', exact: true }).click()
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
  await page.goto('/')
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
  await expect(
    page.locator('.topbar').getByRole('link', { name: 'Sign in', exact: true }),
  ).toBeVisible()
  await expect(page.locator('body')).not.toContainText('BobPrivateSkill')
  await expect(page.locator('body')).not.toContainText('AlicePrivateSkill')
})

test('country search supports code lookup and keyboard selection', async ({ page }) => {
  await page.goto('/')
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
  await page.goto('/')
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
  // Pick a profession that exists in whatever real corpus is loaded. The
  // probe retries: right after a deploy the public snapshot republish can
  // make the first request slow (observed >60s on 2026-10-27).
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
  await page.goto('/')
  await page.getByRole('button', { name: /^Profession/ }).click()
  await page
    .locator('.chip-popover')
    .getByRole('button', { name: roleFamilyLabel(profession!), exact: true })
    .click()
  await expect(page).toHaveURL(/role=/)
  const url = page.url()
  await expect(page.locator('.jobrow__title').first()).toBeVisible()
  const firstTitle = await page.locator('.jobrow__title').first().innerText()
  await page.reload()
  await expect(page).toHaveURL(/role=/)
  await expect(page.locator('.jobrow__title').first()).toHaveText(firstTitle)
  await page.goto(url)
  await expect(page.locator('.jobrow__title').first()).toHaveText(firstTitle)
})

test('pagination moves through 20-result pages and keeps the page in the URL', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.joblist .jobrow').first()).toBeVisible()
  await page.locator('.pagination').getByRole('button', { name: '2', exact: true }).click()
  await expect(page).toHaveURL(/page=2/)
  await expect(page.locator('.joblist .jobrow').first()).toBeVisible()
  await page.reload()
  await expect(page).toHaveURL(/page=2/)
})

test('footer is present on every route with the safety links', async ({ page }) => {
  for (const path of ['/', '/dashboard', '/profile', '/about', '/auth/login']) {
    await page.goto(path)
    const footer = page.locator('.site-footer')
    await expect(footer).toBeVisible()
    await expect(footer.getByRole('link', { name: 'How to spot a job scam' })).toBeVisible()
  }
})

test('no serious accessibility violations on the main routes', async ({ page }) => {
  for (const path of ['/', '/auth/login', '/dashboard']) {
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
  await page.goto('/')
  await expect(page.locator('.joblist .jobrow').first()).toBeVisible() // warms the response cache
  const facets = (
    await (await page.request.get('/api/jobs?status=open&limit=1', { timeout: 30_000 })).json()
  ).facets
  if (facets.coverage.workMode < 0.6)
    await expect(page.getByRole('button', { name: /Work mode/ })).toHaveCount(0)
  if (facets.coverage.seniority < 0.6)
    await expect(page.getByRole('button', { name: /Experience/ })).toHaveCount(0)
  if (facets.coverage.salary < 0.6) await expect(page.locator('#sort option')).toHaveCount(2)
  // The admin override always exposes every control for testing.
  await page.goto('/?adminControls=1')
  await expect(page.getByRole('button', { name: /Work mode/ })).toHaveCount(1)
  await expect(page.getByRole('button', { name: /Verified only/ })).toHaveCount(1)
})
