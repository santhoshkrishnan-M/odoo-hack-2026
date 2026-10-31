# Subscription Management & Billing System

A comprehensive, production-grade subscription management and recurring billing platform built for modern B2B/B2C SaaS and service enterprises. The application unifies product catalogues, customized recurring plans, quotation-to-subscription workflows, automated billing runs with zero-collision idempotency, flexible discount rules, multi-method payments, accounts receivable tracking, and customer self-service.

---

## Key Highlights & Business Capabilities

### 1. Multi-Tier Role-Based Access Control (RBAC)
- **Role Isolation**: Strict separation across **Administrator**, **Staff Member**, and **Customer** roles enforced at the server route layer.
- **Secure Authentication**: Sessions managed via secure `httpOnly`, `SameSite=Lax` cookies with `bcrypt`-hashed passwords.
- **Self-Service Customer Portal**: Dedicated client portal (`/portal`) where customers can only access their own subscriptions, invoices, and payment receipts.
- **Password Resilience**: Enforces strict password policies (>8 characters with mixed uppercase, lowercase, and special characters) and secure, single-use SHA-256 password reset tokens with automatic invalidation of old sessions.

### 2. Product Catalogue & Dynamic Variants
- **Products**: Support for services and physical goods with configurable cost price, base sales price, description notes, and applicable tax classifications.
- **Variants & Surcharges**: Dynamic product variants (e.g., brand editions, regional options) that calculate automatic surcharges applied directly to the line unit price.

### 3. Flexible Recurring Subscription Plans
- **Billing Intervals**: Configurable daily, weekly, monthly, and yearly recurring periods.
- **Policy Controls**:
  - Minimum commitment quantity rules.
  - Plan availability date windows (start and end validity).
  - Configurable switches for auto-closing at expiration, early termination, mid-cycle pausing, and renewals.

### 4. Quotation Pipeline & Subscription Lifecycle
- **Quotation Templates**: Reusable templates with default plans, line items, and validity durations.
- **Standardized Numbering**: Automated document sequencing (e.g., `SUB/2026/00001`).
- **Enforced State Machine**: Formal transition validation:
  $$\text{Draft} \longrightarrow \text{Quotation} \longrightarrow \text{Confirmed} \longrightarrow \text{Active} \longleftrightarrow \text{Paused} \longrightarrow \text{Closed}$$
- Expiration safeguards prevent confirmation of expired quotations.

### 5. Automated Recurring Billing Engine
- **Atomic Catch-Up Runs**: One-click and automated billing cycles that identify all active subscriptions due for invoicing up to a given cut-off date.
- **Guaranteed Idempotency**: Protected against double-billing via database-level unique indexing on `(subscription_id, period_start)`. Even concurrent billing executions cannot double-charge.
- **Calendar Anchoring**: Periods correctly anchored to original subscription start dates (e.g., a subscription starting January 31 correctly bills February 28, then March 31).

### 6. Dynamic Discount & Promotion Engine
- **Flexible Rules**: Fixed cash deductions or percentage discounts.
- **Conditional Qualification**: Minimum subtotal thresholds, minimum purchase quantities, date ranges, and maximum usage caps.
- **Scope Targeting**: Universal subscription-wide discounts or specific product-line targeting.
- **Automatic Lifecycle Reversals**: Cancelling an unpaid invoice automatically restores discount coupon usage quotas.

### 7. Invoice Lifecycle & Tax Calculations
- **Document Sequence**: Standardized invoice numbering (e.g., `INV/2026/00001`).
- **Audit States**: `Draft` $\rightarrow$ `Confirmed` $\rightarrow$ `Paid` (or `Cancelled`).
- **Tax & Discount Math**: Accurate line-level calculation (discount applied before tax calculation) rounded to exact whole paise to prevent precision drift.
- **Print & Delivery**: Clean, print-ready invoices and simulated email delivery for dispatch logs.

### 8. Payment Recording & Accounts Receivable (AR)
- **Multi-Method Tracking**: Support for UPI, Bank Transfer, Credit/Debit Card, Cheque, and Cash payments against confirmed invoices.
- **Payment Allocation**: Granular partial payment support with strict validation preventing overpayments.
- **Aging & Overdue Tracking**: Real-time identification of overdue invoices based on configured payment terms (Immediate, Net-15, Net-30, Net-45).

