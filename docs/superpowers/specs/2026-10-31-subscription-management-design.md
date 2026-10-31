# Subscription Management System — Design

Date: 2026-10-31
Source: "Subscription Management System" problem statement (Brightloop Software).

## 1. Goal

One web app that runs Brightloop's whole subscription business: products and plans,
quotations that become subscriptions, automatic recurring invoices with taxes and
discounts, payments against invoices, a customer self-service portal, and a finance
dashboard. It replaces the spreadsheet, the hand-typed invoices and the quarter-end reports.

Success means every scene in the brief can be performed in the app, end to end, on a
seeded demo company with thousands of subscriptions, with every page answering in
under two seconds.

## 2. Decisions taken without the user (stated, correctable)

| Topic | Decision | Why |
| --- | --- | --- |
| Stack | React 19 + TypeScript + Vite (client), Node 22 + Express + TypeScript (API), SQLite via better-sqlite3 | One command to run, no database server, fast enough for thousands of rows with indexes. The data layer is plain SQL so it can move to PostgreSQL. |
| Payments | Recorded manually by staff (method, amount, date, note). No gateway. | The brief describes recording, not collecting, payments. |
| Email | Password-reset and invoice emails are written to an `outbox` table and the server log; a dev mailbox page shows them. | No mail service is available; behaviour is the same, delivery is swappable. |
| Currency | Indian rupee, stored as integer paise. | No currency in the brief; integers avoid rounding errors. |
| Tax | Percentage taxes, exclusive (added on top of the line). | Most common for B2B software. |
| Auth | Server-side sessions in an httpOnly, SameSite=Lax cookie; bcrypt password hashes. | Simple and safe; no token handling in the browser. |

## 3. Roles

| Capability | Admin | Staff | Customer (portal) |
| --- | --- | --- | --- |
| Add staff / manage users | ✔ | | |
| Products, variants, plans, taxes | ✔ | read | |
| Discount rules | ✔ | read | |
| Quotation templates | ✔ | ✔ | |
| Customers | ✔ | ✔ | own profile |
| Subscriptions | ✔ | ✔ | own: view, accept quotation, pause/resume, close, renew (as the plan allows) |
| Invoices: generate, confirm, cancel, send, print | ✔ | ✔ | own: view, print |
| Payments | ✔ | ✔ | own: view |
| Dashboard and reports | ✔ | ✔ | |

Public sign-up always creates a **customer** account and its customer record. Only an admin
creates staff. The first admin comes from the seed (or `ADMIN_EMAIL`/`ADMIN_PASSWORD`).

## 4. Rules from the brief, made exact

- **Email**: unique, case-insensitive, trimmed.
- **Password**: more than eight characters (at least 9), at least one uppercase, one
  lowercase and one special (non-letter, non-digit) character.
- **Reset**: a random token (only its SHA-256 hash is stored), valid 60 minutes, single use,
  sent to the registered email. The request answers the same way whether or not the email
  exists. Using it ends all existing sessions for that user.
- **Variant price**: unit price = product sales price + variant extra price (Odoo brand: +560).
- **Plan**: price per billing period, period (daily, weekly, monthly, yearly), minimum
  quantity, available-from/until dates, and four switches: auto-close at expiry, closable
  early, pausable, renewable. New subscriptions can only use a plan inside its availability window.
- **Subscription lifecycle**: Draft → Quotation → Confirmed → Active → Closed, plus Paused
  (from Active, back to Active) when the plan allows it. Transitions outside this graph are
  rejected. Number format `SUB/2026/00001`.
- **Subscription lines**: product (and variant), quantity (≥ plan minimum), unit price, tax.
  Amount = quantity × unit price. The plan fee appears as its own line on every invoice.
- **Quotation template**: name, plan, validity in days, product lines. Creating a quotation
  from a template copies its plan and lines and sets "valid until" = today + validity days.
  A quotation past its validity cannot be confirmed.
- **Billing** (`runBilling(asOf)`): for every Active subscription whose next invoice date
  ≤ asOf, create one Draft invoice per due period (catching up any missed period), advance
  the next invoice date, all inside one transaction. A unique index on
  (subscription, period start) for non-cancelled invoices makes double billing impossible,
  even if billing runs twice at once. Periods start at the subscription start date.
  When a subscription reaches its expiry date and its plan auto-closes, it moves to Closed
  and is not billed beyond expiry.
