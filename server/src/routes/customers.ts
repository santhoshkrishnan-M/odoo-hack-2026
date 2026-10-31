import { Router } from 'express';
import { z } from 'zod';
import { validate, notFound, pageOf, PAGE_SIZE, idParam } from '../http';
import { requireRole, actor } from '../middleware/auth';
import { camel, camelAll } from '../db/rows';
import { normalizeEmail } from '../domain/password';
import { logActivity } from '../services/activity';

const router = Router();
router.use(requireRole('admin', 'staff'));

export const customerSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(120),
  email: z.string().trim().email('Enter a valid email address.').max(200).transform(normalizeEmail),
  phone: z.string().trim().max(40).default(''),
  company: z.string().trim().max(200).default(''),
  address: z.string().trim().max(500).default(''),
  gstin: z.string().trim().toUpperCase().max(15).regex(/^$|^[0-9]{2}[A-Z0-9]{13}$/, 'A GSTIN has 15 characters, starting with the state code.').default(''),
});

router.get('/', async (req, res) => {
  const { page, limit, offset } = pageOf(req.query);
  const q = `%${String(req.query.q ?? '').trim()}%`;
  const where = 'WHERE c.name ILIKE ? OR c.email ILIKE ? OR c.company ILIKE ?';
  const total = (await req.db.prepare(`SELECT count(*) AS n FROM customers c ${where}`).get<{ n: number }>(q, q, q))!.n;
  const rows = camelAll(await req.db.query(`SELECT c.*,
      (SELECT count(*) FROM subscriptions s WHERE s.customer_id = c.id AND s.status = 'active') AS active_subscriptions,
      (SELECT coalesce(sum(i.total - i.amount_paid), 0) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'confirmed' AND i.kind <> 'credit_note') AS balance,
      EXISTS (SELECT 1 FROM users u WHERE u.customer_id = c.id) AS has_portal
     FROM customers c ${where} ORDER BY c.name, c.id LIMIT ? OFFSET ?`, [q, q, q, limit, offset]));
  res.json({ rows, total, page, pageSize: PAGE_SIZE });
});

router.get('/:id', async (req, res) => {
  const id = idParam(req);
  const c = await req.db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!c) throw notFound('Customer');
  const activity = await req.db.query(`SELECT id, created_at AS "createdAt", type, actor_name AS "actorName", message FROM activity WHERE customer_id = ? ORDER BY id DESC LIMIT 25`, [id]);
  res.json({ ...camel(c as Record<string, unknown>), activity });
});

router.post('/', async (req, res) => {
  const b = validate(customerSchema, req.body);
  const r = await req.db.prepare('INSERT INTO customers (name, email, phone, company, address, gstin) VALUES (?, ?, ?, ?, ?, ?)').run(b.name, b.email, b.phone, b.company, b.address, b.gstin);
  await logActivity(req.db, { type: 'customer.created', entity: 'customer', entityId: r.lastInsertRowid, customerId: r.lastInsertRowid, actor: actor(req), message: `Customer ${b.name} added.` });
  res.status(201).json({ id: r.lastInsertRowid });
});

router.put('/:id', async (req, res) => {
  const b = validate(customerSchema, req.body);
  const id = idParam(req);
  const r = await req.db.prepare('UPDATE customers SET name = ?, email = ?, phone = ?, company = ?, address = ?, gstin = ? WHERE id = ?').run(b.name, b.email, b.phone, b.company, b.address, b.gstin, id);
  if (!r.changes) throw notFound('Customer');
  await logActivity(req.db, { type: 'customer.updated', entity: 'customer', entityId: id, customerId: id, actor: actor(req), message: `Customer ${b.name} updated.` });
  res.json({ ok: true });
});

export default router;
