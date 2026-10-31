import { Router } from 'express';
import { z } from 'zod';
import { validate, notFound, pageOf, PAGE_SIZE, idParam } from '../http';
import { requireRole, me, actor } from '../middleware/auth';
import { camel, camelAll } from '../db/rows';
import { applySubscriptionAction, orderFromPortal, renewSubscription } from '../services/subscriptions';
import { checkoutStatus, completeSandbox, createCheckout, failCheckout, paymentProvider, verifyRazorpay } from '../services/payments';
import { getSettings } from '../services/settings';
import { detailJson } from './subscriptions';
import { invoiceJson, listInvoices } from './invoices';
import { publicOffers } from './public';
import type { DB } from '../db/connection';
import type { SubAction } from '../domain/lifecycle';
import { HttpError } from '../http';

const router = Router();
router.use(requireRole('customer'));

const cid = (req: Parameters<typeof me>[0]) => me(req).customerId ?? -1;

async function ownSubscription(db: DB, id: number, customerId: number) {
  const s = await db.prepare("SELECT id FROM subscriptions WHERE id = ? AND customer_id = ? AND status <> 'draft'").get(id, customerId);
  if (!s) throw notFound('Subscription');
}

router.get('/subscriptions', async (req, res) => {
  const { page, limit, offset } = pageOf(req.query);
  const where = "WHERE s.customer_id = ? AND s.status <> 'draft'";
  const total = (await req.db.prepare(`SELECT count(*) AS n FROM subscriptions s ${where}`).get<{ n: number }>(cid(req)))!.n;
  const rows = camelAll(await req.db.query(`SELECT s.id, s.number, s.status, s.start_date, s.expiry_date, s.next_invoice_date, s.valid_until, s.source,
      p.name AS plan_name, p.period, p.pausable, p.closable, p.renewable,
      p.price + coalesce((SELECT sum(l.quantity * l.unit_price) FROM subscription_lines l WHERE l.subscription_id = s.id), 0) AS recurring_amount,
      (SELECT i.id FROM invoices i WHERE i.subscription_id = s.id AND i.status = 'confirmed' AND i.kind <> 'credit_note' ORDER BY i.due_date LIMIT 1) AS open_invoice_id
    FROM subscriptions s JOIN plans p ON p.id = s.plan_id ${where} ORDER BY s.id DESC LIMIT ? OFFSET ?`, [cid(req), limit, offset]));
  res.json({ rows, total, page, pageSize: PAGE_SIZE });
});

router.get('/subscriptions/:id', async (req, res) => {
  const id = idParam(req);
  await ownSubscription(req.db, id, cid(req));
  const d = await detailJson(req.db, id) as unknown as { invoices: { status: string }[]; activity: { type: string; message: string; createdAt: string }[] };
  res.json({ ...d, invoices: d.invoices.filter((i) => i.status === 'confirmed' || i.status === 'paid'),
    activity: d.activity.map((a) => ({ type: a.type, message: a.message, createdAt: a.createdAt })) });
});

const PORTAL_ACTIONS: Record<string, SubAction | 'renew'> = { accept: 'confirm', pause: 'pause', resume: 'resume', close: 'close', renew: 'renew' };

router.post('/subscriptions/:id/actions/:action', async (req, res) => {
  const id = idParam(req);
  await ownSubscription(req.db, id, cid(req));
  const action = PORTAL_ACTIONS[String(req.params.action)];
  if (!action) throw notFound('Action');
  const b = validate(z.object({ reasonId: z.number().int().positive().nullable().optional(), note: z.string().max(500).optional() }), req.body ?? {});
  if (action === 'renew') {
    await renewSubscription(req.db, id, actor(req));
    res.json({ status: (await req.db.prepare('SELECT status FROM subscriptions WHERE id = ?').get<{ status: string }>(id))!.status });
    return;
  }
  res.json({ status: await applySubscriptionAction(req.db, id, action, actor(req), { reasonId: b.reasonId ?? null, note: b.note }) });
});

