import '../env';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, rmSync } from 'node:fs';
import { migrate, openPglite, openFromEnv, type DB } from './connection';
import { createUser } from '../services/auth';
import { activateSubscription, applySubscriptionAction, createSubscription } from '../services/subscriptions';
import { runBilling } from '../services/billing';
import { addDays, addPeriods, today as realToday } from '../domain/periods';

export const DEMO_USERS = {
  admin: { email: 'admin@brightloop.test', password: 'Admin!pass1', name: 'Meera Iyer' },
  staff: { email: 'staff@brightloop.test', password: 'Staff!pass1', name: 'Karthik Raman' },
  customer: { email: 'customer@brightloop.test', password: 'Customer!1', name: 'Ananya Rao' },
};

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Aarav', 'Diya', 'Rohan', 'Ishita', 'Vikram', 'Sneha', 'Arjun', 'Kavya', 'Nikhil', 'Priya', 'Rahul', 'Lakshmi', 'Siddharth', 'Neha', 'Varun', 'Pooja', 'Aditya', 'Meghna', 'Harish', 'Divya'];
const LAST = ['Sharma', 'Nair', 'Reddy', 'Menon', 'Gupta', 'Pillai', 'Joshi', 'Krishnan', 'Bose', 'Kulkarni', 'Das', 'Verma', 'Subramanian', 'Mehta', 'Rao'];
const CO_A = ['Kaveri', 'Nilgiri', 'Coromandel', 'Deccan', 'Malabar', 'Konkan', 'Vindhya', 'Ganga', 'Thar', 'Sahyadri', 'Godavari', 'Palk', 'Ashoka', 'Lotus', 'Peacock', 'Banyan', 'Monsoon', 'Saffron', 'Indigo', 'Teak'];
const CO_B = ['Textiles', 'Logistics', 'Foods', 'Clinics', 'Motors', 'Traders', 'Hotels', 'Pharma', 'Builders', 'Labs', 'Retail', 'Exports', 'Studios', 'Agro', 'Solar', 'Tutors', 'Bakers', 'Steel', 'Couriers', 'Media'];
const CO_C = ['Pvt Ltd', 'LLP', '& Co', 'Ltd', 'Enterprises', 'Works'];
const STATES = ['33', '29', '32', '36', '27', '24'];

