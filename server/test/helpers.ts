import request from 'supertest';
import { openTestDb, type DB } from '../src/db/connection';
import { createApp } from '../src/app';
import { createUser } from '../src/services/auth';

export const PASSWORDS = { admin: 'Admin!pass1', staff: 'Staff!pass1', customer: 'Customer!1' };

export async function makeApp() {
  const db = await openTestDb();
  await createUser(db, { email: 'admin@brightloop.test', password: PASSWORDS.admin, name: 'Admin', role: 'admin' });
  await createUser(db, { email: 'staff@brightloop.test', password: PASSWORDS.staff, name: 'Staff', role: 'staff' });
  const app = createApp(db);
  return { app, db };
}

export async function loginAs(app: ReturnType<typeof createApp>, role: 'admin' | 'staff') {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: `${role}@brightloop.test`, password: PASSWORDS[role] });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

/** Sign up a new customer and return their signed-in agent. */
export async function signupCustomer(app: ReturnType<typeof createApp>, email: string, name = 'Customer') {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/signup').send({ name, email, password: PASSWORDS.customer });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, user: res.body.user as { id: number; customerId: number } };
}

export type { DB };
export type Catalog = Awaited<ReturnType<typeof catalog>>;

/** Inserts a small catalogue directly; returns the ids tests need. */
export async function catalog(db: DB) {
  const ins = async (sql: string, ...args: unknown[]) => (await db.prepare(sql).run(...args)).lastInsertRowid;
  const gst = await ins("INSERT INTO taxes (name, rate) VALUES ('GST 18%', 18)");
  const crm = await ins("INSERT INTO products (name, type, sales_price, cost_price, tax_id) VALUES ('Brightloop CRM', 'service', 150000, 20000, ?)", gst);
  const odoo = await ins("INSERT INTO product_variants (product_id, attribute, value, extra_price) VALUES (?, 'Brand', 'Odoo', 56000)", crm);
  const storage = await ins("INSERT INTO products (name, type, sales_price, cost_price, tax_id) VALUES ('Extra storage', 'service', 20000, 5000, ?)", gst);
  const monthly = await ins(`INSERT INTO plans (name, price, period, min_quantity, pausable, closable, renewable, tax_id)
                       VALUES ('Growth Monthly', 99900, 'monthly', 1, 1, 1, 1, ?)`, gst);
  const yearly = await ins(`INSERT INTO plans (name, price, period, min_quantity, pausable, closable, renewable)
                      VALUES ('Business Yearly', 999900, 'yearly', 5, 0, 0, 1)`);
  const fixedTerm = await ins(`INSERT INTO plans (name, price, period, min_quantity, auto_close, pausable, closable, renewable)
                         VALUES ('Pilot', 10000, 'weekly', 1, 1, 0, 1, 0)`);
  const retired = await ins(`INSERT INTO plans (name, price, period, start_date, end_date) VALUES ('Old', 100, 'monthly', '2020-01-01', '2020-12-31')`);
  const acme = await ins("INSERT INTO customers (name, email) VALUES ('Acme Ltd', 'ops@acme.test')");
  return { gst, crm, odoo, storage, monthly, yearly, fixedTerm, retired, acme };
}
