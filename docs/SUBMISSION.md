# Brightloop Billing — Odoo Hackathon 2026 Submission

## Project Overview
**Brightloop Billing** is a production-ready, enterprise-grade Subscription Management System built in the style of **Odoo Subscriptions**. It provides end-to-end management of recurring business lifecycles, automated multi-period billing, dynamic discount & taxation engines, real-time analytics, and customer self-service portals.

---

## 🛠 Technology Stack
- **Frontend**: React 19, TypeScript, Vite, Server-Sent Events (SSE) for live synchronization, zero external CSS bloat (clean, ultra-responsive modern styling).
- **Backend**: Node.js 22+, Express 5, TypeScript. Domain-driven architecture separating business math, transactional database services, and thin route handlers.
- **Database**: PostgreSQL (Dual-mode support: Embedded **PGlite** for zero-dependency local setup, and standard PostgreSQL connection pooling for production via Neon/Supabase/RDS).
- **Testing**: Vitest, Supertest, 100% typed with TypeScript (`tsc`).
- **Integrations**: Razorpay Checkout (UPI, Cards, Netbanking) with HMAC-SHA256 signature verification & webhooks, plus a simulated sandbox gateway when keys are omitted.

---

## 🚀 Key Modules & Requirement Mapping

| Requirement / Scene | How Brightloop Billing Handles It |
| :--- | :--- |
| **Product & Plan Catalog** | Multi-attribute variants (e.g., Brand, Cloud Tier) with dynamic surcharges; recurring plans (daily, weekly, monthly, yearly); automatic expiration, renewable, pausable, and early cancellation policies. |
| **Quotation to Subscription** | Pre-bundled quotation templates, fast 2-click quote generation, online acceptance via customer portal, transition path: `Draft` → `Quotation` → `Confirmed` → `Active` ⇄ `Paused` → `Closed`. |
| **Automated Recurring Billing** | Automatic idempotent billing engine. Evaluates due periods anchored to start date; catches up missed billing periods in a single transaction; advisory locks + unique index prevent duplicate billing under concurrency. |
| **Discounts & Taxation** | Fixed or percentage discounts with start/end windows, minimum purchase quantity/subtotal thresholds, usage limits, and specific product/plan scopes. Tax calculated on discounted amounts per line item with integer paise precision. |
| **Payments & Reconciliation** | Multi-method payments (bank transfer, cash, card, UPI, cheque) with partial payment support and overpayment protection. Online checkout via Razorpay Checkout + webhook reconciliation. |
| **Proration & Mid-Period Changes** | Mid-cycle upgrade/downgrade logic with exact prorated debit invoices or credit notes (`CN/YYYY/00001`) with proportional tax adjustments. |
| **Finance Dashboard & Live Stream** | Real-time calculation of MRR, ARR, revenue churn, net new MRR, receivables aging (current, 1-30, 31-60, 60+), collections per month. Server-Sent Events (SSE) pushes updates to browsers within 2 seconds. |
| **Security & Role-Based Access** | Strict role isolation across Admin, Staff, and Customer. Cryptographic password hashing (`bcrypt`), httpOnly SameSite sessions, strict Zod schema validation, SQL parameterization, rate limiting on sensitive endpoints. |

---

## 🏃 Quick Start Guide

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Locally (Zero Config Needed)
```bash
npm run dev
```
- App UI: `http://localhost:5173`
- Backend API: `http://localhost:3000`
- Database: Embedded PGlite initializes automatically on first run and seeds 1,000 demo subscriptions with full financial history.

### 3. Run Automated Tests
```bash
npm test
# Or fast suite:
npm run test:quick
```

### 4. Build for Production
```bash
npm run build
npm start
```

---

## 👥 Authors & Team
- **Jayaraaj V** ([@Jayaraaj2006](https://github.com/Jayaraaj2006))
- **Santhosh Krishnan M** ([@santhoshkrishnan-M](https://github.com/santhoshkrishnan-M))
