import { createServer } from 'node:http';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Local OpenUSD viewer: http://127.0.0.1:8765
 *
 *   npm run twin:view                                     newest .usda in .private/twin
 *   npm run twin:view -- <file.usda> [--baseline <file.usda>] [--port 8766]
 *
 * Serves exactly the viewer page, the scene and (for a change) the baseline scene, on loopback.
 * Nothing else in the repository (.env, .private/) is reachable.
 */
const root = fileURLToPath(new URL('../..', import.meta.url));
const twin = join(root, '.private', 'twin');
const viewer = fileURLToPath(new URL('./viewer.html', import.meta.url));
const available = () =>
  existsSync(twin)
    ? readdirSync(twin)
        .filter((f) => f.endsWith('.usda'))
        .map((f) => join(twin, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    : [];

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
};
const baseline = option('--baseline');
const port = option('--port') ?? '8765';
const scene = args[0] ?? available()[0];
for (const [label, file] of [
  ['scene', scene],
  ['baseline', baseline],
] as const) {
  if (label === 'baseline' && file === undefined) continue;
  if (!file || !existsSync(file)) {
    console.error(file ? `No such ${label} file: ${file}` : `No .usda file in ${twin} yet.`);
    const files = available();
    if (files.length) console.error(`Available:\n${files.map((f) => `  ${f}`).join('\n')}`);
    process.exit(1);
  }
}

createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  let body: Buffer;
  let type = 'text/plain; charset=utf-8';
  try {
    if (path === '/' || path === '/index.html') {
      body = readFileSync(viewer);
      type = 'text/html; charset=utf-8';
    } else if (path === '/scene.usda') body = readFileSync(scene!);
    else if (path === '/baseline.usda' && baseline) body = readFileSync(baseline);
    else {
      res.writeHead(404).end();
      return;
    }
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' }).end((e as Error).message);
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(body);
})
  .on('error', (e: NodeJS.ErrnoException) => {
    if (e.code !== 'EADDRINUSE') throw e;
    console.error(
      `Port ${port} is already in use, probably by another viewer. Open http://127.0.0.1:${port}, stop the other one, or add --port 8766.`,
    );
    process.exit(1);
  })
  .listen(Number(port), '127.0.0.1', () =>
    console.log(
      `OpenUSD viewer on http://127.0.0.1:${port}\nScene: ${scene}${baseline ? `\nBaseline: ${baseline}` : ''}`,
    ),
  );
