/** Bump when SCHEMA changes; `migrate` re-applies the (idempotent) DDL once per version. */
export const SCHEMA_VERSION = 4;

/**
 * PostgreSQL schema. Money is integer paise, dates are DATE ('YYYY-MM-DD'), moments are TIMESTAMPTZ.
 * Flags are 0/1 SMALLINTs so filters read the same in every query.
 * Every statement is idempotent so the script can be re-run to upgrade an existing database.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  gstin TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customers_name ON customers(name);
CREATE INDEX IF NOT EXISTS customers_email ON customers(email);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','staff','customer')),
  customer_id INTEGER REFERENCES customers(id),
  active SMALLINT NOT NULL DEFAULT 1,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_customer ON users(customer_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS outbox (
  id SERIAL PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'logged' CHECK (status IN ('logged','sent','failed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_created ON outbox(created_at DESC);

CREATE TABLE IF NOT EXISTS taxes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  rate NUMERIC(6,3) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  active SMALLINT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('service','goods')) DEFAULT 'service',
  sales_price INTEGER NOT NULL CHECK (sales_price >= 0),
  cost_price INTEGER NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  notes TEXT NOT NULL DEFAULT '',
  tax_id INTEGER REFERENCES taxes(id),
  active SMALLINT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS product_variants (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  attribute TEXT NOT NULL,
  value TEXT NOT NULL,
  extra_price INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS variants_product ON product_variants(product_id);

CREATE TABLE IF NOT EXISTS plans (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  period TEXT NOT NULL CHECK (period IN ('daily','weekly','monthly','yearly')),
  min_quantity INTEGER NOT NULL DEFAULT 1 CHECK (min_quantity >= 1),
  start_date DATE,
  end_date DATE,
  auto_close SMALLINT NOT NULL DEFAULT 0,
  closable SMALLINT NOT NULL DEFAULT 1,
  pausable SMALLINT NOT NULL DEFAULT 0,
  renewable SMALLINT NOT NULL DEFAULT 1,
  tax_id INTEGER REFERENCES taxes(id),
  active SMALLINT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS quotation_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  validity_days INTEGER NOT NULL DEFAULT 30 CHECK (validity_days >= 1),
  payment_terms_days INTEGER NOT NULL DEFAULT 15,
  term_months INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  published SMALLINT NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS template_lines (
  id SERIAL PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES quotation_templates(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  variant_id INTEGER REFERENCES product_variants(id),
  quantity INTEGER NOT NULL CHECK (quantity >= 1)
);
CREATE INDEX IF NOT EXISTS template_lines_template ON template_lines(template_id);

CREATE TABLE IF NOT EXISTS close_reasons (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  churn SMALLINT NOT NULL DEFAULT 1,
  active SMALLINT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  template_id INTEGER REFERENCES quotation_templates(id),
  status TEXT NOT NULL CHECK (status IN ('draft','quotation','confirmed','active','paused','closed')) DEFAULT 'draft',
  start_date DATE NOT NULL,
  expiry_date DATE,
  valid_until DATE,
  payment_terms_days INTEGER NOT NULL DEFAULT 15 CHECK (payment_terms_days IN (0,15,30,45)),
  next_invoice_date DATE,
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'staff' CHECK (source IN ('staff','portal')),
  close_reason_id INTEGER REFERENCES close_reasons(id),
  close_note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS subs_customer ON subscriptions(customer_id);
CREATE INDEX IF NOT EXISTS subs_plan ON subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS subs_status_next ON subscriptions(status, next_invoice_date);
CREATE INDEX IF NOT EXISTS subs_expiry ON subscriptions(expiry_date) WHERE expiry_date IS NOT NULL;

CREATE TABLE IF NOT EXISTS subscription_lines (
  id SERIAL PRIMARY KEY,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  variant_id INTEGER REFERENCES product_variants(id),
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity >= 1),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  tax_id INTEGER REFERENCES taxes(id)
);
CREATE INDEX IF NOT EXISTS sublines_sub ON subscription_lines(subscription_id);

CREATE TABLE IF NOT EXISTS discounts (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('fixed','percent')),
  value INTEGER NOT NULL CHECK (value > 0),
  min_amount INTEGER NOT NULL DEFAULT 0,
  min_quantity INTEGER NOT NULL DEFAULT 0,
  start_date DATE,
  end_date DATE,
  usage_limit INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  scope TEXT NOT NULL CHECK (scope IN ('products','subscriptions')),
  active SMALLINT NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS discount_products (
  discount_id INTEGER NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  PRIMARY KEY (discount_id, product_id)
);
CREATE TABLE IF NOT EXISTS discount_subscriptions (
  discount_id INTEGER NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
  PRIMARY KEY (discount_id, subscription_id)
);

CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'recurring' CHECK (kind IN ('recurring','upsell','credit_note')),
  origin_invoice_id INTEGER REFERENCES invoices(id),
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL CHECK (status IN ('draft','confirmed','paid','cancelled')) DEFAULT 'draft',
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  invoice_date DATE NOT NULL,
  due_date DATE NOT NULL,
  subtotal INTEGER NOT NULL DEFAULT 0,
  discount_total INTEGER NOT NULL DEFAULT 0,
  tax_total INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  amount_paid INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  reminder_count INTEGER NOT NULL DEFAULT 0,
  last_reminder_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_per_period ON invoices(subscription_id, period_start) WHERE status <> 'cancelled' AND kind = 'recurring';
CREATE INDEX IF NOT EXISTS invoices_status_due ON invoices(status, due_date);
CREATE INDEX IF NOT EXISTS invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS invoices_subscription ON invoices(subscription_id);
CREATE INDEX IF NOT EXISTS invoices_date ON invoices(invoice_date);
CREATE INDEX IF NOT EXISTS invoices_origin ON invoices(origin_invoice_id) WHERE origin_invoice_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS invoice_lines (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  subtotal INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  tax_rate NUMERIC(6,3) NOT NULL DEFAULT 0,
  tax INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS invlines_invoice ON invoice_lines(invoice_id);

CREATE TABLE IF NOT EXISTS discount_usages (
  discount_id INTEGER NOT NULL REFERENCES discounts(id),
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  PRIMARY KEY (discount_id, invoice_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  kind TEXT NOT NULL DEFAULT 'payment' CHECK (kind IN ('payment','refund')),
  method TEXT NOT NULL CHECK (method IN ('bank_transfer','card','upi','cash','cheque','netbanking','wallet','credit_note')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  date DATE NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT 'manual' CHECK (provider IN ('manual','razorpay','sandbox','system')),
  provider_ref TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS payments_date ON payments(date);
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_ref ON payments(provider, provider_ref) WHERE provider_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS checkouts (
  id TEXT PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  provider TEXT NOT NULL CHECK (provider IN ('razorpay','sandbox')),
  provider_order_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','expired')),
  failure TEXT,
  payment_id INTEGER REFERENCES payments(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS checkouts_invoice ON checkouts(invoice_id);
CREATE UNIQUE INDEX IF NOT EXISTS checkouts_order ON checkouts(provider_order_id) WHERE provider_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS mrr_events (
  id SERIAL PRIMARY KEY,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('new','expansion','contraction','churn','reactivation')),
  delta INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mrr_events_date ON mrr_events(date);
CREATE INDEX IF NOT EXISTS mrr_events_sub ON mrr_events(subscription_id);

CREATE TABLE IF NOT EXISTS activity (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  type TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  customer_id INTEGER,
  actor_id INTEGER,
  actor_name TEXT NOT NULL DEFAULT 'System',
  message TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS activity_entity ON activity(entity, entity_id, id DESC);
CREATE INDEX IF NOT EXISTS activity_customer ON activity(customer_id, id DESC);
CREATE INDEX IF NOT EXISTS activity_subscription ON activity (((data->>'subscriptionId')::int), id DESC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  hits INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS job_runs (
  id SERIAL PRIMARY KEY,
  job TEXT NOT NULL,
  triggered_by TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  ok SMALLINT,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS job_runs_started ON job_runs(started_at DESC);

INSERT INTO close_reasons (name, churn) VALUES
  ('Too expensive', 1), ('Missing features', 1), ('Switched to a competitor', 1), ('No longer needed', 1),
  ('Business closed', 1), ('Unpaid invoices', 1), ('Quotation expired', 0), ('Moved to another plan', 0), ('Other', 1)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS counters (
  kind TEXT NOT NULL,
  year INTEGER NOT NULL,
  value INTEGER NOT NULL,
  PRIMARY KEY (kind, year)
);
`;
