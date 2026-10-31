# Subscription Management System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working web app for Brightloop that runs products, plans, quotations, subscriptions, automatic invoicing with taxes and discounts, payments, a customer portal and a finance dashboard.

**Architecture:** Express API in `server/` with three layers — pure `domain/` rules (unit tested), `services/` that own SQL and transactions, thin `routes/` that validate with zod and check roles. React SPA in `client/` talks to `/api`. In production Express serves the built client on one port.

**Tech Stack:** Node 22, TypeScript, Express 4/5, better-sqlite3, zod, bcryptjs, React 19, React Router, Vite, Vitest, supertest.

**Spec:** `docs/superpowers/specs/2026-10-31-subscription-management-design.md`

## Global Constraints

- Money is integer paise everywhere in the server and API; the client formats with `₹`.
- Dates are ISO `YYYY-MM-DD` strings; timestamps ISO strings.
- Password: length ≥ 9, ≥1 uppercase, ≥1 lowercase, ≥1 character that is neither letter nor digit.
- Emails: trimmed, lower-cased, unique.
- Reset token: 32 random bytes, SHA-256 stored, 60 minutes, single use.
- Numbers: `SUB/<year>/<5 digits>`, `INV/<year>/<5 digits>`.
- Roles: `admin`, `staff`, `customer`. Discounts, products, plans, taxes, users: write = admin only.
- HTTP: 400 validation (`{error, fields}`), 401 unauthenticated, 403 wrong role, 404 not found or not yours, 409 rule violation (`{error}` with a sentence).
- Lists: server-side pagination, 50 per page, `{rows, total, page, pageSize}`.
- Every page and list endpoint < 2 s with 3,000 subscriptions seeded.

## Review Focus

1. Billing is run twice (double click, two tabs) → still exactly one invoice per subscription period. Test in Task 7.
2. A monthly subscription that starts on the 31st → periods 31 Jan, 28/29 Feb, 31 Mar (anchored to the start day, no drift). Test in Task 1.
3. A discount with a usage limit of 2 during a run that bills 5 subscriptions → exactly 2 invoices carry it; cancelling one frees a use. Test in Task 7.
4. A signed-in customer requests another customer's subscription or invoice id → 404, not 403. Test in Task 8.
5. Payment larger than the balance, or on a Draft/Cancelled invoice → 409 and nothing recorded. Test in Task 8.

---

## File Structure

```
server/src/domain/   password.ts money.ts periods.ts lifecycle.ts pricing.ts
server/src/db/       schema.ts connection.ts seed.ts
server/src/services/ auth.ts numbering.ts subscriptions.ts billing.ts invoices.ts payments.ts reports.ts
server/src/routes/   auth.ts users.ts catalog.ts customers.ts discounts.ts templates.ts
                     subscriptions.ts invoices.ts payments.ts reports.ts portal.ts dev.ts
server/src/http.ts   (HttpError, asyncRoute, validate(zod), paginate)
server/src/middleware/auth.ts
server/src/app.ts    createApp(db)    server/src/index.ts   (listen + static client)
server/test/         *.test.ts   helpers.ts (makeApp(), loginAs(role))
client/src/          main.tsx api.ts auth.tsx styles.css format.ts
client/src/components/ Layout Table Field Pager Status Money Modal
client/src/pages/    auth/* dashboard subscriptions templates invoices payments customers
                     products plans taxes discounts users portal/* mailbox
```

---

### Task 1: Project scaffold and time/money/password rules

