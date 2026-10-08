import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const CONFIGURE =
  'Configure the cooling chain for 1.2 MW IT load, 32 °C facility water, 16 racks, N+1';
const external: string[] = [];
const command = (page: Page) => page.getByRole('textbox', { name: 'Command' });
const run = async (page: Page, prompt: string) => {
  await command(page).fill(prompt);
  await page.getByRole('button', { name: 'Run command' }).click();
};
const side = (page: Page) => page.getByRole('complementary', { name: 'NOVA' });
const trace = (page: Page) => page.getByRole('region', { name: 'Process trace' });
const chain = (page: Page) => page.getByRole('region', { name: 'Process chain' });

test.beforeEach(async ({ page }) => {
  external.length = 0;
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (!['127.0.0.1', 'localhost'].includes(host) && !r.url().startsWith('data:'))
      external.push(r.url());
  });
  await page.goto('/');
  const menu = page.getByRole('button', { name: 'Open navigation' });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Orchestration', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Process orchestration', level: 1 }),
  ).toBeVisible();
});
test.afterEach(() => expect(external).toEqual([]));

test('a command plans the chain and stops before the first write', async ({ page }) => {
  await expect(page.getByText('Simulated process engine · no platform request')).toBeVisible();
  await run(page, CONFIGURE);
  await expect(side(page).getByText('Prepared — not submitted').first()).toBeVisible();
  await expect(side(page).getByText('POST /runtime/processes/syn-cooling-chain')).toBeVisible();
  await expect(side(page).getByLabel('Request body')).toContainText('"start_itLoadKw": 1200');
  await expect(trace(page).getByText('awaiting approval')).toBeVisible();
  await expect(chain(page).getByText('1,200 kW · 32 °C · 16 racks · N+1')).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  await side(page).getByRole('button', { name: 'Cancel run' }).click();
  await expect(side(page).getByText('Cancelled', { exact: true })).toBeVisible();
  await expect(side(page).getByText(/Nothing else was sent/)).toBeVisible();
});

test('approved writes drive the chain to the reviewer, and a rejection comes back', async ({
  page,
}) => {
  await run(page, CONFIGURE);
  await side(page).getByRole('button', { name: 'Approve and send' }).click();
  await expect(trace(page).getByText('201 · no body (FD04)')).toBeVisible();
  await side(page).getByRole('button', { name: 'Approve all remaining writes' }).click();
  await expect(side(page).getByText('Waiting for reviewer').first()).toBeVisible();
  await expect(side(page).getByText(/Lab check PASS/)).toBeVisible();
  await expect(side(page).getByText(/not engineering values/)).toBeVisible();
  await expect(chain(page).getByText('3 × CDU-800 (2 duty)')).toBeVisible();
  const reviewer = page.getByRole('region', { name: 'Simulated reviewer' });
  await reviewer.getByLabel('Reviewer comment').fill('Use plain water instead of glycol');
  await reviewer.getByRole('button', { name: 'Reject as reviewer' }).click();
  await expect(reviewer.getByText('No task is waiting for a signature.')).toBeVisible();
  await page.getByRole('radio', { name: 'Approve all writes of the run' }).click();
  await run(page, 'Check my inbox and handle any rework');
  await expect(chain(page).getByText('Returned by reviewer · reworked')).toBeVisible();
  await expect(side(page).getByText(/coolant auto → water/)).toBeVisible();
  await run(page, 'Facility water is now 38 °C — what needs to be recalculated?');
  const changed = side(page).getByRole('table');
  await expect(changed.getByRole('row', { name: /Check result PASS FAIL/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /COOL-003/ })).toBeVisible();
});

test('refusals and missing inputs are explained without any call', async ({ page }) => {
  await run(page, 'Reassign the sign-off task to another engineer');
  await expect(side(page).getByText('Blocked', { exact: true })).toBeVisible();
  await expect(side(page).getByText(/Changing task assignments/)).toBeVisible();
  await expect(trace(page).getByText('Nothing was sent to the process engine')).toBeVisible();
  await run(page, 'Configure the cooling chain for 900 kW');
  await expect(side(page).getByText('Needs input', { exact: true })).toBeVisible();
  await expect(
    side(page)
      .getByText(/rack count/)
      .first(),
  ).toBeVisible();
});

test('the orchestration view fits a phone without horizontal scrolling', async ({ page }) => {
  test.skip(test.info().project.name !== 'mobile', 'mobile layout');
  await run(page, CONFIGURE);
  await expect(side(page).getByRole('button', { name: 'Approve and send' })).toBeVisible();
  const box = await side(page).getByRole('button', { name: 'Approve and send' }).boundingBox();
  const traceBox = await trace(page).boundingBox();
  // Recomposed: the decision comes before the long trace.
  expect(box!.y).toBeLessThan(traceBox!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
