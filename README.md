# Brightloop Billing: Enterprise Subscription and Recurring Revenue Management

Brightloop Billing is an enterprise-grade subscription and billing management platform designed for SaaS and recurring-service businesses. Built following the design patterns of modern ERP subscription modules (such as Odoo Subscriptions), the system unifies product catalog configuration, quotation generation, automated recurring billing, discount processing, online and manual payment reconciliation, a customer self-service portal, real-time activity feeds, and financial analytics into a single application.

---

## Technical Stack and Architecture

The platform is designed as a decoupled full-stack architecture that can operate as a single consolidated process in development or scale into distributed serverless environments.

- **Frontend Application**: React 19, TypeScript, Vite. Single-page application (SPA) architecture utilizing custom hooks for state synchronisation and Server-Sent Events (SSE) for live updates without polling.
- **Backend Service**: Node.js (version 22 or higher), Express 5, TypeScript. Layered architecture separating HTTP routing, Zod input validation, database transactions, and pure domain business rules.
- **Database Engine**: PostgreSQL. Supports dual operational modes:
  - **Embedded Local Mode**: Embedded PostgreSQL (PGlite) stored locally in `./data/pglite/`, requiring no external database installation or setup.
  - **Production Mode**: Standard PostgreSQL connection pooling (Neon, Supabase, AWS RDS, or self-hosted PostgreSQL) via the `pg` driver.
- **Testing and Verification**: Vitest test runner, Supertest for end-to-end API verification, TypeScript compiler (`tsc`) for strict static type analysis.
- **Packaging and Deployment**: Multi-stage Docker containerization and serverless compatibility for platforms like Vercel.

---

## Core Functional Modules

### 1. Product Catalog and Variant Pricing
- **Product Types**: Supports both consumable goods and recurring services, including sales price, cost price, accounting notes, and tax assignments.
- **Dynamic Variant Pricing**: Allows multi-attribute variants (e.g., brand, tier, resources) that dynamically add surcharges to the base product price.
- **Tax Mapping**: Configurable percentage-based tax rates (e.g., GST) calculated exclusively on top of discounted line items.

### 2. Subscription Lifecycle Management
- **State Machine**: Governs contract states with strict, audited transitions:
  `Draft` -> `Quotation` -> `Confirmed` -> `Active` <-> `Paused` -> `Closed`
- **Cadence Options**: Recurring intervals for daily, weekly, monthly, and yearly cycles.
- **Contract Rules**: Configurable plan switches including automatic termination on expiration date, early cancellation permissions, pausing privileges, and renewal settings.
- **Mid-Period Adjustments**: Prorated credit calculation for upgrades, downgrades, and quantity shifts during an active billing cycle.
- **Churn Tracking**: Structured churn reason tracking (e.g., pricing, missing features, competitor migration) mapped to analytics.

### 3. Quotations and Sales Workflow
- **Quotation Templates**: Pre-configured bundles defining plan parameters, default product lines, contract durations, and payment terms.
- **Self-Service and Assisted Sales**: Sales staff can prepare quotations with specific expiration dates, or publish templates directly to a public pricing directory.
- **Contract Activation**: Quotations transition into confirmed subscriptions once approved by staff or accepted and paid by the customer via the portal.

### 4. Automated Recurring Billing Engine
- **Period Anchoring**: Billing periods are strictly anchored to the subscription commencement date (e.g., 31 January advances to 28 February, then 31 March).
- **Idempotent Catch-Up Execution**: The billing engine evaluates active subscriptions against target execution dates. Any missed periods are automatically generated sequentially without duplicate billing.
- **Concurrency Protection**: Unique constraint indexing (`invoices(subscription_id, period_start) WHERE status != 'cancelled' AND kind = 'recurring'`) paired with advisory locking prevents double-billing under parallel execution.

### 5. Invoicing, Taxation, and Discounts
- **Sequential Document Numbering**: Standardized numbering sequences for all financial records (`SUB/YYYY/00001`, `INV/YYYY/00001`, `CN/YYYY/00001`).
- **Precision Arithmetic**: All financial values are modeled and calculated as integer paise to prevent floating-point calculation inaccuracies.
- **Discount Engine**: Fixed amount or percentage-based rules evaluated automatically during invoice compilation based on eligibility criteria (date windows, order thresholds, quantity tiers, usage caps, and product or plan scopes).
- **Credit Notes and Adjustments**: Prorated credit notes for subscription cancellations or downgrades, linking directly back to origin invoices with proportional tax reversal.

