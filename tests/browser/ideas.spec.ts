import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

async function expectNoOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
}

test('the public catalogue provides real pagination, filters and responsive evidence cards', async ({
  page,
}) => {
  const response = await page.request.get('/api/ideas?country=NGA&limit=24')
  expect(response.ok()).toBe(true)
  const body = await response.json()
  expect(body.catalogTotal).toBeGreaterThan(15000)
  expect(body.total).toBeGreaterThan(0)
  expect(body.total).toBeLessThanOrEqual(144)
  expect(body.ideas).toHaveLength(Math.min(24, body.total))
  for (const idea of body.ideas) {
    expect(idea.evidence.displayValue).toBeTruthy()
    expect(idea.evidence.unit).toBeTruthy()
    expect(idea.evidence.year).toBeGreaterThan(2000)
    expect(idea.evidence.sourceLastUpdated).toBeTruthy()
    expect(idea.evidence.sourceName).toContain('World Bank')
    expect(idea.evidence.sourceUrl).toMatch(/^https:\/\/data\.worldbank\.org\//)
  }
  for (const format of ['physical', 'software', 'hybrid']) {
    const filtered = await page.request.get(`/api/ideas?country=NGA&format=${format}&limit=1`)
    expect(filtered.ok()).toBe(true)
    expect((await filtered.json()).total).toBeGreaterThan(0)
  }

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/ideas')
  await expect(
    page.getByRole('heading', { name: 'Find a practical idea to build or sell.' }),
  ).toBeVisible()
  await expect(page.locator('.idea-grid .idea-card')).toHaveCount(Math.min(24, body.total))
  await expect(page.locator('.ideas-hero__stats')).toContainText(
    body.catalogTotal.toLocaleString('en-NG'),
  )
  await expect(page.locator('body')).toContainText('The figures are only a starting point.')
  await expect(page.locator('.idea-results__head')).toContainText(
    'FJ checked the official figures on',
  )

  if (body.total > 24) {
    const nextResponse = page.waitForResponse(
      (item) =>
        item.url().includes('/api/ideas?') &&
        new URL(item.url()).searchParams.get('offset') === '24',
    )
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    expect((await nextResponse).ok()).toBe(true)
    await expect(page).toHaveURL(/page=2/)
    await expect(page.locator('.idea-grid .idea-card')).toHaveCount(24)
    await page.getByRole('button', { name: 'Previous', exact: true }).click()
  }

  const softwareResponse = page.waitForResponse(
    (item) =>
      item.url().includes('/api/ideas?') &&
      new URL(item.url()).searchParams.get('format') === 'software',
  )
  await page.getByLabel('Product type').selectOption('software')
  expect((await softwareResponse).ok()).toBe(true)
  await expect(page.locator('.idea-grid .idea-card').first()).toBeVisible()
  await expect(page.locator('.idea-format')).toHaveText(
    Array.from({ length: await page.locator('.idea-format').count() }, () => 'Software product'),
  )

  const searchResponse = page.waitForResponse(
    (item) =>
      item.url().includes('/api/ideas?') && new URL(item.url()).searchParams.get('q') === 'solar',
  )
  await page.getByLabel('Search product ideas').fill('solar')
  await page.getByRole('button', { name: 'Search ideas' }).click()
  expect((await searchResponse).ok()).toBe(true)
  await expect(page.locator('.idea-grid .idea-card').first()).toBeVisible()
  await expect(page.locator('body')).toContainText('solar', { ignoreCase: true })

  for (const width of [320, 390, 768, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await expectNoOverflow(page)
  }
})

test('an idea can be saved, shared, checked and downloaded with its evidence', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          document.documentElement.setAttribute('data-test-clipboard', text)
        },
      },
    })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/ideas')
  const first = page.locator('.idea-grid .idea-card').first()
  await expect(first).toBeVisible()
  const title = await first.locator('h2').innerText()
  const evidence = await first.locator('.idea-evidence-chip strong').innerText()
  await first.getByRole('button', { name: /^Save / }).click()
  await page.getByRole('button', { name: 'Saved on this device (1)', exact: true }).click()
  await expect(page.locator('.idea-grid .idea-card')).toHaveCount(1)
  await page.getByRole('button', { name: 'Product ideas', exact: true }).click()
  const detailResponsePromise = page.waitForResponse((response) =>
    response.url().includes('/api/ideas/'),
  )
  await page.locator('.idea-grid .idea-card').first().locator('h2 a').click()
  const detailResponse = await detailResponsePromise

  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible()
  await expect(page).toHaveURL(/\/ideas\/[^/]+$/)
  await expect(page.locator('.idea-evidence-value')).toHaveText(evidence)
  expect(detailResponse.ok()).toBe(true)
  const detailBody = (await detailResponse.json()) as { idea: { evidence: { value: number } } }
  const exactValue = String(detailBody.idea.evidence.value)
  await expect(page.locator('.idea-evidence-panel')).toContainText('Exact figure from the source')
  await expect(page.locator('.idea-evidence-panel dd').first()).toHaveText(exactValue)
  await expect(page.locator('.idea-evidence-panel')).toContainText('Source last updated')
  await expect(page.locator('.idea-evidence-panel')).toContainText('Year measured')
  await expect(page.locator('.idea-evidence-panel')).toContainText('World Bank does not endorse it')
  await expect(page.getByRole('link', { name: 'Check the World Bank source' })).toHaveAttribute(
    'href',
    /^https:\/\/data\.worldbank\.org\//,
  )
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Share idea' }).click()
  await expect(page.getByText('Idea link copied.')).toBeVisible()
  expect(await page.locator('html').getAttribute('data-test-clipboard')).toBe(page.url())

  const firstCheck = page.locator('.validation-list input').first()
  await page.locator('.validation-list label').first().click()
  await expect(firstCheck).toBeChecked()
  await expect(page.locator('.validation-section')).toContainText('1 of')
  await page.reload()
  await expect(page.locator('.validation-list input').first()).toBeChecked()

  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download idea' }).click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toMatch(/-idea-checklist\.txt$/)
  const stream = await download.createReadStream()
  expect(stream).not.toBeNull()
  let brief = ''
  for await (const chunk of stream!) brief += String(chunk)
  expect(brief).toContain(title)
  expect(brief).toContain(evidence)
  expect(brief).toContain(`EXACT FIGURE FROM SOURCE: ${exactValue}`)
  expect(brief).toContain('SOURCE LAST UPDATED:')
  expect(brief).toContain('UNIT:')
  expect(brief).toContain('SOURCE LINK: https://data.worldbank.org/')
  expect(brief).toContain('not proof that people will buy it')

  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const serious = accessibility.violations.filter((violation) =>
    ['serious', 'critical'].includes(violation.impact ?? ''),
  )
  expect(
    serious.flatMap((violation) =>
      violation.nodes.map((node) => `${violation.id}: ${node.target.join(' ')}`),
    ),
  ).toEqual([])
  await expectNoOverflow(page)
})

