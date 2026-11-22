// Payment adapter. HUBTEL_MODE=mock (default) runs a local test checkout so the whole
// flow works with no Hubtel account. HUBTEL_MODE=live calls Hubtel's online checkout.
// Before going live, confirm the endpoints and field names below against Hubtel's current
// developer docs and VIP's merchant account settings.

export const MODE = (process.env.HUBTEL_MODE || 'mock') as 'mock' | 'live';

type Checkout = { checkoutUrl: string; checkoutId: string };
type Status = { paid: boolean; txnId: string; amount: number; method: string; raw: unknown };

const cfg = {
  clientId: process.env.HUBTEL_CLIENT_ID || '',
  clientSecret: process.env.HUBTEL_CLIENT_SECRET || '',
  merchant: process.env.HUBTEL_MERCHANT_ACCOUNT || '',
  publicUrl: process.env.PUBLIC_URL || 'http://localhost:5173',
};
const auth = () => 'Basic ' + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');

export async function createCheckout(o: { clientRef: string; amount: number; description: string; bookingId: number }): Promise<Checkout> {
  if (MODE === 'mock') {
    return { checkoutUrl: `/pay/${o.bookingId}`, checkoutId: 'mock-' + o.clientRef };
  }
  const res = await fetch('https://payproxyapi.hubtel.com/items/initiate', {
    method: 'POST',
    headers: { Authorization: auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      totalAmount: o.amount / 100,
      description: o.description,
      callbackUrl: `${cfg.publicUrl}/api/hubtel/callback`,
      returnUrl: `${cfg.publicUrl}/tickets?paid=${o.bookingId}`,
      cancellationUrl: `${cfg.publicUrl}/tickets`,
      merchantAccountNumber: cfg.merchant,
      clientReference: o.clientRef,
    }),
  });
  const j: any = await res.json();
  if (!res.ok || !j?.data?.checkoutUrl) throw new Error('Hubtel checkout failed: ' + JSON.stringify(j));
  return { checkoutUrl: j.data.checkoutUrl, checkoutId: j.data.checkoutId };
}

/** Never trust a callback on its own: always re-check the status with Hubtel. */
export async function verifyPayment(clientRef: string, mockData?: { txnId: string; amount: number; method: string }): Promise<Status> {
  if (MODE === 'mock') {
    if (!mockData) throw new Error('mock verify needs data');
    return { paid: true, ...mockData, raw: { mock: true, ...mockData } };
  }
  const res = await fetch(
    `https://api-txnstatus.hubtel.com/transactions/${cfg.merchant}/status?clientReference=${encodeURIComponent(clientRef)}`,
    { headers: { Authorization: auth() } },
  );
  const j: any = await res.json();
  const d = j?.data || {};
  return {
    paid: String(d.status).toLowerCase() === 'paid',
    txnId: d.transactionId || d.externalTransactionId || clientRef,
    amount: Math.round(Number(d.amount || 0) * 100),
    method: d.paymentMethod || 'unknown',
    raw: j,
  };
}
