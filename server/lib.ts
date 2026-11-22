import { generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify, randomBytes, randomInt, type KeyObject } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, one, run } from './db.ts';
import { deliverSms } from './sms.ts';

// ---- Ticket signing (Ed25519). The crew app can check a ticket with the public key alone, offline.
// Keys live in the database (not a file), so hosted servers that restart keep the same keys and old tickets stay valid.
let privKey: KeyObject, pubKey: KeyObject;
/** Raw 32-byte public key, base64url, for WebCrypto in the crew app. */
export let PUBLIC_KEY_RAW = '';
export async function initKeys() {
  let row = await one<{ value: string }>("SELECT value FROM settings WHERE key = 'ticket_keys'");
  if (!row) {
    // Reuse the keys from an earlier local install if there are any, so existing tickets keep working.
    const oldFile = join(DATA_DIR, 'ticket-keys.json');
    let value: string;
    if (existsSync(oldFile)) value = readFileSync(oldFile, 'utf8');
    else {
      const { privateKey, publicKey } = generateKeyPairSync('ed25519');
      value = JSON.stringify({ private: privateKey.export({ format: 'pem', type: 'pkcs8' }), public: publicKey.export({ format: 'pem', type: 'spki' }) });
    }
    await run("INSERT INTO settings (key, value) VALUES ('ticket_keys', ?) ON CONFLICT (key) DO NOTHING", value);
    row = await one<{ value: string }>("SELECT value FROM settings WHERE key = 'ticket_keys'");
  }
  const keys = JSON.parse(row!.value);
  privKey = createPrivateKey(keys.private);
  pubKey = createPublicKey(keys.public);
  PUBLIC_KEY_RAW = (pubKey.export({ format: 'jwk' }) as { x: string }).x;
}

export type TicketClaims = { c: string; r: number; d: string; n: string };
const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function signTicket(claims: TicketClaims): string {
  const body = b64u(JSON.stringify(claims));
  const sig = sign(null, Buffer.from(body), privKey).toString('base64url');
  return `HOP1.${body}.${sig}`;
}

export function readTicket(qr: string): TicketClaims | null {
  const parts = qr.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'HOP1') return null;
  const ok = verify(null, Buffer.from(parts[1]), pubKey, Buffer.from(parts[2], 'base64url'));
  if (!ok) return null;
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString()); } catch { return null; }
}

// ---- Staff badges: a signed QR on the crew member's digital ID card, so anyone can check it is real.
export type StaffClaims = { s: string; n: string; r: string; t: number };
export function signStaff(claims: StaffClaims): string {
  const body = b64u(JSON.stringify(claims));
  return `STF1.${body}.${sign(null, Buffer.from(body), privKey).toString('base64url')}`;
}
export function readStaff(qr: string): StaffClaims | null {
  const parts = String(qr || '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'STF1') return null;
  if (!verify(null, Buffer.from(parts[1]), pubKey, Buffer.from(parts[2], 'base64url'))) return null;
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString()); } catch { return null; }
}

export { hashPin, checkPin } from './pin.ts';
const ROLE_LETTER: Record<string, string> = { conductor: 'C', driver: 'D', manager: 'M', admin: 'A' };
export const staffIdFor = (role: string, n: number) => `VIP-${ROLE_LETTER[role] || 'X'}${String(n).padStart(4, '0')}`;
export const normStaffId = (s: string) => String(s || '').toUpperCase().replace(/\s+/g, '').replace(/^VIP-?/, 'VIP-');

// ---- IDs and tokens
export const token = (bytes = 24) => randomBytes(bytes).toString('base64url');
export const otpCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ticketCode = () => 'VIP-' + Array.from({ length: 6 }, () => ALPHA[randomInt(0, ALPHA.length)]).join('');

// ---- Phone numbers: accept 024..., +23324..., 23324...; store as 0XXXXXXXXX.
export function normPhone(p: string): string | null {
  const d = String(p || '').replace(/\D/g, '');
  let local = d;
  if (d.startsWith('233') && d.length === 12) local = '0' + d.slice(3);
  if (local.length === 9) local = '0' + local;
  return /^0[235]\d{8}$/.test(local) ? local : null;
}

// ---- SMS. Every message is logged in the outbox (shown on the ops dashboard). With SMS_PROVIDER set it is
// also sent for real (see sms.ts). Sending runs in the background so a slow SMS never delays the app.
export function sendSms(to: string, body: string) {
  void (async () => {
    const status = await deliverSms(to, body).catch((e) => { console.error('[sms failed]', e?.message || e); return 'failed'; });
    await run('INSERT INTO sms_outbox (to_phone, body, status) VALUES (?, ?, ?)', to, body, status);
    if (status === 'logged') console.log(`[sms -> ${to}] ${body}`);
  })().catch((e) => console.error('[sms outbox]', e?.message || e));
}

export function audit(actor: string, action: string, detail?: unknown) {
  void run('INSERT INTO audit_log (actor, action, detail) VALUES (?, ?, ?)', actor, action, detail ? JSON.stringify(detail) : null)
    .catch((e) => console.error('[audit]', e?.message || e));
}

// ---- Money and dates
export const cedis = (pesewas: number) => 'GH₵' + (pesewas / 100).toFixed(pesewas % 100 ? 2 : 0);
export function todayGh(): string {
  // Ghana is UTC+0 all year, so UTC date is local date.
  return new Date().toISOString().slice(0, 10);
}

// ---- Geo
export function distKm(a: [number, number], b: [number, number]) {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toR, dLng = (b[1] - a[1]) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export function pathLengthKm(path: [number, number][]) {
  let s = 0;
  for (let i = 1; i < path.length; i++) s += distKm(path[i - 1], path[i]);
  return s;
}
/** Point at fraction f (0..1) along the path. */
export function pointAlong(path: [number, number][], f: number): [number, number] {
  const total = pathLengthKm(path);
  let target = Math.max(0, Math.min(1, f)) * total;
  for (let i = 1; i < path.length; i++) {
    const seg = distKm(path[i - 1], path[i]);
    if (target <= seg) {
      const k = seg ? target / seg : 0;
      return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * k, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * k];
    }
    target -= seg;
  }
  return path[path.length - 1];
}
/** Fraction along the path of the nearest vertex-projected point (good enough for ETA). */
export function progressOf(path: [number, number][], p: [number, number]): number {
  const total = pathLengthKm(path);
  let best = Infinity, bestAt = 0, acc = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], seg = distKm(a, b);
    for (let s = 0; s <= 10; s++) {
      const q: [number, number] = [a[0] + (b[0] - a[0]) * s / 10, a[1] + (b[1] - a[1]) * s / 10];
      const d = distKm(q, p);
      if (d < best) { best = d; bestAt = acc + seg * s / 10; }
    }
    acc += seg;
  }
  return total ? bestAt / total : 0;
}
