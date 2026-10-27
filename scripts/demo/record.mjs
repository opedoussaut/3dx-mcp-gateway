// Replays a direct-run transcript in player.html and records it as a video (Playwright).
// Usage: node scripts/demo/record.mjs <run.json> <out-dir>
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const [run, out] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.NOVA_TEST_BROWSER || undefined,
  args: ['--no-sandbox'],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: out, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
await page.addInitScript(`window.RUN = ${readFileSync(run, 'utf8')};`);
await page.goto('file://' + fileURLToPath(new URL('./player.html', import.meta.url)));
await page.waitForFunction(() => window.DONE === true, null, { timeout: 600_000 });
const video = page.video();
await context.close();
console.log(await video.path());
await browser.close();
