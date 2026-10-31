import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './app.css';
import './styles.css';
import { AuthProvider, RequireRole } from './auth';
import { PortalLayout, StaffLayout } from './layout';
import { Forgot, Login, Mailbox, Reset, Signup } from './pages/auth';
import { DashboardPage } from './pages/dashboard';
import { SubscriptionDetailPage, SubscriptionFormPage, SubscriptionsPage } from './pages/subscriptions';
import { InvoiceDetailPage, InvoicesPage, PaymentsPage } from './pages/invoices';
import { CustomerDetailPage, CustomersPage } from './pages/customers';
import { DiscountFormPage, DiscountsPage, PlansPage, ProductFormPage, ProductsPage, TaxesPage, TeamPage, TemplateFormPage, TemplatesPage } from './pages/catalog';
import { PortalHome, PortalInvoice, PortalInvoices, PortalProfile, PortalSubscription } from './pages/portal';
import { PortalPlans, PublicPlans } from './pages/plans';
import { EmailLogPage, SettingsPage } from './pages/admin';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/forgot-password" element={<Forgot />} />
          <Route path="/reset-password" element={<Reset />} />
          <Route path="/mailbox" element={<Mailbox />} />
          <Route path="/pricing" element={<PublicPlans />} />
          <Route element={<RequireRole roles={['admin', 'staff']}><StaffLayout /></RequireRole>}>
            <Route index element={<DashboardPage />} />
            <Route path="subscriptions" element={<SubscriptionsPage />} />
            <Route path="subscriptions/new" element={<SubscriptionFormPage />} />
            <Route path="subscriptions/:id" element={<SubscriptionDetailPage />} />
            <Route path="subscriptions/:id/edit" element={<SubscriptionFormPage />} />
            <Route path="invoices" element={<InvoicesPage />} />
            <Route path="invoices/:id" element={<InvoiceDetailPage />} />
            <Route path="payments" element={<PaymentsPage />} />
            <Route path="customers" element={<CustomersPage />} />
            <Route path="customers/:id" element={<CustomerDetailPage />} />
            <Route path="templates" element={<TemplatesPage />} />
            <Route path="templates/new" element={<TemplateFormPage />} />
            <Route path="templates/:id" element={<TemplateFormPage />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="products/new" element={<RequireRole roles={['admin']}><ProductFormPage /></RequireRole>} />
            <Route path="products/:id" element={<RequireRole roles={['admin']}><ProductFormPage /></RequireRole>} />
            <Route path="plans" element={<PlansPage />} />
            <Route path="taxes" element={<TaxesPage />} />
            <Route path="discounts" element={<DiscountsPage />} />
            <Route path="discounts/new" element={<RequireRole roles={['admin']}><DiscountFormPage /></RequireRole>} />
            <Route path="discounts/:id" element={<RequireRole roles={['admin']}><DiscountFormPage /></RequireRole>} />
            <Route path="team" element={<RequireRole roles={['admin']}><TeamPage /></RequireRole>} />
            <Route path="settings" element={<RequireRole roles={['admin']}><SettingsPage /></RequireRole>} />
            <Route path="emails" element={<RequireRole roles={['admin']}><EmailLogPage /></RequireRole>} />
          </Route>
          <Route path="/portal" element={<RequireRole roles={['customer']}><PortalLayout /></RequireRole>}>
            <Route index element={<PortalHome />} />
            <Route path="subscriptions/:id" element={<PortalSubscription />} />
            <Route path="invoices" element={<PortalInvoices />} />
            <Route path="invoices/:id" element={<PortalInvoice />} />
            <Route path="profile" element={<PortalProfile />} />
            <Route path="plans" element={<PortalPlans />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
