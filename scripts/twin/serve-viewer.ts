import { createServer } from 'node:http';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Local OpenUSD viewer: http://127.0.0.1:8765
 *
 *   npm run twin:view                       newest .usda in .private/twin
 *   npm run twin:view -- <file.usda> [port]
 *
 * Serves exactly two things on loopback: the viewer page and the one scene file. Nothing else in
 * the repository (.env, .private/) is reachable.
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

const [arg, port = '8765'] = process.argv.slice(2);
const scene = arg ?? available()[0];
if (!scene || !existsSync(scene)) {
  console.error(arg ? `No such file: ${arg}` : `No .usda file in ${twin} yet.`);
  const files = available();
  if (files.length) console.error(`Available:\n${files.map((f) => `  ${f}`).join('\n')}`);
  process.exit(1);
}

createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  let body: Buffer;
  let type: string;
  try {
    if (path === '/' || path === '/index.html') {
      body = readFileSync(viewer);
      type = 'text/html; charset=utf-8';
    } else if (path === '/scene.usda') {
      body = readFileSync(scene);
      type = 'text/plain; charset=utf-8';
    } else {
      res.writeHead(404).end();
      return;
    }
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' }).end((e as Error).message);
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(body);
}).listen(Number(port), '127.0.0.1', () =>
  console.log(`OpenUSD viewer on http://127.0.0.1:${port}\nScene: ${scene}`),
);
