# Brightloop Billing — Subscription Management

A complete, working subscription business system in the style of Odoo Subscriptions: products and variants, recurring plans,
quotation templates, quotations that become subscriptions, automatic recurring invoices with GST and discounts, online
payments, upgrades and downgrades with proration, credit notes and refunds, dunning, a self-service customer portal,
a public pricing page, live updates across every open screen, and a finance dashboard with MRR, churn and receivables.

Stack: **React 19 + TypeScript + Vite** · **Node 22 + Express 5** · **PostgreSQL** (embedded PGlite locally, Neon or any Postgres in production).

---

## Run it (any editor, any OS)

Needs **Node.js 22 or newer** (`node -v`). Nothing else: no database server, no native build tools, no accounts.

```bash
npm install
npm run dev
```

Open **http://localhost:5173**. The first start creates a demo company (1,000 subscriptions, a year of invoices and payments)
in `data/pglite/`; this takes about a minute, and the sign-in page says so until it is ready.

| Role | Email |
| --- | --- |
| Admin | admin@brightloop.test |
| Staff | staff@brightloop.test |
| Customer (portal) | customer@brightloop.test |

Try it live: open the app as **admin** in one browser window and as the **customer** in a private window. Order a plan in the
customer's *Browse plans* and pay it (the test gateway); the admin's overview shows the payment within two seconds, without reloading.

Other commands:

```bash
npm run build && npm start   # production build on one port: http://localhost:3000
npm run seed                 # rebuild the demo data (SEED_SUBSCRIPTIONS=2400 npm run seed for more)
npm test                     # 128 tests incl. a 3,000-subscription performance check (~3 min)
npm run test:quick           # the same without the performance check (~30 s)
npm run typecheck
```

To start again from scratch, stop the app and delete the `data/` folder.

Configuration is optional and lives in `.env` (copy `.env.example`): a Postgres URL, Razorpay keys, SMTP, the public URL.

## What it does

**Catalogue (admin).** Products (service/goods, sales and cost price, notes, tax) with variants that add to the price
(e.g. Brand: Odoo +₹560). Plans with price per day/week/month/year, minimum quantity, availability window and the rules
auto-close at end date, closable early, pausable, renewable. Taxes. Discount rules: fixed or %, minimum amount or quantity,
date window, usage limit, for chosen products or subscriptions — applied automatically while invoicing.

**Selling.** Quotation templates (plan, lines, validity, contract length). Quote a customer in two clicks; the customer
accepts in their portal. Lifecycle Draft → Quotation → Confirmed → Active ⇄ Paused → Closed, numbered `SUB/2026/00001`.
Templates marked *Sell online* appear on the public **/pricing** page and in the portal: customers order and pay themselves,
and the subscription starts the moment the first invoice is paid.

**Running subscriptions.** Upgrade or downgrade quantities and products mid-period: an extra invoice for the prorated
increase, or a prorated credit note for a decrease (applied to what is owed, refunded if already paid). Pause/resume,
renew, and close with a reason (*Too expensive*, *Switched to a competitor*…) that feeds churn reporting. Every record has a
full history (who did what, when).

**Billing day, automatically.** Every day (Vercel Cron in production, an hourly timer on a normal server, or *Run now*):
bill every due period — catching up missed ones, never twice (advisory lock + unique index) — confirm and email the invoices,
send payment reminders 1/7/14 days after the due date, optionally close subscriptions unpaid for N days (dunning), send
renewal reminders before end dates, expire stale quotations, and clean up. All configurable in *Settings & automation*.

**Money.** Invoices with lines, GST and discounts, Draft → Confirmed → Paid, print/PDF with your company and GSTIN details.
Manual payments (bank transfer, UPI, card, cash, cheque) with partials and no overpayment. **Online payment** from the portal
through **Razorpay Checkout** (UPI, cards, net banking, wallets) with signature verification and a webhook — or the built-in
test gateway when no keys are set. Credit notes (`CN/2026/00001`) and refunds. CSV export of invoices, subscriptions and payments.

**Live.** One Server-Sent Events stream per signed-in browser. Every change writes to the activity log; each server instance
polls it every 2 s and pushes new entries to its browsers, so lists, totals and dashboards refresh themselves and important
events pop up as notifications. Works on one server or many serverless instances; browsers resume from the last event after
a reconnect. Customers only ever receive their own events.

**Finance dashboard.** MRR, ARR, average per subscription, revenue churn, net new MRR, an MRR bridge per month (new,
expansion, contraction, churn), collections per month, receivables ageing, longest overdue, revenue by plan, live activity —
filterable by period and plan, under a second with thousands of subscriptions.

**Roles and security.** Admin (everything, team, settings, email log), staff (day-to-day; catalogue read-only), customers
(portal, own records only — others return 404). Passwords > 8 characters with upper, lower and special; bcrypt; httpOnly
SameSite sessions; reset links single-use, 60 minutes, stored hashed. Rate limits on sign-in, sign-up and resets (in the
database, so they hold across instances). Cross-site request guard, security headers, zod validation on every input,
parameterised SQL everywhere, spreadsheet-formula-safe CSV.

## Architecture

```
client/   React SPA. useApi() loads data and refetches when the live stream reports a change.
server/
  domain/    pure rules: passwords, money, billing periods, lifecycle, pricing (discount → tax per line)
  services/  SQL + transactions: auth, subscriptions (incl. proration), billing, invoices (credit notes),
             payments (Razorpay / test gateway / webhook), jobs (daily automation), reports, activity, mail, settings
  routes/    thin Express routers: validate (zod), authorise, call a service
  realtime.ts  the SSE stream
  db/        schema (idempotent, versioned), connection (pg for Postgres, PGlite embedded), seed
  index.ts   long-running server (API + web app + hourly automation)
  vercel.ts  serverless entry (bundled to api/index.js by `npm run build`)
```

Money is integer paise; dates are `DATE`; periods are anchored to the start date (31 Jan → 28 Feb → 31 Mar).

## Deploying

**Docker (any VPS):** `docker compose up --build` runs the app with its own PostgreSQL on http://localhost:3000.

**Vercel + Neon:**
1. Create a Postgres database (e.g. Neon) and copy its *pooled* connection string.
2. In a new Vercel project set `DATABASE_URL`, `CRON_SECRET` (any long random string) and `SETUP_SECRET`.
   Optionally `RAZORPAY_*`, `SMTP_URL`, `MAIL_FROM`.
3. `npm run build`, then `npx vercel deploy --prod` from this folder (or connect a Git repository). `api/index.js` is the bundled API; rebuild it after server changes.
4. Load the demo company once: `curl -X POST "https://<your-app>/api/setup?key=<SETUP_SECRET>"` (only works on an empty database).
   Or skip it and sign up, then make the first admin by setting `role = 'admin'` on that user in the database.

The daily automation runs from Vercel Cron (`vercel.json`, 06:00 IST). Razorpay webhook URL: `https://<your-app>/api/webhooks/razorpay`
(events `payment.captured`, `payment.failed`).

## Assumptions

- Prices are in Indian rupees; GST is a percentage added on top of each line. Product prices are per billing period of the plan.
- Proration is by days left in the current billed period. Credit notes reverse tax in proportion to the original invoice.
- Without SMTP, emails are recorded in the email log rather than delivered; without Razorpay keys, online payments use a clearly labelled test gateway.

Built with the `superpowers` workflow (spec → plan → test-driven development → verification); the original spec and plan are in `docs/`.
