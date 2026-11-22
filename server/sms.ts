// SMS sending. Choose with SMS_PROVIDER:
//   (not set)  log only: messages appear in the ops dashboard's "Messages sent", nothing is sent (trial default)
//   arkesel    Arkesel SMS (Ghana)   needs ARKESEL_API_KEY, SMS_SENDER
//   hubtel     Hubtel SMS (Ghana)    needs HUBTEL_SMS_CLIENT_ID, HUBTEL_SMS_CLIENT_SECRET, SMS_SENDER
//   mnotify    mNotify (Ghana)       needs MNOTIFY_API_KEY, SMS_SENDER
// SMS_SENDER is the approved sender name (e.g. VIPHopOn, max 11 characters). Providers must approve it first.
// Before going live, confirm each endpoint and field against the provider's current API docs.

const PROVIDER = (process.env.SMS_PROVIDER || '').toLowerCase();
const SENDER = (process.env.SMS_SENDER || 'VIPHopOn').slice(0, 11);
const intl = (local: string) => '233' + local.replace(/^0/, ''); // 0241234567 -> 233241234567

/** Sends one SMS. Returns 'sent' or 'logged' (no provider), throws on provider errors. */
export async function deliverSms(to: string, body: string): Promise<'sent' | 'logged'> {
  if (!PROVIDER) return 'logged';
  let res: Response;
  if (PROVIDER === 'arkesel') {
    res = await fetch('https://sms.arkesel.com/api/v2/sms/send', {
      method: 'POST',
      headers: { 'api-key': process.env.ARKESEL_API_KEY || '', 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender: SENDER, message: body, recipients: [intl(to)] }),
    });
  } else if (PROVIDER === 'hubtel') {
    const q = new URLSearchParams({
      clientid: process.env.HUBTEL_SMS_CLIENT_ID || '', clientsecret: process.env.HUBTEL_SMS_CLIENT_SECRET || '',
      from: SENDER, to: intl(to), content: body,
    });
    res = await fetch(`https://smsc.hubtel.com/v1/messages/send?${q}`);
  } else if (PROVIDER === 'mnotify') {
    res = await fetch(`https://api.mnotify.com/api/sms/quick?key=${encodeURIComponent(process.env.MNOTIFY_API_KEY || '')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: [to], sender: SENDER, message: body, is_schedule: false }),
    });
  } else {
    throw new Error(`Unknown SMS_PROVIDER "${PROVIDER}"`);
  }
  if (!res.ok) throw new Error(`${PROVIDER} SMS failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return 'sent';
}

export const SMS_LIVE = !!PROVIDER;
