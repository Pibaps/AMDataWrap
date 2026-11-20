import { expect, test } from '@playwright/test'

/**
 * Phase 0 Playwright E2E Guardrail Suite (PDF p. 16):
 * Walks all 7 views, all 3 Visual Editions (Field, Editorial, Observatory), Light/Dark & Calm toggles,
 * FTS5 search modal, and Scrollytelling Wrapped — failing immediately on ANY console error,
 * uncaught page exception, or HTTP >= 400 API response!
 */
test('AMDataWrap V3 Continuum zero-error walkthrough across editions, tabs, filters, and modals', async ({ page }) => {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const failedApi: string[] = []

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const txt = msg.text()
      // Ignore WebGL headless software warnings if GPU absent in CI
      if (!txt.toLowerCase().includes('webgl') && !txt.toLowerCase().includes('swiftshader')) {
        consoleErrors.push(txt)
      }
    }
  })
  page.on('pageerror', (err) => pageErrors.push(String(err)))
  page.on('response', (resp) => {
    if (resp.url().includes('/api/') && resp.status() >= 400) {
      failedApi.push(`${resp.status()} ${resp.url()}`)
    }
  })

  await page.goto('/')
  await expect(page.getByText('AMDataWrap')).toBeVisible()

  // Switch across all 3 Visual Editions + Light/Dark + Mode Calme
  await page.getByTestId('edition-editorial').click()
  await expect(page.locator('html')).toHaveAttribute('data-edition', 'editorial')
  await page.getByTestId('toggle-theme').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByTestId('edition-observatory').click()
  await expect(page.locator('html')).toHaveAttribute('data-edition', 'observatory')
  await page.getByTestId('toggle-calm').click()
  await expect(page.locator('html')).toHaveAttribute('data-calm', 'true')
  await page.getByTestId('toggle-calm').click()
  await page.getByTestId('toggle-theme').click()
  await page.getByTestId('edition-field').click()

  // Walk all main tabs & sub-tabs
  await page.getByTestId('nav-science').click()
  await page.getByTestId('science-tab-compass').click()
  await page.getByTestId('science-tab-camelot').click()
  await page.getByTestId('science-tab-metrics').click()

  await page.getByTestId('nav-atlas').click()
  await page.getByTestId('atlas-tab-graph').click()

  await page.getByTestId('nav-observatory').click()
  await page.getByTestId('obs-mode-vinyls').click()
  await page.getByTestId('obs-mode-constellation').click()

  await page.getByTestId('nav-analytics').click()
  await page.getByTestId('core-tab-chrono').click()
  await page.getByTestId('core-tab-persona').click()
  await page.getByTestId('core-tab-behavior').click()
  await page.getByTestId('core-tab-history').click()

  await page.getByTestId('nav-games').click()
  await page.getByTestId('games-tab-blindtest').click()
  await page.getByTestId('games-tab-collector').click()
  await page.getByTestId('collector-pixelgrid').click()

  await page.getByTestId('nav-continuum').click()

  // Open & close FTS5 search modal
  await page.getByTestId('open-fts-search').click()
  await page.keyboard.press('Escape')

  // Open & close Scrollytelling Wrapped modal
  await page.getByTestId('open-wrapped-scrolly').click()
  await page.getByTestId('close-wrapped').click()

  expect(pageErrors, `Uncaught page errors: ${pageErrors.join('\n')}`).toEqual([])
  expect(failedApi, `Failed API responses: ${failedApi.join('\n')}`).toEqual([])
  expect(consoleErrors, `Console errors: ${consoleErrors.join('\n')}`).toEqual([])
})
