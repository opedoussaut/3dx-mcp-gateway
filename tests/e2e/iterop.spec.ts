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
const processes = (page: Page) => page.getByRole('region', { name: 'Available to start' });
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
  await expect(tasks(page).getByText(/getTasksByUser · SYNTHETIC/)).toBeVisible();
});
test.afterEach(() => expect(external).toEqual([]));

test('the workspace opens with my processes and tasks, each with FD04 provenance', async ({
  page,
}) => {
  await expect(processes(page).getByRole('button')).toHaveCount(3);
  await expect(processes(page).getByText(/getAllStartableProcesses · SYNTHETIC/)).toBeVisible();
  await expect(tasks(page).getByRole('button')).toHaveCount(3);
  await expect(copilot(page).getByRole('heading', { name: '3 current tasks' })).toBeVisible();
  await page.getByRole('tab', { name: /Provenance/ }).click();
  const provenance = page.getByRole('region', { name: 'Evidence, provenance and trace' });
  await expect(provenance.getByText('GET /runtime/tasks')).toBeVisible();
  await expect(provenance.getByText(/R2026x-FD04/)).toBeVisible();
  await expect(provenance.getByText(/the user parameter is never sent/)).toBeVisible();
});
test('one task + one question → one governed, cited answer', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await tasks(page)
    .getByRole('button', { name: /Review contractor security form/ })
    .click();
  await expect(
    tasks(page).getByRole('button', { name: /Review contractor security form/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    canvas(page).getByRole('heading', { name: 'Review contractor security form' }),
  ).toBeVisible();
  await expect(canvas(page).getByLabel('Task timeline')).toContainText('Due');
  await expect(copilot(page).getByLabel('Current context')).toContainText('syn-task-302');
  await canvas(page).getByRole('button', { name: 'Why does this need my attention?' }).click();
  await expect(
    copilot(page).getByRole('heading', { name: 'Why syn-task-302 needs your attention' }),
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
test('process context resolves a name and explains it through getBasicProcessInfo', async ({
  page,
}) => {
  await processes(page)
    .getByRole('button', { name: /Contractor access form/ })
    .click();
  await expect(canvas(page).getByText(/getProcessInfo/)).toBeVisible();
  await canvas(page).getByRole('button', { name: 'Explain this process' }).click();
  await expect(
    copilot(page).getByRole('heading', { name: 'Contractor access form' }),
  ).toBeVisible();
  await ask(page, 'Explain the Contractor Form process.');
  await page.getByRole('tab', { name: /Provenance/ }).click();
  const details = page.getByRole('region', { name: 'Evidence, provenance and trace' });
  await expect(details.getByText('getAllStartableProcesses', { exact: true })).toBeVisible();
  await expect(details.getByText('getBasicProcessInfo', { exact: true })).toBeVisible();
});
test('P0 natural-language questions in English and French', async ({ page }) => {
  for (const [q, heading] of [
    ['Which processes can I start?', '3 processes you can start'],
    ['What workflows are available to me?', '3 processes you can start'],
    ['Quels processus puis-je lancer ?', '3 processes you can start'],
    ['What should I work on first?', 'Start with Review contractor security form'],
    ['Show my overdue tasks.', '1 overdue task'],
    ['Quelles sont mes tâches en cours ?', '3 current tasks'],
  ]) {
    await ask(page, q);
    await expect(copilot(page).getByRole('heading', { name: heading })).toBeVisible();
  }
});
test('cross-user, write, denial and live states are terminal and explicit', async ({ page }) => {
  await ask(page, "Show Alice's tasks");
  await expect(
    copilot(page).getByRole('heading', { name: "Other people's tasks are out of scope" }),
  ).toBeVisible();
  await expect(copilot(page).getByText('0 tool calls')).toBeVisible();
  for (const q of [
    'Start the contractor access form',
    'Complete syn-task-301',
    'Reassign syn-task-302 to Bob',
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
  await page
    .getByRole('group', { name: 'Business Process source' })
    .getByRole('button', { name: 'Live' })
    .click();
  await expect(tasks(page).getByRole('button', { name: /Load my tasks/ })).toBeVisible();
  await tasks(page)
    .getByRole('button', { name: /Load my tasks/ })
    .click();
  await expect(
    copilot(page).getByRole('heading', { name: 'Your Business Process connection needs approval' }),
  ).toBeVisible();
  await copilot(page).getByRole('button', { name: 'Review access requirements' }).click();
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
  const why = canvas(page).getByRole('button', { name: 'Why does this need my attention?' });
  await why.focus();
  await page.keyboard.press('Enter');
  await expect(
    copilot(page).getByRole('heading', { name: 'Why syn-task-301 needs your attention' }),
  ).toBeVisible();
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
  await tasks(page)
    .getByRole('button', { name: /Review contractor security form/ })
    .click();
  await page.getByRole('tab', { name: /Provenance/ }).click();
  expect(await axe()).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await navigate(page, 'Connections');
  expect(await axe()).toEqual([]);
});
