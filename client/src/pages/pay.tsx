import { useState } from 'react';
import { api } from '../api';
import { ErrorNote, Modal } from '../components';
import { money } from '../format';

interface Checkout {
  id: string; provider: 'razorpay' | 'sandbox'; amount: number; invoiceNumber: string;
  razorpay?: { keyId: string; orderId: string; name: string; email: string; contact: string; description: string };
}

declare global {
  interface Window { Razorpay?: new (o: Record<string, unknown>) => { open: () => void; on: (e: string, fn: (r: { error?: { description?: string } }) => void) => void } }
}

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the payment window. Check your connection.'));
    document.head.appendChild(s);
  });
}

/** "Pay now" for one invoice: Razorpay Checkout when the business has connected Razorpay, otherwise the sandbox gateway. */
export function PayButton({ invoiceId, amount, onPaid, primary = true, label }: { invoiceId: number; amount: number; onPaid: () => void; primary?: boolean; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sandbox, setSandbox] = useState<Checkout | null>(null);
  const start = async () => {
    setBusy(true); setError(null);
    try {
      const c = await api<Checkout>(`/portal/invoices/${invoiceId}/checkout`, { method: 'POST' });
      if (c.provider === 'sandbox') { setSandbox(c); return; }
      await loadRazorpay();
      const r = c.razorpay!;
      const rz = new window.Razorpay!({
        key: r.keyId, order_id: r.orderId, amount: c.amount, currency: 'INR', name: 'Brightloop Software', description: r.description,
        prefill: { name: r.name, email: r.email, contact: r.contact }, theme: { color: '#141414' },
        handler: async (resp: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          try {
            await api(`/portal/checkouts/${c.id}/razorpay`, { body: { orderId: resp.razorpay_order_id, paymentId: resp.razorpay_payment_id, signature: resp.razorpay_signature } });
            onPaid();
          } catch (e) { setError((e as Error).message); }
        },
        modal: { ondismiss: () => { void api(`/portal/checkouts/${c.id}/cancel`, { method: 'POST' }).catch(() => undefined); } },
      });
      rz.on('payment.failed', (resp) => setError(resp.error?.description ?? 'The payment did not go through.'));
      rz.open();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className={`btn${primary ? ' primary' : ''}`} onClick={start} disabled={busy}>{busy ? 'Opening…' : label ?? `Pay ${money(amount)} now`}</button>
      {error ? <span className="field-error" role="alert" style={{ marginLeft: 8 }}>{error}</span> : null}
      {sandbox ? <SandboxCheckout checkout={sandbox} onClose={() => setSandbox(null)} onPaid={() => { setSandbox(null); onPaid(); }} /> : null}
    </>
  );
}

/** Test-mode gateway page: behaves like a hosted checkout (choose a method, approve or decline) without moving real money. */
function SandboxCheckout({ checkout, onClose, onPaid }: { checkout: Checkout; onClose: () => void; onPaid: () => void }) {
  const [method, setMethod] = useState<'upi' | 'card' | 'netbanking'>('upi');
  const [upi, setUpi] = useState('success@razorpay');
  const [card, setCard] = useState('4111 1111 1111 1111');
  const [step, setStep] = useState<'choose' | 'processing' | 'failed'>('choose');
  const [error, setError] = useState<string | null>(null);
  const pay = async (success: boolean) => {
    setStep('processing'); setError(null);
    await new Promise((r) => setTimeout(r, 900));
    try {
      const r = await api<{ status: string }>(`/portal/checkouts/${checkout.id}/sandbox`, { body: { success, method } });
      if (r.status === 'paid') onPaid(); else setStep('failed');
    } catch (e) { setError((e as Error).message); setStep('choose'); }
  };
  const cancel = () => { void api(`/portal/checkouts/${checkout.id}/cancel`, { method: 'POST' }).catch(() => undefined); onClose(); };
  return (
    <Modal title="Secure payment" onClose={cancel}>
      <div className="checkout">
        <div className="checkout-head">
          <div><div className="muted">Paying invoice</div><div className="mono">{checkout.invoiceNumber}</div></div>
          <div className="checkout-amount num">{money(checkout.amount)}</div>
        </div>
        <div className="test-banner">Test mode — no real money moves. Connect Razorpay keys to take live payments.</div>
        {error ? <ErrorNote error={error} /> : null}
        {step === 'processing' ? <div className="checkout-wait" aria-busy="true"><span className="spinner" aria-hidden="true" />Confirming with your bank…</div> : step === 'failed' ? (
          <div className="checkout-wait">
            <div className="neg-text" style={{ fontWeight: 500 }}>The payment was declined.</div>
            <div className="muted">Nothing was charged. Try again or choose another method.</div>
            <button className="btn" onClick={() => setStep('choose')}>Try again</button>
          </div>
        ) : (
          <>
            <div className="segmented" role="radiogroup" aria-label="Payment method" style={{ margin: '4px 0 16px' }}>
              {(['upi', 'card', 'netbanking'] as const).map((m) => <button key={m} type="button" role="radio" aria-checked={method === m} aria-pressed={method === m} onClick={() => setMethod(m)}>{m === 'upi' ? 'UPI' : m === 'card' ? 'Card' : 'Net banking'}</button>)}
            </div>
            {method === 'upi' ? <div className="field"><label htmlFor="upi">UPI ID</label><input id="upi" className="input" value={upi} onChange={(e) => setUpi(e.target.value)} /><span className="hint">Any ID works in test mode</span></div> : null}
            {method === 'card' ? <div className="field"><label htmlFor="card">Card number</label><input id="card" className="input num" value={card} onChange={(e) => setCard(e.target.value)} inputMode="numeric" /><span className="hint">Test card, any expiry and CVV</span></div> : null}
            {method === 'netbanking' ? <div className="field"><label htmlFor="bank">Bank</label><select id="bank" className="input"><option>HDFC Bank</option><option>State Bank of India</option><option>ICICI Bank</option><option>Axis Bank</option></select></div> : null}
            <div className="form-actions" style={{ marginTop: 20 }}>
              <button type="button" className="btn ghost" onClick={() => pay(false)}>Simulate a decline</button>
              <button type="button" className="btn primary" onClick={() => pay(true)}>Pay {money(checkout.amount)}</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
