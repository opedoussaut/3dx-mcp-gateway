import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

async function navigate(page: Page, name: string) {
  const menu = page.getByRole('button', { name: 'Open navigation' });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name, exact: true }).click();
}
const copilot = (page: Page) => page.getByRole('complementary', { name: 'NOVA Intelligence' });
const canvas = (page: Page, name: string) => page.getByRole('region', { name: `${name} canvas` });
async function ask(page: Page, name: string, prompt: string, mode?: string) {
  if (mode) await copilot(page).getByRole('button', { name: mode, exact: true }).click();
  await page.getByRole('textbox', { name: `Ask NOVA about ${name}` }).fill(prompt);
  await page.getByRole('button', { name: 'Ask NOVA', exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Business Process', level: 1 })).toBeVisible();
});

test('process tasks render on the canvas and selection drives a cited follow-up', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page
    .getByRole('button', { name: /Show the tasks assigned to me/ })
    .first()
    .click();
  await expect(
    copilot(page).getByRole('heading', { name: '3 tasks assigned to you' }),
  ).toBeVisible();
  const agenda = canvas(page, 'Business Process');
  await expect(agenda.getByText('Task agenda')).toBeVisible();
  await expect(agenda.getByText('SYNTHETIC', { exact: true })).toBeVisible();
  await expect(agenda.getByText(/Past due/)).toBeVisible();
  await agenda.getByRole('button', { name: /Review contractor security form/ }).click();
  await expect(
    agenda.getByRole('button', { name: /Review contractor security form/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await copilot(page)
    .getByRole('button', { name: 'Explain why TSK-SYN-302 needs my attention.' })
    .click();
  await expect(
    copilot(page).getByRole('heading', { name: 'Why TSK-SYN-302 needs your attention' }),
  ).toBeVisible();
  await expect(copilot(page).getByText(/does not infer a business cause/)).toBeVisible();
  const downloading = page.waitForEvent('download');
  await copilot(page).getByRole('button', { name: 'Export', exact: true }).click();
  const mission = JSON.parse(await readFile((await (await downloading).path())!, 'utf8'));
  expect(mission.domain).toBe('ITEROP');
  expect(mission.source).toBe('synthetic');
  expect(mission.metrics.writes).toBe(0);
  expect(errors).toEqual([]);
});
test('process timeline, denial and prepared-not-submitted drafts are explicit', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: /Which steps and approvals remain on PI-SYN-1042/ })
    .first()
    .click();
  await expect(
    copilot(page).getByRole('heading', { name: '3 steps remain · 2 approvals' }),
  ).toBeVisible();
  await expect(page.getByRole('list', { name: 'Process steps' }).getByRole('listitem')).toHaveCount(
    5,
  );
  await ask(page, 'Business Process', 'What is the status of PI-SYN-9001?');
  await expect(
    copilot(page).getByRole('heading', { name: 'Access denied for this principal' }),
  ).toBeVisible();
  await ask(page, 'Business Process', 'Start the contractor access form');
  await expect(
    copilot(page).getByRole('heading', { name: 'Process changes need a governed workflow' }),
  ).toBeVisible();
  await ask(
    page,
    'Business Process',
    'Prepare to launch the contractor access form process for synthetic case 7.',
    'Prepare',
  );
  await expect(
    copilot(page).getByRole('heading', { name: 'Process start draft — not submitted' }),
  ).toBeVisible();
  await expect(copilot(page).getByText('prepared — not submitted', { exact: true })).toBeVisible();
  await expect(copilot(page).getByText('0 platform writes')).toBeVisible();
});
test('live application access is blocked until its own contract is admitted', async ({ page }) => {
  await page
    .getByRole('group', { name: 'Business Process source' })
    .getByRole('button', { name: 'Live' })
    .click();
  await page
    .getByRole('button', { name: /Show the tasks assigned to me/ })
    .first()
    .click();
  await expect(
    copilot(page).getByRole('heading', { name: 'Your Business Process connection needs setup' }),
  ).toBeVisible();
  await expect(copilot(page).getByText('0 tool calls')).toBeVisible();
  await copilot(page).getByRole('button', { name: 'Review access requirements' }).click();
  const card = page.getByRole('article', { name: 'Business Process connection' });
  await expect(card.getByText(/^UNVERIFIED\. Public/)).toBeVisible();
  await expect(card.getByRole('button', { name: 'Test Business Process read' })).toBeDisabled();
  await expect(
    page
      .getByRole('article', { name: 'Datasets Governance connection' })
      .getByText('Live access blocked'),
  ).toBeVisible();
});
test('catalog lineage, insufficient suitability and blocked extraction', async ({ page }) => {
  await navigate(page, 'Datasets Governance');
  await page
    .getByRole('button', { name: /What is the reported lineage/ })
    .first()
    .click();
  await expect(
    copilot(page).getByRole('heading', { name: 'Lineage of DS-SYN-THERM-01' }),
  ).toBeVisible();
  const map = canvas(page, 'Datasets Governance');
  await expect(map.getByRole('button', { name: /Thermal bench raw sensor stream/ })).toBeVisible();
  await expect(map.getByRole('button', { name: /Cooling performance KPIs/ })).toBeVisible();
  await page
    .getByRole('button', { name: /Is DS-SYN-MAT-02 suitable/ })
    .first()
    .click();
  await expect(
    copilot(page).getByRole('heading', { name: 'Suitability cannot be established from metadata' }),
  ).toBeVisible();
  await expect(copilot(page).getByText('insufficient evidence', { exact: true })).toBeVisible();
  await expect(map.getByText('None declared').first()).toBeVisible();
  await ask(page, 'Datasets Governance', 'Download DS-SYN-THERM-01');
  await expect(
    copilot(page).getByRole('heading', { name: 'Dataset content and changes are out of scope' }),
  ).toBeVisible();
});
test('application workspaces have no serious accessibility violations or overflow', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: /Which steps and approvals remain/ })
    .first()
    .click();
  await expect(
    copilot(page).getByRole('heading', { name: '3 steps remain · 2 approvals' }),
  ).toBeVisible();
  const axe = () => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(
    (await axe()).violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await navigate(page, 'Datasets Governance');
  await page
    .getByRole('button', { name: /Which other datasets or assets/ })
    .first()
    .click();
  await expect(copilot(page).getByRole('heading', { name: '4 related resources' })).toBeVisible();
  expect(
    (await axe()).violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('keyboard alone can run a question and select a canvas object', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const starter = page
    .getByRole('button', { name: /What processes am I allowed to start/ })
    .first();
  await starter.focus();
  await expect(starter).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    copilot(page).getByRole('heading', { name: '3 processes you can start' }),
  ).toBeVisible();
  const card = canvas(page, 'Business Process').getByRole('button', {
    name: /Contractor access form/,
  });
  await card.focus();
  await page.keyboard.press('Space');
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  await expect(
    copilot(page).getByRole('button', {
      name: /Prepare to launch the contractor access form process/,
    }),
  ).toBeVisible();
});
