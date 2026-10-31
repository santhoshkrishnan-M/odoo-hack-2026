import './env';
import { createApp } from './app';
import { openFromEnv, type DB } from './db/connection';

/**
 * Vercel Function entry. The database pool is created once per instance and reused across requests;
 * the schema is checked on the first request of each cold start (a single cheap query once up to date).
 */
let ready: Promise<DB> | null = null;
const getDb = () => (ready ??= openFromEnv().catch((e) => { ready = null; throw e; }));

process.env.NODE_ENV ??= 'production';
const app = createApp(getDb);

export default app;
