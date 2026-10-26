import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Local OpenUSD viewer: http://127.0.0.1:8765
 *
 *   node --import tsx scripts/twin/serve-viewer.ts [scene.usda] [port]
 *
 * Serves exactly two things on loopback: the viewer page and the one scene file. Nothing else in
 * the repository (.env, .private/) is reachable.
 */
const root = fileURLToPath(new URL('../..', import.meta.url));
const [scene = `${root}.private/twin/cooling-system.usda`, port = '8765'] = process.argv.slice(2);
const viewer = fileURLToPath(new URL('./viewer.html', import.meta.url));

createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  try {
    if (path === '/' || path === '/index.html') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      return res.end(readFileSync(viewer));
    }
    if (path === '/scene.usda') {
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      return res.end(readFileSync(scene));
    }
    res.writeHead(404).end();
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' }).end((e as Error).message);
  }
}).listen(Number(port), '127.0.0.1', () =>
  console.log(`OpenUSD viewer on http://127.0.0.1:${port} (scene: ${scene})`),
);
