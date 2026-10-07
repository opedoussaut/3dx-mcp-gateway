import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import { createApp } from './app';

if (existsSync('.env')) process.loadEnvFile('.env');
const app = createApp();
const production = process.argv.includes('--production');
if (production) {
  app.use((_req, res, next) => {
    res.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    );
    next();
  });
  app.use(express.static(resolve('dist/client')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/client/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('PORT must be between 1024 and 65535.');
app.listen(port, '127.0.0.1', () =>
  process.stderr.write(
    `NOVA ready at http://127.0.0.1:${port} (${production ? 'production build' : 'development'})\n`,
  ),
);