test('trends show their collection time, source and honest traffic limitation', async ({
  page,
}) => {
  const fetchedAt = new Date().toISOString()
  await page.route('**/api/idea-trends?*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        geo: 'NG',
        fetchedAt,
        stale: false,
        sourceName: 'Google Trends browser-test fixture',
        sourceUrl: 'https://trends.google.com/trending/rss?geo=NG',
        trends: [
          {
            id: 'trend-1',
            query: 'solar water pumps',
            geo: 'NG',
            countryName: 'Nigeria',
            trafficLabel: '2K+',
            approximateSearches: 2000,
            startedAt: fetchedAt,
            exploreUrl: 'https://trends.google.com/trends/explore?geo=NG&q=solar%20water%20pumps',
            news: [],
          },
        ],
      }),
    }),
  )
  await page.goto('/ideas')
  await expect(page.locator('.idea-grid .idea-card').first()).toBeVisible()
  await page.getByRole('button', { name: 'Trending searches', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'solar water pumps' })).toBeVisible()
  await expect(page.locator('.trend-source-note')).toContainText('Collected')
  await expect(page.locator('.trend-source-note')).toContainText('browser-test fixture')
  await expect(page.locator('.trend-card')).toContainText('2K+')
  await expect(page.locator('.trend-traffic-note')).toContainText('not an exact count')
  await expect(page.locator('.trend-traffic-note')).toContainText('does not prove people will buy')
  await expect(page.getByRole('link', { name: 'Open in Google Trends' })).toHaveAttribute(
    'href',
    /trends\.google\.com/,
  )
})

test('an unknown idea returns a useful not-found state', async ({ page }) => {
  const response = await page.goto('/ideas/not-a-real-idea')
  if (response?.status() === 404) {
    // Cloudflare Pages correctly returns a real 404 rather than booting the
    // SPA for an unknown detail route. Local Vite uses the inline state below.
    await expect(page.getByRole('heading', { name: /Page not found/ })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Explore current jobs on FJ' })).toBeVisible()
    return
  }
  await expect(page.getByRole('alert')).toContainText('not in the current collection')
  await expect(page.getByRole('link', { name: 'Back to product ideas' })).toBeVisible()
})
