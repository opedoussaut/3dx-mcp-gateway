import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

async function navigate(page: Page, name: string) {
  const menu = page.getByRole('button', { name: 'Open navigation' });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name, exact: true }).click();
}
const copilot = (page: Page) => page.getByRole('complementary', { name: 'NOVA Intelligence' });
const canvas = (page: Page) => page.getByRole('region', { name: 'Business Process canvas' });
const tasks = (page: Page) => page.getByRole('region', { name: 'My tasks' });
const processes = (page: Page) => page.getByRole('region', { name: 'Available processes' });
const details = (page: Page) =>
  page.getByRole('region', { name: 'Evidence, provenance and trace' });
async function showProcesses(page: Page) {
  const tab = page.getByRole('tab', { name: /Processes/ });
  if (await tab.isVisible()) await tab.click();
}
async function ask(page: Page, prompt: string, mode?: 'Ask' | 'Investigate' | 'Prepare') {
  if (mode) await copilot(page).getByRole('button', { name: mode, exact: true }).click();
  await page.getByRole('textbox', { name: 'Ask NOVA about Business Process' }).fill(prompt);
  await page.getByRole('button', { name: 'Ask NOVA', exact: true }).click();
}
const external: string[] = [];
test.beforeEach(async ({ page }) => {
  external.length = 0;
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (!['127.0.0.1', 'localhost'].includes(host) && !r.url().startsWith('data:'))
      external.push(r.url());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Business Process', level: 1 })).toBeVisible();
  await expect(tasks(page).getByRole('button')).toHaveCount(3);
});
test.afterEach(() => expect(external).toEqual([]));

