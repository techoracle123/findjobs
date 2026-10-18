import { test, expect } from '@playwright/test'

for (const width of [390, 768, 1280, 1600]) {
  test(`job board stays aligned at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Good work')
    await expect(page.locator('.joblist .jobrow').first()).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await expect(page.getByText('Preview dataset')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Plan$/ })).toHaveCount(0)
    const first = page.locator('.joblist .jobrow').first()
    await first.click()
    await expect(page.locator('.detail__title')).toBeVisible()
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
  await page.getByRole('button', { name: /^Saved/ }).click()
  await expect(page.getByRole('heading', { name: 'Saved & applied' })).toBeVisible()
  await expect(page.locator('.content .jobrow')).toHaveCount(1)
  await page.getByRole('button', { name: 'Your preferences & filters' }).click()
  await page.getByLabel('Skills', { exact: true }).fill('Python')
  await page.getByLabel('Skills', { exact: true }).press('Enter')
  await expect(page.getByRole('button', { name: 'Remove Python' })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: /^Saved/ }).click()
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
