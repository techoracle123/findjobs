import { test, expect } from '@playwright/test'

for (const width of [320, 390, 414, 768, 1024, 1280, 1600, 1920]) {
  test(`job board stays aligned at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Welcome')
    await expect(page.locator('.joblist .jobrow').first()).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await expect(page.getByText('Preview dataset')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Plan$/ })).toHaveCount(0)
    const first = page.locator('.joblist .jobrow').first()
    await first.click()
    await expect(page).toHaveURL(/\/jobs\/[^/]+$/)
    await expect(page.locator('.detail__title')).toBeVisible()
    await expect(page.locator('.joblist')).toHaveCount(0)
    await expect(page.getByText('Unverified', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Needs checking', { exact: true })).toHaveCount(0)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    const apply = page.getByRole('link', { name: 'Apply for this role' })
    await expect(apply).toHaveAttribute('href', /^https?:\/\//)
    await page.screenshot({ path: testInfo.outputPath(`find-jobs-${width}.png`), fullPage: false })
    expect(errors).toEqual([])
  })
}

test('saving, preferences, and reload work without an account', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('.joblist .jobrow').first()).toBeVisible()
  await page.locator('.joblist .jobrow').first().click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('button', { name: 'Back to results' }).click()
  await page
    .locator('.tabs')
    .getByRole('button', { name: /^Saved/ })
    .click()
  await expect(page.getByRole('heading', { name: 'Saved & applied' })).toBeVisible()
  await expect(page.locator('.content .jobrow')).toHaveCount(1)
  await page.getByRole('button', { name: 'Your preferences & filters' }).click()
  await page.getByLabel('Skills', { exact: true }).fill('Python')
  await page.getByLabel('Skills', { exact: true }).press('Enter')
  await expect(page.getByRole('button', { name: 'Remove Python' })).toBeVisible()
  await page.reload()
  await page
    .locator('.tabs')
    .getByRole('button', { name: /^Saved/ })
    .click()
  await expect(page.locator('.content .jobrow')).toHaveCount(1)
})

test('public API serves real jobs and rejects forged identity and purchases', async ({
  request,
}) => {
  const response = await request.get('/api/jobs?status=open&limit=20')
  expect(response.ok()).toBe(true)
  const feed = await response.json()
  expect(feed.total).toBeGreaterThan(0)
  for (const job of feed.jobs) {
    expect(job.isDemo).toBe(false)
    expect(job.jobStatus).toBe('open')
    expect(job.applyUrl || job.sourceUrl).toMatch(/^https?:\/\//)
    expect(job.lastSeenAt).toBeTruthy()
  }
  expect((await request.get('/api/account')).status()).toBe(401)
  expect(
    (
      await request.get('/api/account', {
        headers: { 'x-dev-user-email': 'spoof@example.com', 'CF-Access-Jwt-Assertion': 'forged' },
      })
    ).status(),
  ).toBe(401)
  expect((await request.post('/api/billing/confirm', { data: { plan: 'pro' } })).status()).toBe(404)
})

test('job deep links, browser history, filters and scroll return to the results', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('.joblist .jobrow').first()).toBeVisible()
  const title = await page.locator('.joblist .jobrow .jobrow__title').nth(6).innerText()
  await page.locator('.joblist .jobrow').nth(6).click()
  const jobUrl = page.url()
  await expect(page.locator('.detail__title')).toHaveText(title)
  await page.goBack()
  await expect(page.locator('.joblist .jobrow').nth(6)).toBeInViewport()
  await page.goForward()
  await expect(page.locator('.detail__title')).toHaveText(title)
  await page.reload()
  await expect(page.locator('.detail__title')).toHaveText(title)
  await page.getByRole('button', { name: 'Back to results' }).click()
  await expect(page).not.toHaveURL(/\/jobs\//)
  await page.goto(jobUrl)
  await expect(page.locator('.detail__title')).toHaveText(title)
})

test('application advice is usable with or without an AI key', async ({ page }) => {
  await page.goto('/')
  await page.locator('.joblist .jobrow').first().click()
  await page.getByRole('button', { name: 'Get application tips' }).click()
  await expect(page.locator('.application-tips li').first()).toBeVisible({ timeout: 35000 })
  expect(await page.locator('.application-tips li').count()).toBeGreaterThanOrEqual(2)
  await expect(page.locator('.application-tips')).not.toContainText('<p>')
  await expect(page.locator('.detail__text')).not.toContainText(
    /<\/?(?:div|p|ul|li|span)\b|&lt;|Find more English Speaking Jobs/,
  )
})

test('Nigeria and general professions are selectable without repetitive badges', async ({
  page,
  request,
}) => {
  const response = await request.get('/api/jobs?status=open&country=NG&limit=20')
  expect(response.ok()).toBe(true)
  const result = await response.json()
  expect(result.total).toBeGreaterThan(0)
  expect(
    result.jobs.every((job: { locationCountry: string }) => job.locationCountry === 'NG'),
  ).toBe(true)
  await page.goto('/')
  await page.getByLabel('Job location', { exact: true }).selectOption('NG')
  await expect(page.locator('.joblist .jobrow').first()).toBeVisible()
  await expect(
    page
      .getByLabel('Profession', { exact: true })
      .getByRole('option', { name: 'Healthcare', exact: true }),
  ).toHaveCount(1)
  await expect(page.getByText('Unverified', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Needs checking', { exact: true })).toHaveCount(0)
  await expect(page.locator('.joblist')).not.toContainText('Job Board API')
})

test('public browsing and sign-in availability are reported honestly', async ({ request }) => {
  const health = await (await request.get('/api/health')).json()
  expect((await request.get('/')).ok()).toBe(true)
  const login = await request.get('/api/auth/login', { maxRedirects: 0 })
  if (!health.accessConfigured) {
    expect(login.status()).toBe(503)
    expect((await login.json()).error).toBe('sign_in_unavailable')
    test.info().annotations.push({
      type: 'external-blocker',
      description:
        'Cloudflare Access is NOT operational; see the deployment permission diagnostics. This checks the honest unavailable state, not successful login.',
    })
    return
  }
  expect([302, 303]).toContain(login.status())
  expect(login.headers().location).toMatch(/^https:\/\/[^/]+\.cloudflareaccess\.com\//)
  expect((await request.get('/')).ok()).toBe(true)
})

test('sign-up, sign-in and passwordless recovery are clear on small phones', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Sign up', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Create your free account' })).toBeVisible()
  await expect(dialog).toContainText('Your first email sign-in creates your account')
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Forgot password or can’t sign in?' }).click()
  await expect(dialog).toContainText('There isn’t one to reset')
  await expect(dialog).toContainText('check your inbox and spam folder')
  const health = await (await page.request.get('/api/health')).json()
  if (health.accessLoginUrl) {
    await expect(dialog.getByRole('link', { name: 'Get a new sign-in code' })).toHaveAttribute(
      'href',
      '/api/auth/login?returnTo=%2F',
    )
  } else {
    await expect(dialog.getByRole('status')).toContainText('temporarily unavailable')
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign up', exact: true })).toBeFocused()
})

test('match rings are visible on phones, explained, and never show a numeric grade', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('.joblist .jobrow').first()).toBeVisible()
  await page.getByRole('button', { name: 'Your preferences & filters' }).click()
  await page.getByLabel('Skills', { exact: true }).fill('Python')
  await page.getByLabel('Skills', { exact: true }).press('Enter')
  await page.getByLabel('preferred profession', { exact: false }).selectOption('administration')
  await page.getByRole('button', { name: 'Your preferences & filters' }).click()
  await expect(page.locator('.joblist .scorebadge').first()).toBeVisible()
  for (const text of await page.locator('.joblist .scorebadge').allTextContents())
    expect(text.trim()).toBe('')
  await page.getByText('What does the green circle mean?', { exact: true }).click()
  await expect(page.locator('.match-help')).toContainText('not a job grade')
  await expect(page.locator('.content')).not.toContainText(
    /Rates by ExchangeRate|Salary estimates in|Job Board API/,
  )
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