**Files:** Create `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `server/src/domain/{password,money,periods}.ts`, `server/test/domain.test.ts`; modify `package.json` scripts (`dev`, `build`, `start`, `test`, `seed`).

**Interfaces — Produces:**
- `validatePassword(pw: string): string[]` — messages, empty when valid.
- `normalizeEmail(email: string): string`
- `formatMoney(paise: number): string` → `"₹1,234.50"`
- `type Period = 'daily'|'weekly'|'monthly'|'yearly'`
- `addPeriods(anchor: string, period: Period, n: number): string` — n periods after `anchor`, month/year arithmetic anchored to the anchor's day, clamped to month end.
- `monthlyFactor(period: Period): number` — daily 365/12, weekly 52/12, monthly 1, yearly 1/12.

- [ ] **Step 1: Write failing tests**
  - `validatePassword('Short!1a')` has 1 message (length); `'alllowercase!'` reports uppercase; `'ALLUPPER!!X'` reports lowercase; `'NoSpecial123'` reports special; `'Valid!pass'` → `[]`.
  - `normalizeEmail('  Ann@X.COM ')` → `'ann@x.com'`.
  - `formatMoney(123450)` → `'₹1,234.50'`; `formatMoney(0)` → `'₹0.00'`.
  - `addPeriods('2026-01-31','monthly',1)` → `'2026-02-28'`; `(…,2)` → `'2026-03-31'`; `addPeriods('2028-02-29','yearly',1)` → `'2029-02-28'`; weekly +1 from `2026-10-31` → `2026-11-07`; daily +1 → `2026-11-01`.
- [ ] **Step 2: Run** `npx vitest run server/test/domain.test.ts` → FAIL (modules missing).
- [ ] **Step 3: Implement** the three modules (UTC date math, no libraries).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: project scaffold and domain rules for passwords, money, periods`.

### Task 2: Lifecycles and invoice pricing with discounts and taxes

**Files:** Create `server/src/domain/{lifecycle,pricing}.ts`, `server/test/pricing.test.ts`.

**Interfaces — Produces:**
- `type SubStatus = 'draft'|'quotation'|'confirmed'|'active'|'paused'|'closed'`
- `type SubAction = 'send'|'confirm'|'activate'|'pause'|'resume'|'close'`; `nextStatus(from: SubStatus, action: SubAction): SubStatus | null` — draft-send→quotation, draft/quotation-confirm→confirmed, confirmed-activate→active, active-pause→paused, paused-resume→active, draft/quotation/confirmed/active/paused-close→closed.
- `type InvStatus = 'draft'|'confirmed'|'paid'|'cancelled'`
- `interface PriceLine { productId: number|null; description: string; quantity: number; unitPrice: number; taxRate: number }` (taxRate in percent, e.g. 18)
- `interface DiscountRule { id: number; type: 'fixed'|'percent'; value: number; minAmount: number; minQuantity: number; startDate: string|null; endDate: string|null; usageLimit: number|null; usedCount: number; scope: 'products'|'subscriptions'; productIds: number[]; subscriptionIds: number[] }` (fixed value in paise; percent value e.g. 10; empty subscriptionIds = all)
- `interface PricedLine extends PriceLine { subtotal: number; discount: number; tax: number; total: number }`
- `priceInvoice(lines: PriceLine[], rules: DiscountRule[], ctx: { date: string; subscriptionId: number }): { lines: PricedLine[]; subtotal: number; discountTotal: number; taxTotal: number; total: number; appliedRuleIds: number[] }`

Rules: eligibility = date inside [start,end] (null = open), uses remain, and threshold met — products scope measures matching lines' subtotal/quantity, subscriptions scope measures the whole invoice. Percent → `round(base*value/100)`; fixed on products scope → capped per matching line; fixed on subscriptions scope → spread over lines in proportion to their remaining amount (largest remainder so it sums exactly), capped at remaining. Rules apply in id order on the remaining amount. Tax = `round((subtotal - discount) * rate / 100)` per line.

