import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';
import { Icon, Mark } from './icons';
import { useApi } from './components';
import { LiveBadge, Toaster } from './toasts';

interface NavItem { to: string; label: string; icon: () => ReactElement; end?: boolean; adminOnly?: boolean; count?: number }

function Shell({ scope, groups, children }: { scope: string; groups: { label?: string; items: NavItem[] }[]; children: ReactNode }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [loc.pathname]);
  const title = groups.flatMap((g) => g.items).find((i) => (i.end ? loc.pathname === i.to : loc.pathname.startsWith(i.to)))?.label ?? 'Brightloop';
  return (
    <div className="app">
      <header className="phone-bar">
        <span className="brand-sm"><Mark size={18} /> {title}</span>
        <button className="btn ghost menu-toggle" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}><Icon.menu /></button>
      </header>
      <nav className={`sidebar${open ? ' open' : ''}`} aria-label="Main">
        <div className="brand">
          <Mark />
          <div>
            <div className="brand-name">Brightloop</div>
            <div className="brand-scope">{scope}</div>
          </div>
          <button className="btn ghost menu-close" aria-label="Close menu" onClick={() => setOpen(false)}><Icon.close /></button>
        </div>
        {groups.map((g, gi) => (
          <div key={gi} className="nav-group">
            {g.label ? <div className="group-label">{g.label}</div> : null}
            {g.items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.end} className="nav-item">
                <i.icon /><span>{i.label}</span>
                {i.count ? <span className="nav-count num" aria-label={`${i.count} waiting`}>{i.count}</span> : null}
              </NavLink>
            ))}
          </div>
        ))}
        <div className="bottom">
          <LiveBadge />
          <div className="user-row">
            <span className="avatar" aria-hidden="true">{user?.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>
            <div className="who"><div>{user?.name}</div><div className="sub">{user?.role === 'customer' ? user.email : user?.role === 'admin' ? 'Admin' : 'Staff'}</div></div>
            <button className="btn ghost icon" aria-label="Sign out" title="Sign out" onClick={async () => { await logout(); nav('/login'); }}><Icon.signout /></button>
          </div>
        </div>
      </nav>
      <main className="canvas" id="main">{children}</main>
      <Toaster />
    </div>
  );
}

export function StaffLayout() {
  const { user } = useAuth();
  const { data } = useApi<{ n: number }>('/billing/due');
  const groups: { label?: string; items: NavItem[] }[] = [
    { items: [
      { to: '/', label: 'Overview', icon: Icon.overview, end: true },
      { to: '/subscriptions', label: 'Subscriptions', icon: Icon.subscriptions },
      { to: '/invoices', label: 'Invoices', icon: Icon.invoices, count: data?.n || undefined },
      { to: '/payments', label: 'Payments', icon: Icon.payments },
      { to: '/customers', label: 'Customers', icon: Icon.customers },
    ] },
    { label: 'Catalogue', items: [
      { to: '/templates', label: 'Quotation templates', icon: Icon.templates },
      { to: '/products', label: 'Products', icon: Icon.products },
      { to: '/plans', label: 'Plans', icon: Icon.plans },
      { to: '/discounts', label: 'Discounts', icon: Icon.discounts },
      { to: '/taxes', label: 'Taxes', icon: Icon.taxes },
    ] },
  ];
  if (user?.role === 'admin') groups.push({ label: 'Admin', items: [
    { to: '/settings', label: 'Settings & automation', icon: Icon.settings },
    { to: '/emails', label: 'Email log', icon: Icon.mail },
    { to: '/team', label: 'Team', icon: Icon.team },
  ] });
  return <Shell scope="Brightloop Software · Billing" groups={groups}><Outlet /></Shell>;
}

export function PortalLayout() {
  const { data } = useApi<{ company: string; name: string }>('/portal/profile');
  return (
    <Shell scope={data?.company || data?.name || 'Your account'} groups={[{ items: [
      { to: '/portal', label: 'Subscriptions', icon: Icon.subscriptions, end: true },
      { to: '/portal/invoices', label: 'Invoices', icon: Icon.invoices },
      { to: '/portal/plans', label: 'Browse plans', icon: Icon.plans },
      { to: '/portal/profile', label: 'Profile', icon: Icon.profile },
    ] }]}><Outlet /></Shell>
  );
}
