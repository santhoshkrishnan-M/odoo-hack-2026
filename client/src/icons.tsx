// 16px outline icons, 1.5px stroke, drawn for this app.
const P = (d: string) => () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
export const Icon = {
  overview: P('M2.5 13.5h11M4 11V7m3 4V4m3 7V8m3 3V5.5'),
  subscriptions: P('M13 8a5 5 0 1 1-1.5-3.6M12 2v2.6H9.4'),
  invoices: P('M4 1.75h6l2.25 2.25v10.25H4zM6 7h4M6 9.5h4M6 12h2'),
  payments: P('M1.75 4.25h12.5v8.5H1.75zM1.75 7h12.5M4 10.5h2'),
  customers: P('M6 7a2.25 2.25 0 1 0 0-4.5A2.25 2.25 0 0 0 6 7zM1.75 13.5c.4-2.3 2.1-3.75 4.25-3.75s3.85 1.45 4.25 3.75M10.5 2.75a2.25 2.25 0 0 1 0 4.25M12 9.9c1.2.5 2 1.7 2.25 3.6'),
  templates: P('M2.75 2.75h10.5v10.5H2.75zM5.5 6h5M5.5 8.5h5M5.5 11h3'),
  products: P('M8 1.75 13.75 5v6L8 14.25 2.25 11V5zM2.25 5 8 8.25 13.75 5M8 8.25v6'),
  plans: P('M2.75 3.25h10.5v10H2.75zM2.75 6.25h10.5M5.5 1.75v3M10.5 1.75v3'),
  taxes: P('M4 12 12 4M5 6.25a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5zM11 12.25a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5z'),
  discounts: P('M8.6 1.75h5.65V7.4L7.5 14.15 1.85 8.5zM11.25 5.25h.01'),
  team: P('M8 7.25a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM3 14c.5-2.6 2.5-4.25 5-4.25S12.5 11.4 13 14'),
  profile: P('M8 7.25a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM3 14c.5-2.6 2.5-4.25 5-4.25S12.5 11.4 13 14'),
  signout: P('M6 2.75H2.75v10.5H6M10 5l3 3-3 3M13 8H6'),
  menu: P('M2.5 4.5h11M2.5 8h11M2.5 11.5h11'),
  close: P('M4 4l8 8M12 4l-8 8'),
  mail: P('M1.75 3.75h12.5v8.5H1.75zM1.75 4.25 8 9l6.25-4.75'),
};

export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19 12a7 7 0 1 1-2.05-4.95" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
      <path d="M17.5 3.5v4.2h-4.2" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
