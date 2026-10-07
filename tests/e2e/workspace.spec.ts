import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { benchmarks } from '../../shared/benchmarks';

async function navigate(page: Page, name: string) {
  const menu = page.getByRole('button', { name: 'Open navigation' });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name, exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'From a question to a clear next step.' }),
  ).toBeVisible();
});
test('mission has traceable evidence and exports its measured result', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('button', { name: /Find the right revision/ }).click();
  await page.getByRole('button', { name: 'Run mission', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Revision B is eligible for review' }),
  ).toBeVisible();
  await expect(page.getByText('0 platform writes', { exact: true })).toBeVisible();
  await page.locator('summary').filter({ hasText: 'Cooling assembly · B' }).click();
  await expect(page.getByText('DECL-B', { exact: true })).toBeVisible();
  await page.locator('summary').filter({ hasText: 'How NOVA reached this result' }).click();
  await expect(page.getByText('Deterministic route', { exact: true })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const artifact = await downloading;
  const result = JSON.parse(await readFile((await artifact.path())!, 'utf8'));
  expect(result.source).toBe('synthetic');
  expect(result.metrics.writes).toBe(0);
  expect(result.metrics.toolCalls).toBe(2);
  expect(errors).toEqual([]);
});
test('configured structure and revision comparison produce the expected engineering facts', async ({
  page,
}) => {
  await page.getByRole('button', { name: /Understand the assembly/ }).click();
  await page.getByRole('button', { name: 'Run mission', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '2 included occurrences · 1 unique references' }),
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'Your engineering mission' }).fill(benchmarks[2].prompt);
  await page.getByRole('button', { name: 'Run mission', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Revision comparison is ready' })).toBeVisible();
  await expect(page.getByText(/The connector changes from J1 to J2/)).toBeVisible();
});
test('live access remains blocked without private configuration', async ({ page }) => {
  await page.getByLabel('Data source', { exact: true }).selectOption('live');
  await page.getByRole('textbox', { name: 'Your engineering mission' }).fill(benchmarks[0].prompt);
  await page.getByRole('button', { name: 'Run mission', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Your platform connection needs setup' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Open connection setup' }).click();
  await expect(page.getByRole('button', { name: 'Test verified connection' })).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Connection readiness' })).toBeVisible();
});
test('AURA observation records matched-context declaration and preserves unobservable metrics', async ({
  page,
}) => {
  await navigate(page, 'AURA comparison');
  await page.getByRole('button', { name: 'Run mission', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Revision B is eligible for review' }),
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'AURA response', exact: true })
    .fill('AUTOMATED TEST FIXTURE ONLY. This is not a real AURA response.');
  await page.getByLabel('AURA release', { exact: true }).fill('TEST RELEASE');
  await page.getByLabel('AURA competency', { exact: true }).fill('TEST COMPETENCY');
  await page.getByLabel('AURA elapsed seconds', { exact: true }).fill('2.5');
  await page.getByRole('button', { name: 'Save observation', exact: true }).click();
  await expect(page.getByText('Observation saved for this session')).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const artifact = await downloading;
  const result = JSON.parse(await readFile((await artifact.path())!, 'utf8'));
  expect(result.aura.elapsedSeconds).toBe(2.5);
  expect(result.auraMetrics.tokens).toBeNull();
  expect(result.auraMetrics.costUsd).toBeNull();
  expect(result.comparability).toContain('Unmatched context');
  expect(result.nova.source).toBe('synthetic');
});
test('registry is searchable and navigable on desktop and mobile', async ({ page }) => {
  await navigate(page, 'Tool registry');
  await page.getByLabel('Search tools', { exact: true }).fill('search_engineering_items');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Local tools', exact: true }).click();
  await expect(page.getByText('No tools match your search.')).toBeVisible();
  await page.getByLabel('Search tools', { exact: true }).fill('');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('workspace has no serious accessibility violations or horizontal overflow', async ({
  page,
}) => {
  await expect(page.getByRole('button', { name: /Find the right revision/ })).toBeVisible();
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    result.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if ((page.viewportSize()?.width || 0) > 1000)
    await page.screenshot({ path: 'docs/screenshots/workspace.png', fullPage: true });
  await navigate(page, 'Connections');
  const connections = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    connections.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
});