- [ ] **Step 1: Write failing tests**
  - `nextStatus('draft','send')==='quotation'`, `nextStatus('closed','resume')===null`, `nextStatus('active','pause')==='paused'`.
  - One line 2 × ₹1,000 at 18% → subtotal 200000, tax 36000, total 236000.
  - 10% subscriptions-scope rule → discountTotal 20000, tax 32400, total 212400, appliedRuleIds `[1]`.
  - Products-scope fixed ₹500 rule on product 7 with lines for product 7 and 8 → only product-7 line discounted by 50000.
  - minQuantity 5 with quantity 2 → not applied; endDate before ctx.date → not applied; usageLimit 3 usedCount 3 → not applied; subscriptionIds `[99]` with subscriptionId 1 → not applied.
  - Fixed ₹10,000 rule on a ₹2,000 invoice → discountTotal 200000, total 0 (never negative).
  - Fixed ₹100 spread over lines 1000 and 2000 paise-proportional sums to exactly 10000.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: subscription lifecycle and invoice pricing with discounts and tax`.

### Task 3: Database schema, connection, numbering

**Files:** Create `server/src/db/{schema,connection}.ts`, `server/src/services/numbering.ts`, `server/test/db.test.ts`.

**Interfaces — Produces:**
- `openDb(file: string = ':memory:'): Database` — WAL, foreign keys on, runs `migrate`.
- `nextNumber(db, kind: 'SUB'|'INV', year: number): string` — atomic counter per kind+year.

Tables as spec §6. Key constraints: `users.email UNIQUE`, `CHECK` on every status/role/period enum, `CREATE UNIQUE INDEX invoices_one_per_period ON invoices(subscription_id, period_start) WHERE status <> 'cancelled'`.

- [ ] **Step 1: Failing tests:** `nextNumber(db,'SUB',2026)` twice → `'SUB/2026/00001'`, `'SUB/2026/00002'`; inserting two non-cancelled invoices with the same subscription and period_start throws; a cancelled + a draft for the same period is allowed.
- [ ] **Step 2–4:** run FAIL, implement, run PASS. **Step 5: Commit** `feat: sqlite schema with double-billing guard and numbering`.

### Task 4: Accounts, sessions, roles, password reset

**Files:** Create `server/src/http.ts`, `server/src/middleware/auth.ts`, `server/src/services/auth.ts`, `server/src/routes/{auth,users,dev}.ts`, `server/src/app.ts`, `server/test/helpers.ts`, `server/test/auth.test.ts`.

**Interfaces — Produces:**
- `createApp(db: Database): Express`
- `requireAuth`, `requireRole(...roles: Role[])` middleware; `req.user: { id, email, name, role, customerId: number|null }`.
- Routes: `POST /api/auth/signup {name,email,password}` (customer + customers row), `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/forgot {email}`, `POST /api/auth/reset {token,password}`, `GET/POST /api/users` (admin; POST creates staff), `GET /api/dev/outbox`.
- Test helpers: `makeApp(): { app, db }` (seeds admin `admin@brightloop.test` / `Admin!pass1`), `loginAs(app, role): Promise<supertest.Agent>`.

- [ ] **Step 1: Failing tests:** signup with weak password → 400 with the password message; duplicate email differing only in case → 409; login sets cookie and `/me` returns role `customer`; forgot for unknown email → 200 and no outbox row; forgot for known email → outbox row whose body has a link with a token; reset with that token works once then 400 on reuse; reset with an expired token → 400; old session is rejected after reset; customer `POST /api/users` → 403; admin creates staff → 201 role `staff`.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat: accounts, sessions, roles and password reset`.

### Task 5: Catalogue — taxes, products and variants, plans, customers, discounts

**Files:** Create `server/src/routes/{catalog,customers,discounts}.ts`, `server/test/catalog.test.ts`.

**Interfaces — Produces:** REST CRUD at `/api/taxes`, `/api/products` (with `variants: [{attribute,value,extraPrice}]` nested on create/update), `/api/plans`, `/api/customers`, `/api/discounts` (with `productIds`, `subscriptionIds`). GET for admin+staff; write admin-only except customers (admin+staff). Product payload: `{name,type:'service'|'goods',salesPrice,costPrice,notes,taxId}`. Plan payload: `{name,price,period,minQuantity,startDate,endDate,autoClose,closable,pausable,renewable,taxId}`.

