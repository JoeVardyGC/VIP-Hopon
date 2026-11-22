import { io, type Socket } from 'socket.io-client';

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string | null) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
};
export { store };

export type Who = 'passenger' | 'crew';
export const auth = {
  token: (who: Who) => store.get(`hopon.${who}`),
  set: (who: Who, t: string | null) => store.set(`hopon.${who}`, t),
};

export class ApiError extends Error { status: number; constructor(status: number, m: string) { super(m); this.status = status; } }

// Where the server lives. Empty = same site (local dev, or everything on Render).
// On Netlify set VITE_API_URL to the Render address, e.g. https://vip-hopon-api.onrender.com
export const API_BASE = String((import.meta as any).env?.VITE_API_URL || '').replace(/\/$/, '');

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; who?: Who } = {}): Promise<T> {
  const t = opts.who ? auth.token(opts.who) : null;
  let res: Response;
  try {
    res = await fetch(API_BASE + '/api' + path, {
      method: opts.method || (opts.body ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'No connection. Check your data and try again.');
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && opts.who) auth.set(opts.who, null);
    throw new ApiError(res.status, j.error || 'Something went wrong');
  }
  return j as T;
}

let sock: Socket | null = null;
export function socket() {
  if (!sock) sock = API_BASE ? io(API_BASE, { transports: ['websocket', 'polling'] }) : io({ transports: ['websocket', 'polling'] });
  return sock;
}

/** Server settings (test mode, login-code mode). Fetched once. */
let cfg: Promise<{ testMode: boolean; otpMode: string; publicKey: string; hubtelMode: string }> | null = null;
export const getConfig = () => (cfg ??= api('/config').catch(() => ({ testMode: false, otpMode: 'sms', publicKey: '', hubtelMode: 'mock' })));
/** Join a live room and call fn on the given event. Returns a cleanup function. */
export function live(room: string, event: string, fn: (data: any) => void) {
  const s = socket();
  const join = () => s.emit('watch', room);
  join();
  s.on('connect', join);
  s.on(event, fn);
  return () => { s.off(event, fn); s.off('connect', join); s.emit('unwatch', room); };
}

export const cedis = (p: number) => 'GH₵' + (p / 100).toLocaleString('en-GH', { minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 });
export const todayIso = () => new Date().toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export function niceDate(iso: string) {
  const t = todayIso();
  const d = new Date(iso + 'T00:00:00Z');
  const s = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  if (iso === t) return 'Today, ' + s.split(' ').slice(1).join(' ');
  if (iso === addDays(t, 1)) return 'Tomorrow, ' + s.split(' ').slice(1).join(' ');
  return s;
}
export const timeOf = (sqlUtc: string | null | undefined) =>
  sqlUtc ? new Date(sqlUtc.replace(' ', 'T') + 'Z').toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
export const firstName = (n?: string | null) => (n || '').trim().split(/\s+/)[0] || '';
export const initials = (n?: string | null) => (n || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
export const prettyPhone = (p: string) => p.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1 $2 $3');