### 6. Payments and Gateway Processing
- **Payment Reconciliation**: Records full or partial payments with validation preventing overpayment.
- **Payment Methods**: Supports offline methods (bank transfer, cash, cheque, UPI) and integrated payment gateways.
- **Razorpay Integration**: Native checkout workflow supporting cards, UPI, net banking, and wallets with HMAC-SHA256 signature verification and asynchronous webhook processing.
- **Simulated Gateway**: Built-in test sandbox gateway enabled automatically when live API keys are not supplied.

### 7. Customer Self-Service Portal
- **Isolated Tenant Access**: Authenticated customer view restricted exclusively to owned customer data, returning 404 responses for unauthorized resource identifiers to prevent enumeration.
- **Self-Service Capabilities**: Allows customers to review active subscriptions, inspect current and historical invoices, initiate invoice settlements, download printable invoices, accept quotations, and update account details.

### 8. Financial Intelligence and Analytics
- **Executive Metrics**: Live computation of Monthly Recurring Revenue (MRR), Annual Recurring Revenue (ARR), Average Revenue Per Account (ARPA), and Net Revenue Retention.
- **MRR Bridge Decomposition**: Month-by-month classification of revenue changes into New, Expansion, Contraction, Churn, and Reactivation segments.
- **Receivables and Aging**: Detailed aging reports categorizing unpaid receivables (current, 1-15 days, 16-30 days, 31-45 days, 45+ days overdue).

### 9. Automation and Dunning Management
- **Automated Invoicing**: Scheduled execution bills all due accounts.
- **Overdue Reminders**: Automated email reminders dispatched at pre-configured intervals following the invoice due date.
- **Dunning Enforcement**: Automated policy that closes subscriptions when associated invoices remain delinquent beyond the grace period.
- **Quote Expiration**: Daily expiration sweeps for unconfirmed quotations past their validity window.

### 10. Real-Time Event Architecture
- **Event Bus via Server-Sent Events (SSE)**: Long-lived SSE connections push database events to active client sessions within two seconds of occurrence.
- **Audit Log**: Persistent activity ledger recording system actions, administrative edits, customer actions, and billing events.
- **Resilient Reconnection**: Resumes event streams using the `Last-Event-ID` header upon network disruption.

---

## Role-Based Access Control (RBAC) and Security

| Capability | Admin | Staff | Customer (Portal) |
| :--- | :--- | :--- | :--- |
| User and Staff Management | Yes | No | No |
| Catalog, Plans, and Tax Configuration | Yes | Read Only | No |
| Discount Rule Management | Yes | Read Only | No |
| Quotation Templates | Yes | Yes | No |
| Subscription Administration | Yes | Yes | Own records only |
| Invoice Generation and Confirmation | Yes | Yes | Own records only (Read) |
| Manual Payment Recording | Yes | Yes | No |
| Online Payment Execution | No | No | Own invoices only |
| Financial Reports and Analytics | Yes | Yes | No |
| Automation and System Settings | Yes | No | No |

### Security Implementations
- **Authentication**: Stateful sessions stored server-side and referenced through `httpOnly`, `SameSite=Lax` cookies.
- **Password Policies**: Enforced complexity requirements (> 8 characters, uppercase, lowercase, and special characters) hashed via bcrypt.
- **Password Reset**: Cryptographically secure, single-use reset tokens with SHA-256 database storage and 60-minute expiration windows.
- **Rate Limiting**: Distributed database-backed rate limiting on sensitive endpoints (sign-in, account registration, password reset).
- **Data Protection**: Parameterized SQL queries across all database drivers, Zod validation on API payloads, and formula injection sanitization on CSV exports.

---

## Directory Structure