router.get('/invoices', async (req, res) => {
  const query = { ...req.query };
  if (!['confirmed', 'paid'].includes(String(query.status))) delete query.status;
  delete query.customerId;
  res.json(await listInvoices(req.db, query, cid(req), true));
});

async function ownInvoice(db: DB, id: number, customerId: number) {
  const inv = await db.prepare("SELECT id FROM invoices WHERE id = ? AND customer_id = ? AND status IN ('confirmed','paid')").get(id, customerId);
  if (!inv) throw notFound('Invoice');
}

router.get('/invoices/:id', async (req, res) => {
  const id = idParam(req);
  await ownInvoice(req.db, id, cid(req));
  const { billing, company } = await getSettings(req.db);
  const inv = await invoiceJson(req.db, id, false);
  res.json({ ...inv, onlinePayments: billing.onlinePayments, provider: paymentProvider(), company });
});

/* ---------- online payment ---------- */
router.post('/invoices/:id/checkout', async (req, res) => {
  const id = idParam(req);
  await ownInvoice(req.db, id, cid(req));
  const { billing } = await getSettings(req.db);
  if (!billing.onlinePayments) throw new HttpError(409, 'Online payment is switched off. Please pay by bank transfer.');
  res.status(201).json(await createCheckout(req.db, id, cid(req)));
});
router.get('/checkouts/:cid', async (req, res) => res.json(await checkoutStatus(req.db, String(req.params.cid), cid(req))));
router.post('/checkouts/:cid/sandbox', async (req, res) => {
  const b = validate(z.object({ success: z.boolean(), method: z.enum(['upi', 'card', 'netbanking']) }), req.body);
  res.json(await completeSandbox(req.db, String(req.params.cid), cid(req), b));
});
router.post('/checkouts/:cid/razorpay', async (req, res) => {
  const b = validate(z.object({ orderId: z.string().max(80), paymentId: z.string().max(80), signature: z.string().max(200), method: z.string().max(40).optional() }), req.body);
  res.json(await verifyRazorpay(req.db, String(req.params.cid), cid(req), b));
});
router.post('/checkouts/:cid/cancel', async (req, res) => {
  await failCheckout(req.db, String(req.params.cid), 'Cancelled by the customer', cid(req));
  res.json({ ok: true });
});

/* ---------- self-service ordering ---------- */
router.get('/offers', async (req, res) => res.json({ rows: await publicOffers(req.db) }));
router.post('/offers/:id/order', async (req, res) => {
  const b = validate(z.object({ quantity: z.number().int().min(1).max(1000).nullable().optional() }), req.body ?? {});
  const r = await orderFromPortal(req.db, idParam(req), cid(req), b.quantity ?? null, actor(req));
  res.status(201).json(r);
});

router.get('/close-reasons', async (req, res) => {
  res.json({ rows: await req.db.query("SELECT id, name FROM close_reasons WHERE active = 1 AND name NOT IN ('Unpaid invoices','Quotation expired') ORDER BY id") });
});

router.get('/profile', async (req, res) => {
  const c = await req.db.prepare('SELECT id, name, email, phone, company, address, gstin FROM customers WHERE id = ?').get(cid(req));
  if (!c) throw notFound('Profile');
  res.json(camel(c as Record<string, unknown>));
});

router.put('/profile', async (req, res) => {
  const b = validate(z.object({ name: z.string().trim().min(1, 'Enter your name.').max(120), phone: z.string().trim().max(40).default(''),
    company: z.string().trim().max(200).default(''), address: z.string().trim().max(500).default(''),
    gstin: z.string().trim().toUpperCase().max(15).regex(/^$|^[0-9]{2}[A-Z0-9]{13}$/, 'A GSTIN has 15 characters, starting with the state code.').default('') }), req.body);
  await req.db.tx(async (t) => {
    await t.query('UPDATE customers SET name = ?, phone = ?, company = ?, address = ?, gstin = ? WHERE id = ?', [b.name, b.phone, b.company, b.address, b.gstin, cid(req)]);
    await t.query('UPDATE users SET name = ? WHERE id = ?', [b.name, me(req).id]);
  });
  res.json({ ok: true });
});

export default router;