- **Invoice lifecycle**: Draft → Confirmed → Paid; Draft or Confirmed (unpaid) → Cancelled.
  Send records the time and writes the email; print opens a print-ready page.
  Number format `INV/2026/00001`, given at creation.
- **Invoice totals**: per line, discount first, then tax on the discounted amount.
  Rounded to whole paise per line.
- **Discounts** (admin only): fixed amount or percentage; minimum purchase (subtotal) and/or
  minimum quantity; start and end dates; usage limit (blank = unlimited); scope =
  specific products (applies to matching lines) or subscriptions (applies to the whole invoice,
  either for all subscriptions or for chosen ones). Applied automatically while generating an
  invoice when the invoice date is inside the window, thresholds are met and uses remain.
  Each invoice that receives a discount counts as one use; cancelling that invoice gives the
  use back. A fixed discount never makes a line or invoice negative.
- **Payments**: method (bank transfer, card, UPI, cash, cheque), amount, date, note,
  against a Confirmed invoice. Partial payments allowed; overpayment rejected. When paid
  amount reaches the total the invoice becomes Paid.
- **Overdue**: Confirmed, not fully paid, due date before today. Due date = invoice date +
  subscription payment terms (immediate, 15, 30 or 45 days).

## 5. Architecture

```
client/ (React, Vite)  ──HTTP JSON /api──▶  server/ (Express)
                                              routes/  → thin: parse (zod), authorize, call service
                                              services/ → SQL + transactions
                                              domain/  → pure rules, no I/O (fully unit tested)
                                              db/      → schema, connection, seed
```

- **domain/**: `password`, `money`, `periods`, `pricing` (line + discount + tax math),
  `lifecycle` (allowed transitions), `discounts` (eligibility). Pure functions.
- **services/**: `billing` (runBilling, generate invoice), `invoices`, `payments`,
  `subscriptions`, `reports`, `auth`.
- Production: Express serves the built client; one process, one port.

## 6. Data model (SQLite)

users, sessions, password_resets, outbox, customers, taxes, products, product_variants,
plans, quotation_templates, template_lines, subscriptions, subscription_lines,
discounts, discount_products, discount_subscriptions, discount_usages, invoices,
invoice_lines, payments, counters (for numbering).

Indexes on every foreign key, on subscriptions(status, next_invoice_date),
invoices(status, due_date), payments(date), and a partial unique index
invoices(subscription_id, period_start) WHERE status != 'cancelled'.

## 7. Screens

Staff and admin: Dashboard · Subscriptions (list, detail, new from template) · Quotation
templates · Invoices (list with bulk confirm/send, detail, printable view, run billing) ·
Payments · Customers · Products & variants · Plans · Taxes · Discounts · Users.
Customer portal: My subscriptions · My invoices · Profile.
Public: Sign in · Create account · Forgot password · Reset password · Dev mailbox.

Every list is paginated and filtered on the server (50 rows per page).
Visual direction comes from the taste skill's app-screen rules (quiet surfaces, no gradients
or glow, real figures, one accent).

## 8. Error handling

- zod validates every request body; failures return 400 with field messages shown next to
  the field.
- Rule violations (bad transition, overpayment, expired quotation) return 409 with a plain sentence.
- 401 when not signed in, 403 when the role lacks the right, 404 for other customers' records
  in the portal (no existence leak).

## 9. Testing

- Vitest unit tests for every domain function, written first (TDD).
- API tests with supertest against an in-memory database: auth and password rules, role
  checks, the subscription lifecycle, billing idempotency and catch-up, discount
  application and usage limits, payments and overdue, portal isolation.
- A performance check: seed 3,000 subscriptions and their invoices, assert dashboard and
  list endpoints answer in under 2 seconds.
- Taste skill `lint.mjs` on the client source, and screenshots of the main screens.

## 10. Out of scope

Real payment gateway, real email delivery, multi-currency, proration of mid-period changes,
credit notes.
