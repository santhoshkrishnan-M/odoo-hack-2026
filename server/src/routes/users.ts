import { Router } from 'express';
import { z } from 'zod';
import { validate, notFound, idParam, HttpError } from '../http';
import { requireRole, me, actor } from '../middleware/auth';
import { createUser } from '../services/auth';
import { logActivity } from '../services/activity';

const router = Router();
router.use(requireRole('admin'));

router.get('/', async (req, res) => {
  const rows = await req.db.query(`SELECT id, email, name, role, active, created_at AS "createdAt", last_login_at AS "lastLoginAt"
    FROM users WHERE role IN ('admin','staff') ORDER BY role, name`);
  res.json({ rows });
});

router.post('/', async (req, res) => {
  const body = validate(z.object({ name: z.string().trim().min(1, 'Enter a name.').max(120), email: z.string().trim().email('Enter a valid email address.'), password: z.string().max(200) }), req.body);
  const user = await createUser(req.db, { ...body, role: 'staff' });
  await logActivity(req.db, { type: 'user.created', entity: 'user', entityId: user.id, actor: actor(req), message: `${user.name} added as staff.` });
  res.status(201).json(user);
});

router.patch('/:id', async (req, res) => {
  const body = validate(z.object({ active: z.boolean() }), req.body);
  const id = idParam(req);
  if (id === me(req).id) throw new HttpError(409, 'You cannot deactivate your own account.');
  const r = await req.db.prepare("UPDATE users SET active = ? WHERE id = ? AND role = 'staff' RETURNING name").run(body.active ? 1 : 0, id);
  if (!r.changes) throw notFound('Staff member');
  if (!body.active) await req.db.query('DELETE FROM sessions WHERE user_id = ?', [id]);
  await logActivity(req.db, { type: 'user.updated', entity: 'user', entityId: id, actor: actor(req), message: `${r.rows[0].name} ${body.active ? 'reactivated' : 'deactivated'}.` });
  res.json({ ok: true });
});

export default router;