- [ ] **Step 1: Failing tests:** staff `POST /api/discounts` → 403, admin → 201; staff `POST /api/products` → 403; product with variant `Brand/Odoo +56000` returns that variant; plan with `endDate < startDate` → 400; `GET /api/customers?q=acme` filters by name/email with pagination fields.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat: catalogue, customers and discount rules`.

### Task 6: Quotation templates and subscriptions

**Files:** Create `server/src/services/subscriptions.ts`, `server/src/routes/{templates,subscriptions}.ts`, `server/test/subscriptions.test.ts`.

**Interfaces — Produces:**
- `createSubscription(db, input: { customerId, planId, startDate, expiryDate|null, paymentTermsDays: 0|15|30|45, lines: {productId, variantId|null, quantity, unitPrice?, taxId|null}[], templateId?: number, validUntil?: string }, userId): number` — unit price defaults to sales price + variant extra; rejects quantity < plan minQuantity and plans outside their availability on startDate (409).
- `applySubscriptionAction(db, id, action: SubAction, actor): void` — enforces `nextStatus` and plan flags (`pause` needs pausable, `close` before expiry needs closable, quotation past `valid_until` cannot confirm); `activate` sets `next_invoice_date = start_date`.
- `renewSubscription(db, id): void` — needs renewable; extends expiry by the original term length; reopens if closed by expiry.
- Routes: `/api/templates` CRUD; `POST /api/templates/:id/quote {customerId,startDate}` → new subscription in `quotation`; `/api/subscriptions` list (filters `status, planId, customerId, q`) / detail with lines / create / update while draft / `POST /:id/actions/:action` / `POST /:id/renew`.

- [ ] **Step 1: Failing tests:** quote from template copies plan and lines and sets valid_until = today + validity; Odoo variant line unit price = sales price + 56000; quantity below minimum → 409; full path draft→quotation→confirmed→active→closed works and `next_invoice_date` set on activate; `pause` on a non-pausable plan → 409; confirm an expired quotation → 409; renew extends expiry by term length.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat: quotation templates and subscription lifecycle`.

### Task 7: Billing engine and invoice actions

**Files:** Create `server/src/services/{billing,invoices}.ts`, `server/src/routes/invoices.ts`, `server/test/billing.test.ts`.

**Interfaces — Consumes:** `priceInvoice`, `addPeriods`, `nextNumber`. **Produces:**
- `generateInvoice(db, subscriptionId, periodStart: string, invoiceDate: string): number` — plan fee line (plan price × 1, plan tax) + subscription lines; loads eligible discounts, records `discount_usages`, increments `used_count`.
- `runBilling(db, asOf: string): { created: number; closed: number }` — one transaction; loops each due active subscription through every period start ≤ asOf and < expiry; closes auto-close plans whose expiry ≤ asOf.
- `confirmInvoice`, `cancelInvoice` (returns discount uses), `sendInvoice` (writes outbox, sets `sent_at`), all 409 on wrong status.
- Routes: `POST /api/billing/run {asOf?}`, `/api/invoices` list (filters `status, overdue, customerId, from, to, q`), detail, `POST /:id/confirm|cancel|send`, `POST /api/invoices/bulk {ids, action}`, `POST /api/subscriptions/:id/invoice` (bill current period now).

- [ ] **Step 1: Failing tests:** monthly sub started 3 months ago → one run creates 3 invoices with consecutive periods; second run creates 0; two runs in parallel (`Promise.all`) → still 3; daily plan bills correctly; auto-close plan past expiry → subscription closed, no invoice after expiry; discount usageLimit 2 over 5 subscriptions → exactly 2 invoices discounted, cancel one → used_count 1; tax from plan and product taxes appears in invoice totals; confirm draft → confirmed, confirm again → 409; send writes an outbox row.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat: recurring billing engine and invoice actions`.

### Task 8: Payments, overdue, reports, customer portal

**Files:** Create `server/src/services/{payments,reports}.ts`, `server/src/routes/{payments,reports,portal}.ts`, `server/test/money-flow.test.ts`, `server/test/perf.test.ts`.

**Interfaces — Produces:**
- `recordPayment(db, { invoiceId, method: 'bank_transfer'|'card'|'upi'|'cash'|'cheque', amount, date, note }, userId): number` — invoice must be confirmed; amount ≤ balance; sets `amount_paid`, flips to `paid` at full.
- `dashboard(db, { from, to, planId? }): { activeSubscriptions, mrr, revenue, outstanding, overdueCount, overdueAmount, revenueByMonth: {month, amount}[], statusCounts: Record<SubStatus, number>, topOverdue: Invoice[] }`
- Routes: `/api/payments` list/create; `GET /api/reports/dashboard`; portal `GET /api/portal/subscriptions`, `/api/portal/subscriptions/:id`, `POST /api/portal/subscriptions/:id/actions/:action` (accept = confirm, pause, resume, close, renew), `GET /api/portal/invoices`, `/api/portal/invoices/:id`, `GET/PUT /api/portal/profile`.

- [ ] **Step 1: Failing tests:** partial then final payment → status paid; overpay → 409, no row; pay a draft → 409; confirmed invoice due yesterday is in `overdue=1` list and dashboard overdueCount; dashboard revenue equals sum of payments in range; customer A fetching customer B's invoice and subscription → 404; customer cannot reach `/api/invoices` → 403; perf: seed 3,000 subscriptions, dashboard and `/api/subscriptions?page=1` and `/api/invoices?overdue=1` each < 2000 ms.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat: payments, overdue tracking, dashboard and customer portal`.

