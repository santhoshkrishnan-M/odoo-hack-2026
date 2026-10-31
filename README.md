# Brightloop Billing: Frontend Application

Brightloop Billing is a modern, responsive web application built for subscription management and recurring revenue operations. Designed following the intuitive workflows of enterprise ERP systems, the user interface provides role-tailored dashboards and operational views for administrators, billing staff, and self-service customers.

---

## Technical Stack

- **Framework**: React 19 (Functional components, Hooks)
- **Language**: TypeScript (Strict typing enabled)
- **Build System**: Vite 8
- **Routing**: React Router 7
- **Styling**: Responsive custom design system with accessible contrast and clean typography
- **Data Synchronization**: REST integration paired with real-time Server-Sent Events (SSE) updates

---

## Application Structure and Modules

### 1. Executive Dashboard
- **Key Metrics**: Real-time display of Monthly Recurring Revenue (MRR), Annual Recurring Revenue (ARR), total collections, and active accounts.
- **MRR Bridge Visualization**: Visual breakdown of revenue trends categorized by new acquisitions, expansions, contractions, churn, and reactivations.
- **Aging Receivables**: Visual distribution of unpaid invoices across aging intervals (current, 1-15 days, 16-30 days, 31-45 days, and 45+ days).
- **Activity Stream**: Live-updating activity ledger detailing recent administrative and transactional events.

### 2. Subscription Management
- **Subscription Listing**: Paginated, filterable directory with status flags (Draft, Quotation, Confirmed, Active, Paused, Closed).
- **Contract Details**: Detailed breakdown showing linked customers, products, variants, recurring frequency, payment terms, and next invoice date.
- **Lifecycle Actions**: Staff and administrative triggers to confirm quotations, pause active contracts, resume paused subscriptions, and initiate closure with categorized churn tracking.

### 3. Product Catalog and Pricing
- **Product Management**: Interface to configure physical goods and digital services, standard pricing, and tax classifications.
- **Variant Modeling**: Multi-attribute variant selectors that apply dynamic surcharges to base unit rates.
- **Recurring Plans**: Definition of billing cadences (daily, weekly, monthly, yearly), minimum order thresholds, and contract renewal constraints.

### 4. Quotations and Sales Pipeline
- **Template Configuration**: Creation and management of reusable quotation templates specifying predefined plans, line items, and validity periods.
- **Direct Quoting**: Modal workflow to generate customized customer proposals with automated expiration dates.
- **Public Directory**: Customer-facing pricing catalog enabling online plan selection and self-checkout.

### 5. Invoicing and Payments
- **Invoice Processing**: Comprehensive register of invoices with draft review, confirmation triggers, and cancellation capabilities.
- **Print View**: Clean, document-style printable layout optimized for PDF generation and paper distribution.
- **Payment Collection**: Modal forms for recording multi-method payments (bank transfer, UPI, card, cash, cheque) with partial payment support and overpayment protection.
- **Online Checkout Integration**: Customer-facing payment flow supporting verified digital transactions.

### 6. Customer Self-Service Portal
- **Contract Overview**: Customer view detailing active and historical subscriptions with renewal dates.
- **Billing History**: Access to download past invoices and inspect real-time settlement status.
- **Action Triggers**: Self-service options to accept quotations, execute payments, and manage contract state.

---

## Role-Based Interface Capabilities

| Interface View | Administrator | Staff | Customer Portal |
| :--- | :--- | :--- | :--- |
| Executive Dashboard & Analytics | Full Access | Full Access | No Access |
| Catalog, Pricing, & Tax Rules | Create, Edit, View | Read Only | No Access |
| Quotations & Subscriptions | Full Management | Full Management | View Owned Only |
| Invoices & Payment Recording | Full Management | Full Management | View & Pay Owned Only |
| Customer Directory & Profiles | Full Management | Full Management | Own Profile Only |
| System Settings & Automations | Full Access | No Access | No Access |

---

## Directory Layout

```
client/
├── public/               # Static assets, branding, and chart utilities
│   ├── charts.js         # Canvas charting library
│   └── mark.svg          # Application logomark
└── src/
    ├── pages/            # Page-level route views
    │   ├── admin.tsx     # System settings and automation management
    │   ├── auth.tsx      # Sign-in, registration, and password recovery
    │   ├── catalog.tsx   # Product, plan, variant, and tax configuration
    │   ├── customers.tsx # Customer directory and profile detail
    │   ├── dashboard.tsx # Financial intelligence and MRR reporting
    │   ├── invoices.tsx  # Invoice management, printable views, and payments
    │   ├── pay.tsx       # Checkout settlement interface
    │   ├── plans.tsx     # Public catalog and plan selection
    │   ├── portal.tsx    # Customer self-service dashboard
    │   └── subscriptions.tsx # Subscription lifecycle management
    ├── api.ts            # Type-safe API client and error handling
    ├── app.css           # Core stylesheet
    ├── auth.tsx          # Authentication context and route guards
    ├── charts.tsx        # React wrappers for metric visualizations
    ├── components.tsx    # Shared UI components (tables, badges, modals, pagination)
    ├── format.ts         # Formatting utilities for currency and dates
    ├── icons.tsx         # Vector icon definitions
    ├── layout.tsx        # Application shell, navigation bar, and user menus
    ├── live.ts           # Server-Sent Events client for real-time updates
    ├── main.tsx          # Application bootstrap and routing definitions
    ├── styles.css        # Layout structure and utility styling
    └── toasts.tsx        # Toast notification system
```

---

## Getting Started

### Prerequisites
- Node.js version 20.0.0 or higher
- npm version 10.0.0 or higher

### Installation
Clone the repository and install dependencies:

```bash
git clone https://github.com/santhoshkrishnan-M/odoo-hack-2026.git
cd odoo-hack-2026
npm install
```

### Development Server
Run the local Vite development server:

```bash
npm run dev
```

The application will be accessible at `http://localhost:5173`. By default, network requests to `/api` are proxied to the configured backend service on port 3000 (specified in `vite.config.ts`).

### Production Build
Compile optimized production assets:

```bash
npm run build
```

The compiled static assets are generated in `dist/client`, ready for deployment to any static hosting provider (e.g., Cloudflare Pages, Vercel, Netlify, or Nginx).

### Code Quality and Type Checking
Run the TypeScript compiler to verify static type adherence:

```bash
npm run typecheck
```
