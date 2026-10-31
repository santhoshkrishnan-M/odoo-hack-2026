// Loads ./.env when present (Node 22's built-in loader). Real environment variables win.
try { process.loadEnvFile?.(); } catch { /* no .env file — fine */ }