test('opens on the most urgent task inside its process, in business language', async ({ page }) => {
  await expect(
    canvas(page).getByRole('heading', { name: 'Review contractor security form' }),
  ).toBeVisible();
  await expect(canvas(page).getByText('1 day overdue').first()).toBeVisible();
  const stages = canvas(page).getByRole('list', { name: 'Process stages' });
  await expect(stages.getByRole('listitem')).toHaveCount(5);
  await expect(stages.locator('[aria-current="step"]')).toContainText('Security review');
  await expect(stages.locator('[aria-current="step"]')).toContainText('You are here');
  await expect(canvas(page).getByText(/Illustrative stages/)).toBeVisible();
  await expect(canvas(page).getByText('SYNTHETIC').first()).toBeVisible();
  // Technical identifiers stay out of the primary experience…
  const primary = page.getByRole('complementary', { name: 'Your tasks and processes' });
  for (const noise of ['getTasksByUser', 'getAllStartableProcesses', 'syn-task-', '/runtime/tasks'])
    await expect(primary).not.toContainText(noise);
  await expect(canvas(page)).not.toContainText('syn-task-');
  // …and remain inspectable in Provenance.
  await canvas(page)
    .getByRole('button', { name: /Evidence/ })
    .click();
  await expect(
    details(page).getByText('getTasksByUser').filter({ visible: true }).first(),
  ).toBeVisible();
  await expect(
    details(page).getByText('GET /runtime/tasks').filter({ visible: true }).first(),
  ).toBeVisible();
  await expect(
    details(page)
      .getByText(/R2026x-FD04/)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
});
test('one task + one question → one governed, cited answer', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const task = tasks(page).getByRole('button', { name: /Approve quality impact/ });
  await task.click();
  await expect(task).toHaveAttribute('aria-pressed', 'true');
  await expect(canvas(page).getByRole('heading', { name: 'Approve quality impact' })).toBeVisible();
  await expect(canvas(page).locator('[aria-current="step"]')).toContainText('Quality approval');
  await expect(copilot(page).getByLabel('Current context')).toContainText('Approve quality impact');
  await canvas(page).getByRole('button', { name: 'Why does this need me?' }).click();
  await expect(
    copilot(page).getByRole('heading', {
      name: 'Why “Approve quality impact” needs your attention',
    }),
  ).toBeVisible();
  await expect(copilot(page).getByText(/does not infer a business cause/)).toBeVisible();
  const downloading = page.waitForEvent('download');
  await copilot(page).getByRole('button', { name: 'Export', exact: true }).click();
  const mission = JSON.parse(await readFile((await (await downloading).path())!, 'utf8'));
  expect(mission.domain).toBe('ITEROP');
  expect(mission.source).toBe('synthetic');
  expect(mission.metrics.writes).toBe(0);
  expect(mission.provenance[0].operationId).toBe('getTasksByUser');
  expect(errors).toEqual([]);
});
test('a selected process becomes the canvas and is explained through getBasicProcessInfo', async ({
  page,
}) => {
  await showProcesses(page);
  await processes(page)
    .getByRole('button', { name: /Contractor access form/ })
    .click();
  await expect(canvas(page).getByRole('heading', { name: 'Contractor access form' })).toBeVisible();
  await expect(canvas(page).getByText('Your tasks here')).toBeVisible();
  await expect(canvas(page).getByText('Not available yet')).toBeVisible();
  await canvas(page).getByRole('button', { name: 'Explain this process' }).click();
  await expect(
    copilot(page).getByRole('heading', { name: 'Contractor access form' }),
  ).toBeVisible();
  await page.getByRole('tab', { name: /Provenance/ }).click();
  await expect(
    details(page).getByText('getAllStartableProcesses').filter({ visible: true }).first(),
  ).toBeVisible();
  await expect(
    details(page).getByText('getBasicProcessInfo').filter({ visible: true }).first(),
  ).toBeVisible();
});
test('P0 natural-language questions in English and French', async ({ page }) => {
  for (const [q, heading] of [
    ['Which processes can I start?', '3 processes you can start'],
    ['What workflows are available to me?', '3 processes you can start'],
    ['Quels processus puis-je lancer ?', '3 processes you can start'],
    ['What should I work on first?', 'Start with Review contractor security form'],
    ['Show my overdue tasks.', '1 overdue task'],
    ['Quelles sont mes tâches en cours ?', '3 current tasks'],
    ['Explain the Contractor Form process.', 'Contractor access form'],
  ]) {
    await ask(page, q);
    await expect(copilot(page).getByRole('heading', { name: heading })).toBeVisible();
  }
});
test('cross-user, write and denial outcomes are terminal and explicit', async ({ page }) => {
  await ask(page, "Show Alice's tasks");
  await expect(
    copilot(page).getByRole('heading', { name: "Other people's tasks are out of scope" }),
  ).toBeVisible();
  await expect(copilot(page).getByText('0 tool calls')).toBeVisible();
  for (const q of [
    'Start the contractor access form',
    'Complete the approve quality impact task',
    'Reassign my review task to Bob',
  ]) {
    await ask(page, q);
    await expect(
      copilot(page).getByRole('heading', { name: 'Process changes need a governed workflow' }),
    ).toBeVisible();
  }
  await ask(page, 'Explain the process key syn_restricted_audit');
  await expect(
    copilot(page).getByRole('heading', { name: 'Access denied for this identity' }),
  ).toBeVisible();
  await ask(page, 'Prepare to launch the contractor access form', 'Prepare');
  await expect(copilot(page).getByText('prepared — not submitted', { exact: true })).toBeVisible();
  await expect(canvas(page).getByText('PREPARED — NOT SUBMITTED')).toBeVisible();
});
test('Live is an explicit gate: no connection implied, no request, no synthetic fallback', async ({
  page,
}) => {
  const missions: string[] = [];
  page.on(
    'request',
    (r) => r.url().endsWith('/api/missions') && r.method() === 'POST' && missions.push(r.url()),
  );
  const live = page
    .getByRole('group', { name: 'Business Process source' })
    .getByRole('button', { name: 'Live' });
  await live.click();
  await expect(live).toHaveAttribute('aria-pressed', 'true');
  await expect(
    canvas(page).getByRole('heading', { name: 'Live access is not approved yet' }),
  ).toBeVisible();
  await expect(canvas(page).getByText('LIVE', { exact: true })).toBeVisible();
  await expect(canvas(page).getByText('SYNTHETIC', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Ask NOVA about Business Process' })).toHaveCount(
    0,
  );
  await expect(tasks(page).getByRole('button', { name: /Not connected/ })).toBeVisible();
  expect(missions).toEqual([]);
  await canvas(page).getByRole('button', { name: 'View connection requirements' }).click();
  const card = page.getByRole('article', { name: 'Business Process connection' });
  await expect(card.getByText(/^LIVE BLOCKED/)).toBeVisible();
  await expect(card.getByRole('button', { name: 'Test Business Process read' })).toBeDisabled();
  await expect(page.getByText('Datasets Governance')).toHaveCount(0);
});
test('keyboard alone can select a task and ask about it', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const task = tasks(page).getByRole('button', { name: /Approve quality impact/ });
  await task.focus();
  await page.keyboard.press('Enter');
  await expect(task).toHaveAttribute('aria-pressed', 'true');
  const why = canvas(page).getByRole('button', { name: 'Why does this need me?' });
  await why.focus();
  await page.keyboard.press('Enter');
  await expect(
    copilot(page).getByRole('heading', {
      name: 'Why “Approve quality impact” needs your attention',
    }),
  ).toBeVisible();
});
test('mobile uses a full-width list switch instead of a partial rail', async ({ page }) => {
  const narrow = (page.viewportSize()?.width || 0) <= 960;
  test.skip(!narrow, 'Mobile composition only');
  await expect(processes(page)).toBeHidden();
  await page.getByRole('tab', { name: /Processes/ }).click();
  await expect(processes(page)).toBeVisible();
  await expect(tasks(page)).toBeHidden();
  const box = await processes(page).boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await expect(page.getByRole('list', { name: 'Provenance' })).toBeVisible();
});
test('Business Process workspace has no serious accessibility violations or overflow', async ({
  page,
}) => {
  const axe = async () =>
    (
      await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    ).violations.map((v) => ({
      id: v.id,
      targets: v.nodes.map((n) => n.target),
    }));
  expect(await axe()).toEqual([]);
  await showProcesses(page);
  await processes(page)
    .getByRole('button', { name: /Tooling purchase request/ })
    .click();
  await page.getByRole('tab', { name: /Provenance/ }).click();
  expect(await axe()).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page
    .getByRole('group', { name: 'Business Process source' })
    .getByRole('button', { name: 'Live' })
    .click();
  expect(await axe()).toEqual([]);
  await navigate(page, 'Connections');
  expect(await axe()).toEqual([]);
});