export async function seed(db: DB, opts: { subscriptions: number; today?: string; withUsers?: boolean }) {
  const today = opts.today ?? realToday();
  const r = rng(42);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const ins = async (sql: string, ...args: unknown[]) => (await db.prepare(sql).run(...args)).lastInsertRowid;

  await db.tx(async (tx) => {
    const db = tx;
    const ins = async (sql: string, ...args: unknown[]) => (await db.prepare(sql).run(...args)).lastInsertRowid;
    if (opts.withUsers !== false) {
      await createUser(db, { ...DEMO_USERS.admin, role: 'admin' });
      await createUser(db, { ...DEMO_USERS.staff, role: 'staff' });
    }

    const gst18 = await ins("INSERT INTO taxes (name, rate) VALUES ('GST 18%', 18)");
    const gst5 = await ins("INSERT INTO taxes (name, rate) VALUES ('GST 5%', 5)");
    await ins("INSERT INTO taxes (name, rate) VALUES ('Exempt', 0)");

    const crm = await ins(`INSERT INTO products (name, type, sales_price, cost_price, notes, tax_id) VALUES ('Brightloop CRM seat', 'service', 150000, 22000,
      'Per-user licence for the CRM. Choose a brand variant for partner-branded editions.', ?)`, gst18);
    const odoo = await ins("INSERT INTO product_variants (product_id, attribute, value, extra_price) VALUES (?, 'Brand', 'Odoo', 56000)", crm);
    const bl = await ins("INSERT INTO product_variants (product_id, attribute, value, extra_price) VALUES (?, 'Brand', 'Brightloop', 0)", crm);
    const analytics = await ins("INSERT INTO products (name, type, sales_price, cost_price, notes, tax_id) VALUES ('Analytics add-on', 'service', 40000, 6000, 'Dashboards and exports.', ?)", gst18);
    const storage = await ins("INSERT INTO products (name, type, sales_price, cost_price, notes, tax_id) VALUES ('Extra storage, 100 GB', 'service', 20000, 7000, '', ?)", gst18);
    const support = await ins("INSERT INTO products (name, type, sales_price, cost_price, notes, tax_id) VALUES ('Priority support', 'service', 90000, 30000, 'Four-hour response, weekdays.', ?)", gst18);
    const kit = await ins("INSERT INTO products (name, type, sales_price, cost_price, notes, tax_id) VALUES ('Barcode scanner rental', 'goods', 35000, 18000, 'Hardware rented by the month.', ?)", gst5);
    const sms = await ins("INSERT INTO products (name, type, sales_price, cost_price, notes, tax_id) VALUES ('SMS pack, 5,000', 'service', 25000, 15000, '', ?)", gst18);
    await ins("INSERT INTO product_variants (product_id, attribute, value, extra_price) VALUES (?, 'Region', 'India', 0)", sms);
    await ins("INSERT INTO product_variants (product_id, attribute, value, extra_price) VALUES (?, 'Region', 'International', 30000)", sms);

    const starter = await ins(`INSERT INTO plans (name, price, period, min_quantity, start_date, auto_close, closable, pausable, renewable, tax_id)
      VALUES ('Starter Monthly', 49900, 'monthly', 1, '2024-01-01', 0, 1, 1, 1, ?)`, gst18);
    const growth = await ins(`INSERT INTO plans (name, price, period, min_quantity, start_date, auto_close, closable, pausable, renewable, tax_id)
      VALUES ('Growth Monthly', 99900, 'monthly', 1, '2024-01-01', 0, 1, 1, 1, ?)`, gst18);
    const business = await ins(`INSERT INTO plans (name, price, period, min_quantity, start_date, auto_close, closable, pausable, renewable, tax_id)
      VALUES ('Business Yearly', 999900, 'yearly', 5, '2024-01-01', 0, 0, 0, 1, ?)`, gst18);
    const pilot = await ins(`INSERT INTO plans (name, price, period, min_quantity, start_date, auto_close, closable, pausable, renewable, tax_id)
      VALUES ('Weekly Pilot', 25000, 'weekly', 1, '2024-01-01', 1, 1, 0, 0, ?)`, gst18);
    const trial = await ins(`INSERT INTO plans (name, price, period, min_quantity, start_date, end_date, auto_close, closable, pausable, renewable, tax_id)
      VALUES ('Daily Trial', 4900, 'daily', 1, '2024-01-01', ?, 1, 1, 0, 0, ?)`, addDays(today, 60), gst18);

    const t1 = await ins(`INSERT INTO quotation_templates (name, plan_id, validity_days, payment_terms_days, term_months, notes, published, description)
      VALUES ('Growth, 10 seats', ?, 30, 15, NULL, 'Monthly plan for a growing sales team.', 1, 'Ten Odoo-branded CRM seats with analytics, billed monthly. Cancel any time.')`, growth);
    await ins('INSERT INTO template_lines (template_id, product_id, variant_id, quantity) VALUES (?, ?, ?, 10), (?, ?, NULL, 1)', t1, crm, odoo, t1, analytics);
    const t2 = await ins(`INSERT INTO quotation_templates (name, plan_id, validity_days, payment_terms_days, term_months, notes, published, description)
      VALUES ('Enterprise, yearly', ?, 21, 30, 12, 'Annual contract with priority support.', 0, '')`, business);
    await ins('INSERT INTO template_lines (template_id, product_id, variant_id, quantity) VALUES (?, ?, ?, 25), (?, ?, NULL, 5), (?, ?, NULL, 5)', t2, crm, bl, t2, storage, t2, support);
    const t3 = await ins(`INSERT INTO quotation_templates (name, plan_id, validity_days, payment_terms_days, term_months, notes, published, description)
      VALUES ('Four-week pilot', ?, 7, 0, 1, '', 1, 'Try Brightloop CRM with three seats for four weeks, billed weekly.')`, pilot);
    await ins('INSERT INTO template_lines (template_id, product_id, variant_id, quantity) VALUES (?, ?, ?, 3)', t3, crm, bl);
    const t4 = await ins(`INSERT INTO quotation_templates (name, plan_id, validity_days, payment_terms_days, term_months, notes, published, description)
      VALUES ('Starter, 3 seats', ?, 30, 0, NULL, '', 1, 'Three CRM seats for a small team, billed monthly.')`, starter);
    await ins('INSERT INTO template_lines (template_id, product_id, variant_id, quantity) VALUES (?, ?, ?, 3)', t4, crm, bl);

    await ins(`INSERT INTO discounts (name, type, value, min_quantity, start_date, end_date, usage_limit, scope)
      VALUES ('Volume, 10+ seats', 'percent', 10, 10, ?, NULL, NULL, 'subscriptions')`, addPeriods(today, 'monthly', -18));
    await ins(`INSERT INTO discounts (name, type, value, min_amount, start_date, end_date, usage_limit, scope)
      VALUES ('Launch offer', 'fixed', 50000, 100000, ?, ?, 400, 'subscriptions')`, addPeriods(today, 'monthly', -6), addPeriods(today, 'monthly', 1));
    const anaDisc = await ins(`INSERT INTO discounts (name, type, value, start_date, end_date, usage_limit, scope)
      VALUES ('Analytics 20% off', 'percent', 20, ?, ?, NULL, 'products')`, addPeriods(today, 'monthly', -3), addPeriods(today, 'monthly', 3));
    await db.query('INSERT INTO discount_products VALUES (?, ?)', [anaDisc, analytics]);

    const nCustomers = Math.max(1, Math.round(opts.subscriptions / 2.4));
    const customers: number[] = [];
    for (let i = 0; i < nCustomers; i += 200) {
      const values: unknown[] = [];
      const tuples: string[] = [];
      for (let k = i; k < Math.min(nCustomers, i + 200); k++) {
        const person = `${pick(FIRST)} ${pick(LAST)}`;
        const company = `${pick(CO_A)} ${pick(CO_B)} ${pick(CO_C)}`;
        const slug = company.toLowerCase().replace(/[^a-z]+/g, '');
        const gstin = r() < 0.7 ? `${pick(STATES)}${Array.from({ length: 5 }, () => String.fromCharCode(65 + Math.floor(r() * 26))).join('')}${String(Math.floor(r() * 9000) + 1000)}${String.fromCharCode(65 + Math.floor(r() * 26))}1Z${Math.floor(r() * 9)}` : '';
        values.push(person, `${person.split(' ')[0].toLowerCase()}.${k}@${slug}.in`, `+91 9${String(Math.floor(r() * 1e9)).padStart(9, '0')}`, company,
          pick(['Chennai', 'Coimbatore', 'Bengaluru', 'Kochi', 'Hyderabad', 'Pune', 'Mumbai', 'Madurai', 'Mysuru', 'Ahmedabad']), gstin);
        tuples.push('(?, ?, ?, ?, ?, ?)');
      }
      const rows = await db.query<{ id: number }>(`INSERT INTO customers (name, email, phone, company, address, gstin) VALUES ${tuples.join(', ')} RETURNING id`, values);
      customers.push(...rows.map((x) => x.id));
    }

    // The demo portal customer.
    const demoCustomer = await ins("INSERT INTO customers (name, email, phone, company, address, gstin) VALUES (?, ?, '+91 98400 12345', 'Kaveri Textiles Pvt Ltd', '14 Avinashi Road, Coimbatore', '33AAKCK4821M1Z2')",
      DEMO_USERS.customer.name, DEMO_USERS.customer.email);
    if (opts.withUsers !== false) await createUser(db, { ...DEMO_USERS.customer, role: 'customer', customerId: demoCustomer });

    const unit = new Map<string, number>();
    for (const row of await db.query<{ id: number; sales_price: number }>('SELECT id, sales_price FROM products')) unit.set(`${row.id}:`, row.sales_price);
    for (const v of await db.query<{ id: number; product_id: number; extra_price: number }>('SELECT id, product_id, extra_price FROM product_variants')) unit.set(`${v.product_id}:${v.id}`, unit.get(`${v.product_id}:`)! + v.extra_price);

    const planChoices = [starter, starter, growth, growth, growth, business, pilot, trial];
    const created: { id: number; plan: number; final: string; start: string }[] = [];
    for (let i = 0; i < opts.subscriptions; i++) {
      const plan = pick(planChoices);
      const x = r();
      const final = x < 0.05 ? 'draft' : x < 0.1 ? 'quotation' : x < 0.13 ? 'confirmed' : x < 0.2 ? 'paused' : x < 0.27 ? 'closed' : 'active';
      const lookback = plan === pilot ? 90 : plan === trial ? 40 : 430;
      let start = addDays(today, -Math.floor(r() * lookback));
      if (final === 'draft' || final === 'quotation' || final === 'confirmed') start = addDays(today, Math.floor(r() * 20));
      const seats = plan === business ? 5 + Math.floor(r() * 40) : 1 + Math.floor(r() * 14);
      const lines: { productId: number; variantId: number | null; quantity: number; unitPrice?: number }[] = [{ productId: crm, variantId: r() < 0.4 ? odoo : bl, quantity: seats }];
      if (r() < 0.35) lines.push({ productId: analytics, variantId: null, quantity: plan === business ? 5 : 1 });
      if (r() < 0.25) lines.push({ productId: storage, variantId: null, quantity: 1 + Math.floor(r() * 4) + (plan === business ? 4 : 0) });
      if (r() < 0.12) lines.push({ productId: support, variantId: null, quantity: plan === business ? 5 : 1 });
      if (r() < 0.08) lines.push({ productId: kit, variantId: null, quantity: plan === business ? 5 : 1 + Math.floor(r() * 3) });
      // Product prices are monthly; short plans charge the same rate per day or week.
      const perPeriod = plan === pilot ? 12 / 52 : plan === trial ? 12 / 365 : plan === business ? 12 : 1;
      if (perPeriod !== 1) for (const l of lines) l.unitPrice = Math.round(unit.get(`${l.productId}:${l.variantId ?? ''}`)! * perPeriod);
      let expiry: string | null = null;
      if (plan === business) { expiry = addPeriods(start, 'yearly', 1); while (expiry <= today) expiry = addPeriods(expiry, 'yearly', 1); }
      if (plan === pilot) expiry = addDays(start, 28);
      if (plan === trial) expiry = addDays(start, 14);
      const customerId = i < 6 ? demoCustomer : pick(customers);
      const terms = pick([0, 15, 15, 15, 30, 30, 45]) as 0 | 15 | 30 | 45;
      const status = final === 'draft' ? 'draft' : 'quotation';
      const { id } = await createSubscription(db, { customerId, planId: plan, startDate: start, expiryDate: expiry, paymentTermsDays: terms, lines,
        validUntil: final === 'quotation' ? addDays(today, 5 + Math.floor(r() * 20)) : null }, null, status as 'draft' | 'quotation');
      if (final !== 'draft' && final !== 'quotation') {
        await applySubscriptionAction(db, id, 'confirm');
        if (final !== 'confirmed') await activateSubscription(db, id);
      }
      created.push({ id, plan, final, start });
    }
    // Two of the demo customer's subscriptions run, one waits as a quotation for them to accept.
    const demo = created.slice(0, 6);
    for (const d of demo.slice(0, 2)) if (d.final !== 'active' && d.start <= today) {
      const s = await db.prepare('SELECT status FROM subscriptions WHERE id = ?').get<{ status: string }>(d.id);
      if (s!.status === 'draft') await applySubscriptionAction(db, d.id, 'send');
      if (['draft', 'quotation'].includes((await db.prepare('SELECT status FROM subscriptions WHERE id = ?').get<{ status: string }>(d.id))!.status)) await applySubscriptionAction(db, d.id, 'confirm');
      if ((await db.prepare('SELECT status FROM subscriptions WHERE id = ?').get<{ status: string }>(d.id))!.status === 'confirmed') await activateSubscription(db, d.id);
      d.final = 'active';
    }

    await runBilling(db, today);

    // Paused and closed ones stop part-way through their history; their MRR leaves at the start of the last billed period.
    const closeReasons = (await db.query<{ id: number; name: string }>("SELECT id, name FROM close_reasons WHERE churn = 1 AND name <> 'Unpaid invoices'")).map((x) => x.id);
    for (const s of created) {
      if (s.final !== 'paused' && s.final !== 'closed') continue;
      const row = await db.prepare(`SELECT s.status, (SELECT max(period_start) FROM invoices i WHERE i.subscription_id = s.id) AS last FROM subscriptions s WHERE s.id = ?`)
        .get<{ status: string; last: string | null }>(s.id);
      if (row?.status !== 'active') continue;
      const when = row.last ?? s.start;
      const mrr = (await db.prepare(`SELECT coalesce(sum(delta), 0) AS v FROM mrr_events WHERE subscription_id = ?`).get<{ v: number }>(s.id))!.v;
      if (s.final === 'paused') {
        await db.query("UPDATE subscriptions SET status = 'paused' WHERE id = ?", [s.id]);
        await db.query("INSERT INTO mrr_events (subscription_id, date, kind, delta) VALUES (?, ?, 'contraction', ?)", [s.id, when, -mrr]);
      } else {
        await db.query("UPDATE subscriptions SET status = 'closed', closed_at = ?::date + time '18:00', close_reason_id = ? WHERE id = ?", [when, pick(closeReasons), s.id]);
        await db.query("INSERT INTO mrr_events (subscription_id, date, kind, delta) VALUES (?, ?, 'churn', ?)", [s.id, when, -mrr]);
      }
    }
    // Some long-running customers grew: split part of their MRR into a later expansion.
    const grown = await db.query<{ id: number; delta: number; date: string }>(`SELECT m.id, m.delta, m.date FROM mrr_events m JOIN subscriptions s ON s.id = m.subscription_id
      WHERE m.kind = 'new' AND s.status = 'active' AND m.date < ?::date - 120 AND m.subscription_id % 6 = 0`, [today]);
    for (const g of grown) {
      const part = Math.round(g.delta * (0.2 + r() * 0.3));
      const when = addDays(g.date, 30 + Math.floor(r() * 90));
      await db.query('UPDATE mrr_events SET delta = delta - ? WHERE id = ?', [part, g.id]);
      await db.query("INSERT INTO mrr_events (subscription_id, date, kind, delta) SELECT subscription_id, ?, 'expansion', ? FROM mrr_events WHERE id = ?", [when, part, g.id]);
    }

    // Billing history: everything older than a few days is confirmed and was emailed; most are paid.
    const recentCutoff = addDays(today, -3);
    await db.query(`UPDATE invoices SET status = 'confirmed', confirmed_at = invoice_date + time '09:00', sent_at = invoice_date + time '09:05'
      WHERE status = 'draft' AND invoice_date <= ?`, [recentCutoff]);
    const open = await db.query<{ id: number; total: number; invoice_date: string; due_date: string }>("SELECT id, total, invoice_date, due_date FROM invoices WHERE status = 'confirmed' AND total > 0 ORDER BY id");
    const methods = ['bank_transfer', 'bank_transfer', 'upi', 'upi', 'card', 'cheque', 'cash'];
    const notes = ['', '', '', 'NEFT ref ', 'UPI ref ', 'Paid via portal link', 'Cheque no. '];
    const pays: unknown[][] = [];
    const paid: [number, number][] = [];
    for (const inv of open) {
      const x = r();
      const lag = Math.floor(r() * (Math.max(3, Number(inv.due_date.slice(8)) % 20 + 10)));
      const date = addDays(inv.invoice_date, lag);
      if (date > today) continue;
      const recentDue = inv.due_date >= addDays(today, -20);
      if (x < (recentDue ? 0.6 : 0.985)) {
        const m = pick(methods);
        const n = pick(notes);
        const online = m === 'upi' || m === 'card' ? r() < 0.5 : false;
        pays.push([inv.id, m, inv.total, date, online ? 'Paid online' : n.endsWith(' ') ? `${n}${Math.floor(r() * 900000 + 100000)}` : n, online ? 'sandbox' : 'manual',
          online ? `pay_test_${Math.floor(r() * 1e12).toString(16)}${inv.id}` : null]);
        paid.push([inv.id, inv.total]);
      } else if (x < (recentDue ? 0.68 : 0.992)) {
        const part = Math.round(inv.total * (0.3 + r() * 0.4));
        pays.push([inv.id, pick(methods), part, date, 'Part payment', 'manual', null]);
        paid.push([inv.id, part]);
      }
    }
    for (let i = 0; i < pays.length; i += 500) {
      const chunk = pays.slice(i, i + 500);
      await db.query(`INSERT INTO payments (invoice_id, method, amount, date, note, provider, provider_ref) VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')}`, chunk.flat());
    }
    for (let i = 0; i < paid.length; i += 1000) {
      const chunk = paid.slice(i, i + 1000);
      await db.query(`UPDATE invoices i SET amount_paid = v.amt, status = CASE WHEN v.amt >= i.total THEN 'paid' ELSE i.status END
        FROM (SELECT unnest(?::int[]) AS id, unnest(?::int[]) AS amt) v WHERE v.id = i.id`, [chunk.map((c) => c[0]), chunk.map((c) => c[1])]);
    }
    await db.query("UPDATE invoices SET status = 'paid' WHERE status = 'confirmed' AND total = 0");
    // Overdue invoices already had the reminders due so far (1, 7 and 14 days late), so the first automation run stays quiet.
    await db.query(`UPDATE invoices SET reminder_count = CASE WHEN ?::date - due_date >= 14 THEN 3 WHEN ?::date - due_date >= 7 THEN 2 ELSE 1 END,
        last_reminder_at = due_date + CASE WHEN ?::date - due_date >= 14 THEN 14 WHEN ?::date - due_date >= 7 THEN 7 ELSE 1 END + time '08:00'
      WHERE status = 'confirmed' AND due_date <= ?::date - 1`, [today, today, today, today, today]);

    // A readable recent activity feed instead of thousands of identical seed entries.
    await db.query('DELETE FROM activity');
    await db.query(`INSERT INTO activity (created_at, type, entity, entity_id, customer_id, actor_name, message, data)
      SELECT p.date + time '10:00' + (p.id % 480) * interval '1 minute', 'payment.received', 'invoice', i.id, i.customer_id,
        CASE WHEN p.provider = 'sandbox' THEN 'Online payment' ELSE 'Karthik Raman' END,
        '₹' || to_char(p.amount / 100.0, 'FM99,99,99,990.00') || ' received' || CASE WHEN p.provider = 'sandbox' THEN ' online' ELSE '' END || ' on ' || i.number || ' by ' || replace(p.method, '_', ' ') || '.',
        jsonb_build_object('amount', p.amount, 'subscriptionId', i.subscription_id)
      FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.date >= ?::date - 10 ORDER BY p.date, p.id`, [today]);
    await db.query(`INSERT INTO activity (created_at, type, entity, entity_id, customer_id, actor_name, message, data)
      SELECT s.start_date + time '11:30', 'subscription.activated', 'subscription', s.id, s.customer_id, 'Meera Iyer', s.number || ' is active on ' || p.name || '.', '{"status":"active"}'::jsonb
      FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.status = 'active' AND s.start_date BETWEEN ?::date - 10 AND ?::date`, [today, today]);
  });
  void ins;
}