### Task 9: Demo seed and server entry

**Files:** Create `server/src/db/seed.ts`, `server/src/index.ts`, `README.md`.

**Interfaces — Produces:** `seed(db, { subscriptions: number, today: string })` — admin `admin@brightloop.test / Admin!pass1`, staff `staff@brightloop.test / Staff!pass1`, customer `customer@brightloop.test / Customer!1`, GST 18% and 5%, products (Brightloop CRM with Brand variants Odoo +560 and Brightloop +0, Analytics add-on, Extra storage, Onboarding service), plans (Starter Monthly, Growth Monthly, Business Yearly, Daily Trial, Weekly Pilot), 2 templates, 2 discounts (10% Volume ≥ 10 seats, ₹500 Launch fixed, limit 50), customers, subscriptions spread over 14 months in all statuses, billing run to today, payments for most invoices, some overdue.
- [ ] **Step 1:** `npm run seed` then `npm start`; `curl /api/auth/me` with admin cookie → admin. **Step 2: Commit** `feat: demo data seed and production entry`.

### Task 10: Client foundation and art direction

**Files:** Create `index.html`, `client/src/{main.tsx,api.ts,auth.tsx,format.ts,styles.css}`, `client/src/components/*`, `client/src/pages/auth/*`, `client/src/pages/mailbox.tsx`.

Run the taste skill's app draw for the direction (`draw.mjs --app --kind <admin|analytics>`), adopt its tokens in `styles.css`, follow `references/app-screens.md` house rules. `api.ts`: `api<T>(path, {method, body}): Promise<T>` throwing `ApiError {status, message, fields}`. `auth.tsx`: `AuthProvider`, `useAuth(): { user, login, logout, refresh }`, `RequireRole` route guard.

- [ ] **Step 1:** Sign in, create account (live password rule checklist), forgot, reset, mailbox render and work against the API. **Step 2:** `npx vite build` passes. **Step 3: Commit** `feat: client foundation, auth screens and art direction`.

### Task 11: Staff and admin screens

**Files:** `client/src/pages/{dashboard,subscriptions,subscription-detail,subscription-new,templates,invoices,invoice-detail,payments,customers,products,plans,taxes,discounts,users}.tsx`.

Lists use `Table` + `Pager` + filter bar bound to URL query; detail pages show status path and only the actions `nextStatus` allows; invoice detail has a print stylesheet; invoices list has run-billing and bulk confirm/send; payment form opens from an invoice with the balance prefilled; admin-only nav items hidden for staff.
- [ ] **Step 1:** Each screen performs its scene against the seeded API. **Step 2:** `vite build` passes. **Step 3: Commit** `feat: staff and admin screens`.

### Task 12: Customer portal screens

**Files:** `client/src/pages/portal/{home,subscription,invoices,invoice,profile}.tsx`.
- [ ] **Step 1:** Customer sees only own data, can accept a quotation, pause/resume/close/renew as the plan allows, view and print invoices. **Step 2: Commit** `feat: customer portal`.

### Task 13: Verification

- [ ] `npm test` all green; `npm run build`; seed + start; taste `lint.mjs client/src`; `inspect.mjs --app` on dashboard, subscriptions, invoice detail, portal; fix FAILs; screenshots reviewed. Commit `chore: verification fixes`.
