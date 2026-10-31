import { Router } from 'express';

/** Development mailbox: shows emails the app would have sent. Only mounted in development or with DEV_MAILBOX=1. */
const router = Router();
router.get('/outbox', async (req, res) => {
  const rows = await req.db.query('SELECT id, to_email AS "toEmail", subject, body, created_at AS "createdAt" FROM outbox ORDER BY id DESC LIMIT 50');
  res.json({ rows });
});
export default router;