### 9. High-Performance Executive Dashboard
- **Instant Response Times**: Sub-100 ms query performance even with thousands of active subscriptions and historical invoices.
- **Key Metrics**: Monthly Recurring Revenue (MRR), total collected revenue, outstanding accounts receivable, receivables aging buckets (0–30, 31–60, 61–90, 90+ days), longest overdue accounts, and revenue breakdown by plan.

---

## System Architecture

```
client/ (React 19 + TypeScript + Vite)
   │
   └── HTTP JSON (/api) with httpOnly session cookies
         │
         ▼
server/ (Express 5 + TypeScript)
   ├── routes/     Thin validation and authorization layer (Zod schemas)
   ├── services/   Transactional SQL business operations
   ├── domain/     Pure, zero-dependency domain models & business rules
   └── db/         SQLite engine (better-sqlite3) with WAL mode & foreign keys
```

### Technical Design Principles
- **Domain-Driven Design (DDD)**: Business logic, discount calculations, tax formulas, password validation, and billing periods reside in pure domain modules tested independently of database or HTTP dependencies.
- **Zero Floating-Point Drift**: All currency values are stored and calculated as integer paise (1 INR = 100 paise), avoiding JavaScript floating-point errors.
- **Fast Embedded Persistence**: Utilizes SQLite via `better-sqlite3` configured with Write-Ahead Logging (WAL) and foreign key constraints for fast local execution without external database overhead.

---

## Getting Started

### Prerequisites
- **Node.js**: Version 22.0.0 or higher
- **npm**: Version 10 or higher

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/santhoshkrishnan-M/odoo-hack-2026.git
   cd odoo-hack-2026
   ```

2. **Install project dependencies**:
   ```bash
   npm install
   ```

3. **Initialize and seed the database**:
   ```bash
   npm run seed
   ```
   *This initializes `data/brightloop.db` and populates realistic demo records including products, plans, tax categories, subscriptions, and historical invoices.*

4. **Launch the development environment**:
   ```bash
   npm run dev
   ```
   - **Web Application**: `http://localhost:5173`
   - **Backend API**: `http://localhost:3000/api`
   - **Development Mailbox**: `http://localhost:5173/mailbox` *(captures password reset and invoice emails in development)*

---

## Production Deployment

To compile and serve the optimized single-port production build:

```bash
# Build the client bundle
npm run build

# Start the unified production server
npm run start
```
The server will be reachable at `http://localhost:3000`.

### Environment Configuration
The application supports the following environment variables:

| Variable | Description | Default |
| --- | --- | --- |
| `PORT` | Web server listening port | `3000` |
| `DB_FILE` | Relative or absolute path to the SQLite database file | `data/brightloop.db` |
| `SEED_SUBSCRIPTIONS` | Number of synthetic subscriptions generated on initial seed | `2400` |
| `DEV_MAILBOX` | Enable virtual mailbox interface in production mode (`1` = enabled) | `0` (disabled) |

---

## User Roles & Evaluation Access

The application includes three standard roles:

1. **Administrator**: Full system management, catalog configuration, discount rules, team user management, billing execution, and finance analytics.
2. **Staff**: Operational workflows including quotation creation, customer management, invoice management, payment logging, and dashboard viewing.
3. **Customer**: Self-service portal access restricted strictly to their individual subscriptions, invoices, and payments.

> **Evaluation Quick Fill**: When running in development mode, the sign-in page features quick-select buttons for each role to facilitate rapid testing and review. New customer accounts can also be created on-demand via the `/signup` screen.

---

## Quality Assurance & Testing

The platform includes a test suite covering pure domain math, API routes, authorization boundaries, billing idempotency, and query response times.

```bash
# Execute test suite
npm test

# Run TypeScript type verification
npm run typecheck
```

---

## Security Practices

- **Sanitized Inputs**: All incoming API requests are validated against strict Zod schemas before touching service layers.
- **Session Protection**: Authentication tokens are stored inside tamper-proof, HTTP-only session cookies.
- **Role Isolation**: Strict server-side checks verify customer ownership of all accessed resources, preventing horizontal privilege escalation.
- **Secret Hygiene**: Sensitive credentials, production secrets, and private access keys are excluded from version control.
