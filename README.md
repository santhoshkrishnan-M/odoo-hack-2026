# Brightloop Billing — Subscription Management System

One web app that runs a subscription business end to end: products and plans, quotations that become
subscriptions, automatic recurring invoices with taxes and discounts, payments, a customer self-service
portal and a finance dashboard. Built for the "Subscription Management System" problem statement
(Brightloop Software).

## Run it

Requires Node 22 or newer.

```bash
npm install
npm run seed      # creates data/brightloop.db with a demo company (2,400 subscriptions, ~14,600 invoices)
npm run dev       # API on :3000, web app on http://localhost:5173
```

Production build on one port:

```bash
npm run build
npm start         # http://localhost:3000 (creates data/ and seeds on first start)
```

Demo accounts (also one click away on the sign-in page):

| Role | Email | Password |
| --- | --- | --- |
| Admin | admin@brightloop.test | Admin!pass1 |
| Staff | staff@brightloop.test | Staff!pass1 |
| Customer | customer@brightloop.test | Customer!1 |

Password-reset and invoice emails are written to a demo mailbox at `/mailbox` instead of being sent. It is on with
`npm run dev`; with `npm start` turn it on with the environment variable `DEV_MAILBOX=1` (never on a public server: it
shows reset links).

## How each scene in the brief is handled

| Scene | Where |
| --- | --- |
| **A new customer signs up** — unique email, password > 8 chars with upper, lower and special character, reset link by email | `/signup` (live rule checklist), `/forgot-password` → `/mailbox` → `/reset-password`. Tokens are single-use, 60 minutes, stored hashed; a reset ends old sessions. |
| **Roles** — admin, staff with limited access, customers in a portal; only admin adds staff | Server-side role checks on every route. Admin: everything + Team. Staff: day-to-day work, read-only catalogue. Customers: `/portal`, only their own records (others return 404). |
| **Launching a new plan** — product with type, sales/cost price, notes, variants (Odoo brand +₹560); plan with price, daily/weekly/monthly/yearly, minimum quantity, availability dates, auto-close / close / pause / renew switches | Products, Plans (admin). Variant extra price is added to the line's unit price. |
| **Turning a quote into a subscription** — templates with plan, lines, validity; numbered subscriptions moving Draft → Quotation → Confirmed → Active → Closed | Quotation templates → "Quote a customer". `SUB/2026/00001` numbering, status path on every subscription, expired quotations cannot be confirmed. |
| **Billing day** — invoices generated from subscriptions with lines, taxes, totals; Draft → Confirmed → Paid; confirm, cancel, send, print; nothing billed twice or skipped | "Run billing" bills every due period (catching up missed ones) in one transaction. A unique index on (subscription, period) makes double billing impossible. Bulk confirm/send; print-ready invoice. |
| **A customer asks for a better price** — admin-only discount rules: fixed or %, minimum purchase or quantity, dates, usage limit, products or subscriptions; applied automatically | Discounts (admin). Applied while each invoice is generated; cancelling an invoice gives the use back. |
| **The money comes in** — payments with method, amount, date, note against an invoice; paid vs outstanding; overdue | Record payment from any invoice (partial payments allowed, overpayment refused). Invoice tabs: awaiting payment, overdue, paid. |
| **The finance lead** — active subscriptions, revenue, owed, overdue, filters, < 2 s with thousands of subscriptions | Overview: MRR, collected, still owed, overdue, collections per month, receivables ageing, longest overdue, revenue by plan; filter by period and plan. Measured at 3,000 subscriptions: dashboard ~80 ms, lists ~10 ms. |

## Architecture

```
client/  React 19 + TypeScript + Vite       → /api (JSON, httpOnly session cookie)
server/  Express 5 + TypeScript
  domain/    pure rules: passwords, money, billing periods, lifecycles, invoice pricing (discounts → tax)
  services/  SQL and transactions: auth, subscriptions, billing, invoices, payments, reports
  routes/    zod validation + role checks, thin
  db/        SQLite schema (better-sqlite3), demo seed
```

Money is stored as integer paise. Dates are ISO strings. Periods are anchored to the start date
(a subscription that starts on 31 January bills on 28 February, then 31 March).

## Tests

```bash
npm test           # 105 tests: domain rules, every API flow, role isolation, billing idempotency, performance
npm run typecheck
```

## Assumptions

- Payments are recorded by staff; there is no payment gateway.
- Email delivery is simulated (outbox table + `/mailbox`).
- Prices are in Indian rupees; taxes are percentages added on top of each line.
- Product prices are per billing period of the plan they are sold on.
- Out of scope: proration of mid-period changes, credit notes, multi-currency.

## Process

Built with the `superpowers` skills (brainstorming → spec → plan → test-driven development →
verification) and the `design-taste-frontend` skill for the interface (achromatic-ledger app style,
checked with its linter and real-browser inspector). The spec and plan are in `docs/superpowers/`.
