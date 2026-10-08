import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('the standalone lab page reads and drives the simulated engine with approval', async ({
  page,
}) => {
  const external: string[] = [];
  page.on('request', (r) => {
    if (!['127.0.0.1', 'localhost'].includes(new URL(r.url()).hostname)) external.push(r.url());
  });
  await page.goto('/lab');
  await expect(
    page.getByRole('heading', { name: 'ITEROP orchestration lab', level: 1 }),
  ).toBeVisible();
  const settings = page.getByRole('list', { name: 'Sandbox settings' });
  await expect(settings.getByText('NOVA_LAB_API_KEY not set')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Sandbox (live)' })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Prompt' }).fill('Which processes can I start?');
  await page.getByRole('button', { name: 'Run prompt' }).click();
  await expect(page.getByText(/processes can be started/)).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Prompt' })
    .fill('Configure the cooling chain for 1.2 MW IT load, 32 °C facility water, 16 racks, N+1');
  await page.getByRole('button', { name: 'Run prompt' }).click();
  await expect(page.getByRole('button', { name: 'Approve and send' })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Approve all remaining writes' }).click();
  await expect(page.getByText(/Lab check PASS/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Simulated reviewer' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(external).toEqual([]);
});

test('the lab explains what is implemented, its limits and why it is secure', async ({ page }) => {
  await page.goto('/lab');
  await page.getByRole('tab', { name: 'How it works' }).click();
  const panel = page.getByRole('tabpanel', { name: 'How it works' });
  await expect(panel.getByRole('heading', { name: 'How a request flows' })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Why it is secure' })).toBeVisible();
  await expect(panel.getByText('Sign or approve on an engineer’s behalf')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Try an example' }).click();
  await expect(page.getByRole('tab', { name: 'Run' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('textbox', { name: 'Prompt' })).toHaveValue(/cooling chain/);
});