```
brightloop-billing/
├── api/                  # Production serverless runtime entrypoint
├── client/               # React 19 single-page application
│   ├── public/           # Static assets, branding, and chart utilities
│   └── src/
│       ├── pages/        # Route components (Dashboard, Subscriptions, Catalog, Invoices, Portal)
│       ├── api.ts        # Type-safe API client and error handling
│       ├── auth.tsx       # Authentication context and route guards
│       ├── live.ts       # Server-Sent Events event consumer
│       └── main.tsx      # Application bootstrap and routing
├── docs/                 # Engineering specifications and architecture plans
├── scripts/              # Build automation and compilation utilities
├── server/               # Express 5 backend service
│   ├── src/
│   │   ├── db/           # Schema definitions, connection pools, and seed routines
│   │   ├── domain/       # Pure business rules (pricing, periods, money, lifecycle)
│   │   ├── middleware/   # Authentication, session, and error middleware
│   │   ├── routes/       # Express API controllers grouped by resource domain
│   │   ├── services/     # SQL execution, transactional workflows, and integrations
│   │   ├── index.ts      # Server lifecycle and scheduler initialization
│   │   └── realtime.ts   # Server-Sent Events broker
│   └── test/             # Comprehensive Vitest test suites
├── docker-compose.yml    # Container composition file
├── Dockerfile            # Multi-stage production container specification
├── package.json          # Project dependencies, engines, and run scripts
├── tsconfig.json         # TypeScript compiler configuration
├── vercel.json           # Vercel deployment and cron schedule definition
└── vite.config.ts        # Vite build tool configuration
```

---

## Getting Started

### Prerequisites
- Node.js 22.0.0 or higher
- npm 10.0.0 or higher
- Standard modern web browser

### Installation
Clone the repository and install project dependencies:

```bash
git clone https://github.com/santhoshkrishnan-M/odoo-hack-2026.git
cd odoo-hack-2026
npm install
```

### Running the Development Environment
Start both the API backend and the Vite development server concurrently:

```bash
npm run dev
```

- **Frontend Client**: Accessible at `http://localhost:5173`
- **Backend API**: Accessible at `http://localhost:3000`

On initial launch, the system automatically initializes the embedded database and provisions sample organization data.

### Production Build and Execution
To compile optimized client assets and run the consolidated production server:

```bash
npm run build
npm start
```

In production mode, the Express service hosts both the REST API endpoints and static frontend assets on a single configured port (`http://localhost:3000`).

### Quality Assurance and Testing

```bash
# Run the complete test suite including stress and performance benchmarks
npm test

# Run standard unit and integration tests without prolonged performance benchmarks
npm run test:quick

# Execute static type checking across client and server
npm run typecheck
```

---

## Configuration Reference

System configuration is driven by environment variables. Defaults are provided for all parameters in local development. For customized environments, create a `.env` file based on `.env.example`:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `DATABASE_URL` | PostgreSQL connection string. When omitted, embedded PGlite is used. | None (Embedded PGlite) |
| `PORT` | Network port for the backend server process. | `3000` |
| `APP_URL` | Base public URL used when constructing payment links and email redirects. | `http://localhost:5173` |
| `SEED_SUBSCRIPTIONS`| Number of sample subscriptions generated during database initialization. | `1000` |
| `RAZORPAY_KEY_ID` | Razorpay public key. When blank, simulated sandbox gateway is active. | None |
| `RAZORPAY_KEY_SECRET`| Razorpay private secret used for signature verification. | None |
| `RAZORPAY_WEBHOOK_SECRET` | Secret key used to validate incoming payment webhooks. | None |
| `SMTP_URL` | SMTP transport URL (e.g. `smtps://user:secret@smtp.example.com:465`). | None (Logged to internal outbox) |
| `MAIL_FROM` | Default sender email address for system-generated correspondence. | `Brightloop Billing <billing@example.com>` |
| `SCHEDULER` | Set to `off` to disable the internal scheduler when running external cron. | `on` |
| `CRON_SECRET` | Bearer authentication token for securing external automation triggers. | None |

---

## Deployment Architecture

### Docker Deployment
The project includes a multi-stage `Dockerfile` and `docker-compose.yml` for self-contained deployment with a managed PostgreSQL container:

```bash
docker compose up --build -d
```

### Serverless Cloud Deployment (Vercel + Managed Postgres)
1. Provision a PostgreSQL instance (e.g., Neon, AWS RDS, Supabase).
2. Configure environment variables in your deployment dashboard (`DATABASE_URL`, `CRON_SECRET`, `APP_URL`).
3. Deploy the project using the Vercel CLI or Git integration:
   ```bash
   npm run build
   npx vercel deploy --prod
   ```
4. Configure scheduled jobs in `vercel.json` targeting `/api/cron/daily` with authorization headers.