/** Tables in foreign-key order, for copying a seeded database into another one. */
const COPY_ORDER = ['customers', 'users', 'taxes', 'products', 'product_variants', 'plans', 'quotation_templates', 'template_lines', 'subscriptions', 'subscription_lines',
  'discounts', 'discount_products', 'discount_subscriptions', 'invoices', 'invoice_lines', 'discount_usages', 'payments', 'mrr_events', 'activity', 'outbox', 'counters', 'settings'];

/**
 * Seeds `target`. A remote database would need ~150k round trips, so the demo company is built in an in-process
 * PGlite first and then copied over in large JSON batches (a few dozen statements).
 */
export async function seedInto(target: DB, subscriptions: number, opts: { viaCopy?: boolean } = {}) {
  const t0 = performance.now();
  if (!(opts.viaCopy ?? target.engine !== 'pglite')) {
    await seed(target, { subscriptions });
    return { subscriptions, ms: Math.round(performance.now() - t0), copied: false };
  }
  const local = await openPglite();
  await migrate(local);
  await seed(local, { subscriptions });
  const built = performance.now();
  const counts: Record<string, number> = {};
  await target.tx(async (t) => {
    await t.query('SELECT pg_advisory_xact_lock(72023)');
    if ((await t.query<{ n: number }>('SELECT count(*) AS n FROM users'))[0].n > 0) throw new Error('Target database already has data.');
    for (const table of COPY_ORDER) {
      const rows = await local.query(`SELECT * FROM ${table} ORDER BY 1`);
      counts[table] = rows.length;
      for (let i = 0; i < rows.length; i += 2000) {
        await t.query(`INSERT INTO ${table} SELECT * FROM json_populate_recordset(null::${table}, ?::json)`, [JSON.stringify(rows.slice(i, i + 2000))]);
      }
      if (['settings', 'counters', 'discount_products', 'discount_subscriptions', 'discount_usages'].includes(table)) continue;
      await t.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), greatest((SELECT max(id) FROM ${table}), 1))`);
    }
  });
  await local.close();
  return { subscriptions, buildMs: Math.round(built - t0), copyMs: Math.round(performance.now() - built), counts };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const n = Number(process.env.SEED_SUBSCRIPTIONS ?? 2400);
  if (!process.env.DATABASE_URL) {
    process.env.PGLITE_DIR ??= resolve('data/pglite');
    rmSync(process.env.PGLITE_DIR, { recursive: true, force: true });
    mkdirSync(process.env.PGLITE_DIR, { recursive: true });
  }
  const db = await openFromEnv();
  const t = performance.now();
  const result = await seedInto(db, n);
  const count = async (sql: string) => (await db.query<{ n: number }>(sql))[0].n;
  console.log(`Seeded ${db.engine} in ${Math.round(performance.now() - t)} ms: ${await count('SELECT count(*) AS n FROM subscriptions')} subscriptions, ` +
    `${await count('SELECT count(*) AS n FROM invoices')} invoices, ${await count('SELECT count(*) AS n FROM payments')} payments.`, result);
  console.log('Sign in as:');
  for (const [role, u] of Object.entries(DEMO_USERS)) console.log(`  ${role.padEnd(8)} ${u.email}  /  ${u.password}`);
  await db.close();
}
