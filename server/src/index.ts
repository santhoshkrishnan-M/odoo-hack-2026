import './env';
import express from 'express';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app';
import { openFromEnv } from './db/connection';
import { seedInto } from './db/seed';
import { runDaily } from './services/jobs';

// `npm start` runs the built app; `npm run dev` passes --dev for the Vite workflow and the demo mailbox.
const dev = process.argv.includes('--dev');
if (!dev) process.env.NODE_ENV ??= 'production';

if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
  process.env.PGLITE_DIR ??= resolve('data/pglite');
  mkdirSync(process.env.PGLITE_DIR, { recursive: true });
}
const db = await openFromEnv();
const port = Number(process.env.PORT ?? 3000);
const appUrl = process.env.APP_URL ?? (dev ? 'http://localhost:5173' : `http://localhost:${port}`);

// Listen straight away; while the demo company is being created the API answers 503 with a friendly message.
let settingUp = (await db.query<{ n: number }>('SELECT count(*) AS n FROM users'))[0].n === 0;
const server = express();
server.use((req, res, next) => {
  if (settingUp && req.path.startsWith('/api/') && req.path !== '/api/health') {
    res.status(503).json({ error: 'Setting up the demo company for the first time — ready in about a minute. Refresh then.' });
    return;
  }
  next();
});
server.use(createApp(db));
const clientDir = resolve('dist/client');
if (!dev && existsSync(clientDir)) {
  server.use(express.static(clientDir, { index: false, maxAge: '1h' }));
  server.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(resolve(clientDir, 'index.html')));
}
const http = server.listen(port, () => {
  console.log(`\n  Brightloop Billing API on http://localhost:${port} (${db.engine === 'pglite' ? 'embedded PostgreSQL in data/pglite' : 'PostgreSQL'})`);
  console.log(dev ? '  Open the app at http://localhost:5173\n' : existsSync(clientDir) ? `  Open the app at http://localhost:${port}\n` : '  Run `npm run build` first to serve the web app from here.\n');
});

if (settingUp) {
  const n = Number(process.env.SEED_SUBSCRIPTIONS ?? 1000);
  console.log(`  First start: creating a demo company with ${n} subscriptions (about a minute)…`);
  const t = performance.now();
  await seedInto(db, n);
  settingUp = false;
  console.log(`  Demo company ready in ${Math.round((performance.now() - t) / 1000)} s. Sign in as admin@brightloop.test / Admin!pass1 (more accounts in README).\n`);
}

// Scheduler for a long-running server: the daily automation shortly after start and then every hour (each step is idempotent).
// On Vercel the same job runs from Vercel Cron instead (see vercel.json).
if (process.env.SCHEDULER !== 'off') {
  const tick = () => runDaily(db, { appUrl, trigger: 'timer' })
    .then((r) => console.log(`[automation] ${r.created} invoices created, ${r.confirmed} confirmed, ${r.sent} emailed, ${r.reminders} reminders (${r.ms} ms)`))
    .catch((e) => console.error('[automation] failed', e));
  setTimeout(tick, 5_000);
  setInterval(tick, Number(process.env.SCHEDULER_INTERVAL_MS ?? 3_600_000)).unref();
}

const shutdown = () => { http.close(() => void db.close().finally(() => process.exit(0))); setTimeout(() => process.exit(0), 5000).unref(); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
