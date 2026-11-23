import express, { type Request, type Response, type NextFunction } from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server as IOServer } from 'socket.io';
import { initDb, one, all, run, insert, tx, DRIVER } from './db.ts';
import {
  initKeys, signTicket, readTicket, PUBLIC_KEY_RAW, token, otpCode, ticketCode, normPhone, sendSms, audit,
  signStaff, readStaff, hashPin, checkPin, staffIdFor, normStaffId,
  cedis, todayGh, distKm, pathLengthKm, pointAlong, progressOf,
} from './lib.ts';
import { seedIfEmpty } from './seed.ts';
import { SMS_LIVE } from './sms.ts';
import * as hubtel from './hubtel.ts';

// ---------------------------------------------------------------- settings (environment variables)
const DEV = process.env.NODE_ENV !== 'production';
// In dev the API sits behind Vite's proxy on 4000 (PORT may belong to Vite); hosts set PORT in production.
const PORT = Number((DEV ? process.env.API_PORT : process.env.PORT) || 4000);
// Links in SMS and share sheets. Set PUBLIC_URL online (your Netlify address); locally it follows the address the phone used.
let PUBLIC_URL = (process.env.PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, '');
// Trial helpers: "Test mode" buttons (check in without location, demo drive) work when TEST_MODE is on.
const TEST_MODE = DEV || process.env.TEST_MODE === 'true';
// Login codes: 'screen' shows the code on screen (trial, no SMS); 'sms' sends it by SMS (needs SMS_PROVIDER).
const OTP_MODE = (process.env.OTP_MODE || (SMS_LIVE ? 'sms' : 'screen')) as 'screen' | 'sms';
// Closed trial: only these numbers can get a login code (comma separated). Empty = anyone (fine on your laptop).
const TEST_PHONES = new Set(String(process.env.TEST_PHONES || '').split(',').map((p) => normPhone(p)).filter(Boolean) as string[]);
// Which websites may call this API from a browser (your Netlify address). '*' allows any.
const CORS_ORIGINS = String(process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
const HOLD_MS = 15 * 60 * 1000;

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '200kb' }));
app.use((req, res, next) => {
  const origin = String(req.headers.origin || '');
  if (origin && (CORS_ORIGINS.includes('*') || CORS_ORIGINS.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  if (!process.env.PUBLIC_URL) {
    const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
    const proto = (req.headers['x-forwarded-proto'] as string) || (origin.startsWith('https') ? 'https' : req.protocol);
    if (host && host !== `localhost:${PORT}`) PUBLIC_URL = `${proto.split(',')[0]}://${host}`;
  }
  next();
});
const server = createServer(app);
const io = new IOServer(server, { cors: { origin: CORS_ORIGINS.length ? (CORS_ORIGINS.includes('*') ? true : CORS_ORIGINS) : true } });

io.on('connection', (s) => {
  s.on('watch', (room: string) => {
    if (typeof room === 'string' && /^(board|ops|trip:\d+)$/.test(room)) s.join(room);
  });
  s.on('unwatch', (room: string) => s.leave(room));
});

// ---------------------------------------------------------------- helpers
class HttpError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status; } }
const fail = (status: number, msg: string): never => { throw new HttpError(status, msg); };
type H = (req: Request, res: Response) => unknown;
const h = (fn: H) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve().then(() => fn(req, res)).then((v) => { if (!res.headersSent) res.json(v ?? { ok: true }); }).catch(next);
};

/** Small in-memory rate limiter (per key, sliding window). Protects SMS credit and PIN guessing. */
const hits = new Map<string, number[]>();
function limit(key: string, max: number, windowMs: number, msg: string) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) fail(429, msg);
  arr.push(now); hits.set(key, arr);
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 3600_000)) hits.delete(k); }, 600_000);

type Session = { kind: 'passenger' | 'crew'; user_id: number };
async function session(req: Request): Promise<Session | undefined> {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!t) return;
  return one<Session>('SELECT kind, user_id FROM sessions WHERE token = ?', t);
}
async function passenger(req: Request) {
  const s = await session(req);
  if (!s || s.kind !== 'passenger') fail(401, 'Please sign in');
  return (await one<any>('SELECT * FROM passengers WHERE id = ?', s!.user_id)) ?? fail(401, 'Please sign in');
}
async function crew(req: Request, ...roles: string[]) {
  const s = await session(req);
  if (!s || s.kind !== 'crew') fail(401, 'Crew sign-in needed');
  const c = (await one<any>('SELECT id, staff_id, name, phone, role, terminal_id FROM crew WHERE id = ? AND active = 1', s!.user_id)) ?? fail(401, 'Crew sign-in needed');
  if (roles.length && !roles.includes(c.role)) fail(403, 'Not allowed for your role');
  return c;
}
const int = (v: unknown) => { const n = Number(v); return Number.isInteger(n) ? n : fail(400, 'Bad number'); };
const validDate = (d: unknown) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : fail(400, 'Bad date'));

// ---------------------------------------------------------------- routes and towns (cached in memory; they rarely change)
type Terminal = { id: number; name: string; city: string; region: string; lat: number; lng: number; radius_m: number };
type RouteInfo = {
  id: number; fare: number; fareSource: string; appShare: number; dailyCap: number; active: boolean;
  from: { id: number; name: string; city: string; region: string; lat: number; lng: number; radius: number };
  to: { id: number; name: string; city: string; region: string };
  label: string; path: [number, number][]; km: number; hours: number; stops: { city: string; at: number }[];
};
let terminals: Terminal[] = [];
const routeCache = new Map<number, RouteInfo>();
async function loadNetwork() {
  terminals = await all<Terminal>('SELECT * FROM terminals');
  const byId = new Map(terminals.map((t) => [t.id, t]));
  routeCache.clear(); stopCache.clear();
  for (const r of await all<any>('SELECT * FROM routes')) {
    const f = byId.get(r.from_terminal)!, t = byId.get(r.to_terminal)!;
    const path = JSON.parse(r.path) as [number, number][];
    routeCache.set(r.id, {
      id: r.id, fare: r.fare, fareSource: r.fare_source, appShare: r.app_share, dailyCap: r.daily_cap, active: !!r.active,
      from: { id: f.id, name: f.name, city: f.city, region: f.region, lat: f.lat, lng: f.lng, radius: f.radius_m },
      to: { id: t.id, name: t.name, city: t.city, region: t.region },
      label: `${f.city} to ${t.city}`, path, km: r.km ?? Math.round(pathLengthKm(path)), hours: r.hours,
      stops: stopsOn(r.id, path, [f.id, t.id]),
    });
  }
}
const routeInfo = (id: number) => routeCache.get(Number(id));

// VIP towns the road passes through, in order, for the live-trip stop list.
const stopCache = new Map<number | string, { city: string; at: number }[]>();
function stopsOn(key: number | string, path: [number, number][], skip: number[]) {
  if (stopCache.has(key)) return stopCache.get(key)!;
  const stops = terminals.filter((t) => !skip.includes(t.id))
    .map((t) => {
      let best = Infinity;
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i];
        for (let s = 0; s <= 4; s++) best = Math.min(best, distKm([a[0] + (b[0] - a[0]) * s / 4, a[1] + (b[1] - a[1]) * s / 4], [t.lat, t.lng]));
      }
      return { city: t.city, near: best, at: progressOf(path, [t.lat, t.lng]) };
    })
    .filter((t) => t.near < 6 && t.at > 0.03 && t.at < 0.97)
    .sort((a, b) => a.at - b.at)
    .map(({ city, at }) => ({ city, at: Math.round(at * 1000) / 1000 }));
  stopCache.set(key, stops);
  return stops;
}

async function tripSeats(tripId: number) {
  return (await one<{ filled: number; app: number }>(
    'SELECT COUNT(*) AS filled, COALESCE(SUM(CASE WHEN ticket_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS app FROM boardings WHERE trip_id = ?', tripId))!;
}

async function tripView(tripId: number) {
  const t = await one<any>(`SELECT t.*, b.number AS bus_number, b.plate, b.seats, c.name AS conductor, d.name AS driver
     FROM trips t JOIN buses b ON b.id = t.bus_id JOIN crew c ON c.id = t.conductor_id JOIN crew d ON d.id = t.driver_id WHERE t.id = ?`, tripId);
  if (!t) return undefined;
  const route = routeInfo(t.route_id)!;
  const seats = await tripSeats(tripId);
  // A trip follows its own path when it started from the bus phone's real location.
  const path: [number, number][] = t.path ? JSON.parse(t.path) : route.path;
  const km = t.path ? Math.max(1, Math.round(t.path_km)) : route.km;
  const hours = t.path ? +(km / 65).toFixed(1) : route.hours;
  const stops = t.path ? stopsOn(`trip${t.id}:${t.path.length}`, path, [route.from.id, route.to.id]) : route.stops;
  const distLeft = km * (1 - (t.progress || 0));
  const speed = t.speed && t.speed > 20 ? t.speed : 70;
  return {
    id: t.id as number, status: t.status as string,
    // seats = what this trip sells (the crew can set fewer than the bus has); busSeats = the bus itself.
    bus: { number: t.bus_number, plate: t.plate, seats: (t.capacity ?? t.seats) as number, busSeats: t.seats as number },
    conductor: t.conductor, driver: t.driver, conductorId: t.conductor_id as number, driverId: t.driver_id as number,
    route: { id: route.id, label: route.label, from: route.from, to: route.to, path, km, hours, stops, appShare: route.appShare, fare: route.fare, fromPhone: !!t.path },
    filled: seats.filled, appFilled: seats.app,
    position: t.lat != null ? { lat: t.lat, lng: t.lng, speed: t.speed, at: t.loc_at } : null,
    progress: (t.progress || 0) as number, distLeftKm: Math.round(distLeft),
    etaMin: t.status === 'departed' ? Math.round((distLeft / speed) * 60) : null,
    openedAt: t.opened_at, departedAt: t.departed_at, arrivedAt: t.arrived_at,
  };
}
type TripView = NonNullable<Awaited<ReturnType<typeof tripView>>>;

const pushBoard = (routeId: number) => { io.to('board').emit('board:update', { routeId }); io.to('ops').emit('ops:update'); };
const pushTrip = (tripId: number) => {
  tripView(tripId).then((v) => {
    // Trip rooms include public share-link viewers, so crew names are left out.
    if (v) io.to(`trip:${tripId}`).emit('trip:update', { ...v, conductor: undefined, driver: undefined, conductorId: undefined, driverId: undefined });
    io.to('ops').emit('ops:update');
  }).catch((e) => console.error('[push]', e?.message || e));
};

// ---------------------------------------------------------------- public
app.get('/api/config', h(() => ({ hubtelMode: hubtel.MODE, publicKey: PUBLIC_KEY_RAW, today: todayGh(), dev: DEV, testMode: TEST_MODE, otpMode: OTP_MODE })));

app.get('/api/routes', h(() =>
  [...routeCache.values()].filter((v) => v.active).sort((a, b) => a.id - b.id)
    .map((v) => ({ id: v.id, label: v.label, from: v.from, to: v.to, fare: v.fare, km: v.km, hours: v.hours }))));

// Every VIP town, with region and other spellings, for the searchable town picker.
app.get('/api/towns', h(async () => (await all<any>(`SELECT t.id, t.name, t.city, t.region, t.aliases,
    (SELECT COUNT(*) FROM routes r WHERE r.from_terminal = t.id AND r.active = 1) AS departures FROM terminals t ORDER BY t.city`))
  .map((t) => ({ ...t, aliases: JSON.parse(t.aliases) }))));

app.get('/api/board', h(async (req) => {
  const routeId = int(req.query.route);
  const route = routeInfo(routeId) ?? fail(404, 'Route not found');
  const ids = await all<{ id: number }>("SELECT id FROM trips WHERE route_id = ? AND status IN ('loading','closed') ORDER BY opened_at", routeId);
  const trips = (await Promise.all(ids.map((t) => tripView(t.id)))).filter(Boolean).map((t) => t!)
    .map((t) => ({ id: t.id, status: t.status, bus: t.bus, filled: t.filled, appFilled: t.appFilled, openedAt: t.openedAt }));
  const onRoad = (await one<{ n: number }>("SELECT COUNT(*) AS n FROM trips WHERE route_id = ? AND status = 'departed'", routeId))!.n;
  const queue = (await one<{ n: number }>("SELECT COUNT(*) AS n FROM tickets WHERE route_id = ? AND travel_date = ? AND status = 'checked_in'", routeId, todayGh()))!.n;
  return { route: { id: route.id, label: route.label, from: route.from, to: route.to, fare: route.fare, appShare: route.appShare, km: route.km, hours: route.hours }, trips, onRoad, queue };
}));

// Every bus loading at one terminal (home screen "Loading at Circle now").
app.get('/api/terminal-board', h(async (req) => {
  const from = int(req.query.from);
  const ids = await all<{ id: number }>(`SELECT t.id FROM trips t JOIN routes r ON r.id = t.route_id WHERE r.from_terminal = ? AND t.status IN ('loading','closed') ORDER BY t.opened_at`, from);
  return (await Promise.all(ids.map((t) => tripView(t.id)))).filter(Boolean).map((t) => t!)
    .map((t) => ({ id: t.id, status: t.status, bus: t.bus, filled: t.filled, routeId: t.route.id, to: t.route.to }));
}));

app.post('/api/auth/otp', h(async (req) => {
  const phone = normPhone(req.body.phone) ?? fail(400, 'Enter a Ghana phone number, like 024 123 4567');
  if (TEST_PHONES.size && !TEST_PHONES.has(phone)) fail(403, 'VIP HopOn is in a closed trial. Ask VIP to add your number to the tester list.');
  limit(`otp:${phone}`, 1, 30_000, 'Please wait 30 seconds before asking for another code.');
  limit(`otp:${phone}:h`, 5, 3600_000, 'Too many codes for this number. Try again in an hour.');
  limit(`otp-ip:${req.ip}`, 20, 3600_000, 'Too many code requests from this connection. Try again later.');
  const code = otpCode();
  await run(`INSERT INTO otps (phone, code, expires_at, tries) VALUES (?, ?, ?, 0)
             ON CONFLICT (phone) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at, tries = 0`, phone, code, Date.now() + 5 * 60_000);
  sendSms(phone, `Your VIP HopOn code is ${code}. It expires in 5 minutes.`);
  // Trial ('screen' mode): show the code on screen because no SMS is sent.
  return { ok: true, phone, devCode: OTP_MODE === 'screen' ? code : undefined };
}));

app.post('/api/auth/verify', h(async (req) => {
  const phone = normPhone(req.body.phone) ?? fail(400, 'Bad phone number');
  const o = (await one<any>('SELECT * FROM otps WHERE phone = ?', phone)) ?? fail(400, 'Ask for a new code');
  if (o.expires_at < Date.now() || o.tries >= 5) fail(400, 'Code expired. Ask for a new one.');
  if (String(req.body.code).trim() !== o.code) {
    await run('UPDATE otps SET tries = tries + 1 WHERE phone = ?', phone);
    fail(400, 'That code is not right');
  }
  await run('DELETE FROM otps WHERE phone = ?', phone);
  let p = await one<any>('SELECT * FROM passengers WHERE phone = ?', phone);
  if (!p) {
    const id = await insert('INSERT INTO passengers (phone, name) VALUES (?, ?)', phone, String(req.body.name || '').trim().slice(0, 60) || null);
    p = await one('SELECT * FROM passengers WHERE id = ?', id);
  }
  const t = token();
  await run('INSERT INTO sessions (token, kind, user_id, created_at) VALUES (?, ?, ?, ?)', t, 'passenger', p.id, Date.now());
  return { token: t, passenger: p };
}));

// ---- Crew accounts. Only VIP can create one (ops "Issue Staff ID"). The crew member activates it
// with Staff ID + the phone VIP has on file + the one-time code texted to that phone, and picks a PIN.
const crewSession = async (c: any) => {
  const t = token();
  await run('INSERT INTO sessions (token, kind, user_id, created_at) VALUES (?, ?, ?, ?)', t, 'crew', c.id, Date.now());
  return { token: t, crew: { id: c.id, staffId: c.staff_id, name: c.name, role: c.role } };
};
const validPin = (p: unknown) => (/^\d{4,6}$/.test(String(p)) && !/^(\d)\1+$/.test(String(p)) && !['1234', '123456', '0000'].includes(String(p))
  ? String(p) : fail(400, 'Pick a 4 to 6 digit PIN that is not all the same digit or 1234'));

app.post('/api/crew/login', h(async (req) => {
  limit(`login-ip:${req.ip}`, 30, 600_000, 'Too many sign-in attempts. Wait a few minutes.');
  const raw = String(req.body.id ?? req.body.staffId ?? req.body.phone ?? '');
  const phone = normPhone(raw);
  let c: any;
  if (phone) {
    const rows = await all<any>('SELECT * FROM crew WHERE phone = ?', phone);
    if (rows.length > 1) fail(400, 'This number has more than one Staff ID (conductor and driver). Sign in with the Staff ID for the job you are doing now.');
    c = rows[0];
  } else c = await one<any>('SELECT * FROM crew WHERE staff_id = ?', normStaffId(raw));
  const nope = () => fail(401, 'Staff ID or PIN not recognised');
  if (!c) return nope();
  if (!c.active) fail(403, 'This Staff ID has been switched off. Speak to your terminal manager.');
  if (!c.pin_hash) fail(409, 'This Staff ID is not activated yet. Tap "First time? Activate your Staff ID".');
  if (c.locked_until && c.locked_until > Date.now()) fail(429, `Too many wrong PINs. Try again after ${new Date(c.locked_until).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}, or ask your manager to reset it.`);
  if (!checkPin(String(req.body.pin || ''), c.pin_hash)) {
    const n = c.failed_logins + 1;
    await run('UPDATE crew SET failed_logins = ?, locked_until = ? WHERE id = ?', n >= 5 ? 0 : n, n >= 5 ? Date.now() + 15 * 60000 : null, c.id);
    return nope();
  }
  await run('UPDATE crew SET failed_logins = 0, locked_until = NULL WHERE id = ?', c.id);
  return crewSession(c);
}));

app.post('/api/crew/activate', h(async (req) => {
  limit(`activate-ip:${req.ip}`, 20, 600_000, 'Too many attempts. Wait a few minutes.');
  const c = await one<any>('SELECT * FROM crew WHERE staff_id = ?', normStaffId(req.body.staffId));
  const phone = normPhone(req.body.phone);
  const bad = () => fail(400, 'Those details do not match what VIP issued. Check your Staff ID, phone and code.');
  if (!c || !phone || c.phone !== phone) return bad();
  if (!c.active) fail(403, 'This Staff ID has been switched off. Speak to your terminal manager.');
  if (c.pin_hash) fail(409, 'Already activated. Sign in with your PIN, or ask your manager for a reset.');
  if (c.failed_logins >= 5) fail(429, 'Too many wrong codes. Ask your manager for a new code.');
  if (!c.activation_code || String(req.body.code || '').trim() !== c.activation_code) {
    await run('UPDATE crew SET failed_logins = failed_logins + 1 WHERE id = ?', c.id);
    return bad();
  }
  if (c.activation_expires < Date.now()) fail(410, 'This code has expired. Ask your manager for a new one.');
  const pin = validPin(req.body.pin);
  await run("UPDATE crew SET pin_hash = ?, activation_code = NULL, activation_expires = NULL, failed_logins = 0, activated_at = datetime('now') WHERE id = ?", hashPin(pin), c.id);
  audit(`crew:${c.id}`, 'crew.activate', { staffId: c.staff_id });
  return crewSession(c);
}));

app.post('/api/crew/pin', h(async (req) => {
  const c = await crew(req);
  const full = await one<any>('SELECT pin_hash FROM crew WHERE id = ?', c.id);
  if (!checkPin(String(req.body.current || ''), full.pin_hash)) fail(400, 'Your current PIN is not right');
  await run('UPDATE crew SET pin_hash = ? WHERE id = ?', hashPin(validPin(req.body.pin)), c.id);
  audit(`crew:${c.id}`, 'crew.change_pin');
}));

// Digital staff ID card with a signed QR.
app.get('/api/crew/card', h(async (req) => {
  const c = await crew(req);
  const full = await one<any>('SELECT c.*, t.city, t.name AS terminal FROM crew c LEFT JOIN terminals t ON t.id = c.terminal_id WHERE c.id = ?', c.id);
  return {
    staffId: full.staff_id, name: full.name, role: full.role, phone: full.phone,
    terminal: full.city ? `${full.city}${full.terminal !== 'VIP station' ? ', ' + full.terminal : ''}` : '',
    issuedAt: full.issued_at, activatedAt: full.activated_at,
    qr: signStaff({ s: full.staff_id, n: full.name, r: full.role, t: Date.now() }),
  };
}));

// Anyone can check a staff badge QR (e.g. a passenger unsure about a conductor). Shows only what is on the card.
app.post('/api/verify-staff', h(async (req) => {
  const claims = readStaff(req.body.qr);
  if (!claims) return { valid: false, reason: 'Not a genuine VIP staff badge' };
  const c = await one<any>('SELECT staff_id, name, role, active FROM crew WHERE staff_id = ?', claims.s);
  if (!c) return { valid: false, reason: 'Staff ID not found' };
  if (!c.active) return { valid: false, reason: 'This Staff ID has been switched off', staffId: c.staff_id };
  return { valid: true, staffId: c.staff_id, name: c.name, role: c.role };
}));

app.get('/api/track/:token', h(async (req) => {
  const s = (await one<any>('SELECT * FROM share_links WHERE token = ?', req.params.token)) ?? fail(404, 'This tracking link is not valid');
  const t = (await tripView(s.trip_id))!;
  const tk = await one<any>('SELECT name FROM tickets WHERE id = ?', s.ticket_id);
  const first = String(tk?.name || 'Your traveller').split(' ')[0];
  if (t.status === 'arrived') return { traveller: first, status: 'arrived', arrivedAt: t.arrivedAt, route: { label: t.route.label, to: t.route.to } };
  return { traveller: first, ...t, conductor: undefined, driver: undefined, conductorId: undefined, driverId: undefined };
}));

// ---------------------------------------------------------------- passenger
app.get('/api/me', h(async (req) => {
  const p = await passenger(req);
  return { ...p, contacts: await all('SELECT id, name, phone FROM emergency_contacts WHERE passenger_id = ? ORDER BY id', p.id) };
}));
app.put('/api/me', h(async (req) => {
  const p = await passenger(req);
  await run('UPDATE passengers SET name = ? WHERE id = ?', String(req.body.name || '').trim().slice(0, 60), p.id);
}));
app.post('/api/me/contacts', h(async (req) => {
  const p = await passenger(req);
  const phone = normPhone(req.body.phone) ?? fail(400, 'Enter a Ghana phone number');
  const name = String(req.body.name || '').trim().slice(0, 60) || fail(400, 'Add a name');
  const n = (await one<{ n: number }>('SELECT COUNT(*) AS n FROM emergency_contacts WHERE passenger_id = ?', p.id))!.n;
  if (n >= 3) fail(400, 'Up to 3 contacts');
  await run('INSERT INTO emergency_contacts (passenger_id, name, phone) VALUES (?, ?, ?)', p.id, name, phone);
}));
app.delete('/api/me/contacts/:id', h(async (req) => {
  const p = await passenger(req);
  await run('DELETE FROM emergency_contacts WHERE id = ? AND passenger_id = ?', int(req.params.id), p.id);
}));

async function seatsTaken(routeId: number, date: string) {
  const sold = (await one<{ n: number }>("SELECT COUNT(*) AS n FROM tickets WHERE route_id = ? AND travel_date = ? AND status NOT IN ('cancelled','credited')", routeId, date))!.n;
  const held = (await one<{ n: number }>("SELECT COALESCE(SUM(qty),0) AS n FROM bookings WHERE route_id = ? AND travel_date = ? AND status = 'pending' AND created_at > ?", routeId, date, Date.now() - HOLD_MS))!.n;
  return sold + held;
}

app.post('/api/bookings', h(async (req) => {
  const p = await passenger(req);
  const route = routeInfo(int(req.body.routeId)) ?? fail(404, 'Route not found');
  const date = validDate(req.body.date);
  if (date < todayGh()) fail(400, 'Pick today or a later date');
  const names: string[] = (Array.isArray(req.body.names) ? req.body.names : []).map((n: unknown) => String(n || '').trim().slice(0, 60));
  if (!names.length || names.length > 6 || names.some((n) => !n)) fail(400, 'Add a name for each passenger (up to 6)');
  if ((await seatsTaken(route.id, date)) + names.length > route.dailyCap) fail(409, 'Online tickets for that day are sold out. Try another date.');

  const total = route.fare * names.length;
  const creditUsed = req.body.useCredit ? Math.min(p.credit, total) : 0;
  const amount = total - creditUsed;
  const clientRef = 'HOP' + Date.now().toString(36).toUpperCase() + token(3).toUpperCase();
  const id = await insert(`INSERT INTO bookings (passenger_id, route_id, travel_date, qty, amount, credit_used, status, client_ref, names, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`, p.id, route.id, date, names.length, amount, creditUsed, clientRef, JSON.stringify(names), Date.now());

  if (amount === 0) {
    await confirmPayment(id, { txnId: 'credit-' + clientRef, amount: 0, method: 'travel credit', raw: null });
    return { bookingId: id, paid: true };
  }
  const co = await hubtel.createCheckout({ clientRef, amount, description: `VIP ${route.label} x${names.length} on ${date}`, bookingId: id });
  return { bookingId: id, checkoutUrl: co.checkoutUrl };
}));

app.get('/api/bookings/:id', h(async (req) => {
  const p = await passenger(req);
  const b = (await one<any>('SELECT * FROM bookings WHERE id = ? AND passenger_id = ?', int(req.params.id), p.id)) ?? fail(404, 'Booking not found');
  const r = routeInfo(b.route_id)!;
  return {
    id: b.id, status: b.status, amount: b.amount, creditUsed: b.credit_used, qty: b.qty, date: b.travel_date,
    route: r.label, names: JSON.parse(b.names), expiresAt: b.created_at + HOLD_MS, phone: p.phone,
    tickets: await all('SELECT id, code FROM tickets WHERE booking_id = ?', b.id),
  };
}));

/** Issue tickets once per booking. Keyed on the payment's transaction ID so repeat callbacks do nothing. */
async function confirmPayment(bookingId: number, pay: { txnId: string; amount: number; method: string; raw: unknown }) {
  const issued = await tx(async () => {
    const b = await one<any>('SELECT * FROM bookings WHERE id = ? FOR UPDATE', bookingId);
    if (!b || b.status === 'paid') return null;
    if (await one('SELECT 1 FROM payments WHERE txn_id = ?', pay.txnId)) return null;
    await run('INSERT INTO payments (booking_id, txn_id, amount, method, status, raw) VALUES (?, ?, ?, ?, ?, ?)',
      bookingId, pay.txnId, pay.amount, pay.method, 'paid', JSON.stringify(pay.raw ?? null));
    await run("UPDATE bookings SET status = 'paid' WHERE id = ?", bookingId);
    if (b.credit_used) await run('UPDATE passengers SET credit = GREATEST(0, credit - ?) WHERE id = ?', b.credit_used, b.passenger_id);
    const route = routeInfo(b.route_id)!;
    const codes: string[] = [];
    for (const name of JSON.parse(b.names) as string[]) {
      const code = ticketCode();
      const qr = signTicket({ c: code, r: b.route_id, d: b.travel_date, n: name });
      await run(`INSERT INTO tickets (code, booking_id, passenger_id, route_id, travel_date, name, price, status, qr)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'paid', ?)`, code, bookingId, b.passenger_id, b.route_id, b.travel_date, name, route.fare, qr);
      codes.push(code);
    }
    const phone = (await one<any>('SELECT phone FROM passengers WHERE id = ?', b.passenger_id)).phone;
    return { phone, codes, route, b };
  });
  if (issued) {
    sendSms(issued.phone, `VIP HopOn: ${issued.codes.length} ticket(s) ${issued.route.label}, ${issued.b.travel_date}. Code(s): ${issued.codes.join(', ')}. Valid on any VIP bus that day. ${PUBLIC_URL}/tickets`);
    pushBoard(issued.b.route_id);
  }
  return issued;
}

// Test-mode checkout: the passenger approves the "MoMo prompt" on our own page.
app.post('/api/hubtel/mock/pay', h(async (req) => {
  if (hubtel.MODE !== 'mock') fail(404, 'Not found');
  const p = await passenger(req);
  const b = (await one<any>('SELECT * FROM bookings WHERE id = ? AND passenger_id = ?', int(req.body.bookingId), p.id)) ?? fail(404, 'Booking not found');
  if (b.status === 'expired') fail(410, 'This booking expired after 15 minutes. Please book again.');
  if (req.body.outcome === 'decline') fail(402, 'Payment was declined on the phone. Try again.');
  const method = ['mtn', 'telecel', 'airteltigo', 'card'].includes(req.body.method) ? req.body.method : 'mtn';
  const st = await hubtel.verifyPayment(b.client_ref, { txnId: 'MOCK' + b.client_ref, amount: b.amount, method });
  await confirmPayment(b.id, st);
  return { ok: true };
}));

// Live Hubtel webhook. We read only the client reference and re-check the status with Hubtel.
app.post('/api/hubtel/callback', h(async (req) => {
  const ref = req.body?.Data?.ClientReference || req.body?.clientReference;
  const b = ref && (await one<any>('SELECT * FROM bookings WHERE client_ref = ?', ref));
  if (!b) return { ok: true };
  const st = await hubtel.verifyPayment(ref);
  if (st.paid && st.amount >= b.amount) await confirmPayment(b.id, st);
  return { ok: true };
}));

async function ticketView(t: any) {
  const route = routeInfo(t.route_id)!;
  const boarding = await one<any>(`SELECT bo.trip_id, bo.created_at FROM boardings bo WHERE bo.ticket_id = ? ORDER BY bo.id DESC LIMIT 1`, t.id);
  const trip = boarding ? await tripView(boarding.trip_id) : null;
  return {
    id: t.id, code: t.code, name: t.name, status: t.status, date: t.travel_date, price: t.price, qr: t.qr,
    dateChanges: t.date_changes, checkedInAt: t.checked_in_at,
    route: { id: route.id, label: route.label, from: route.from, to: route.to },
    trip: trip ? { id: trip.id, status: trip.status, bus: trip.bus, etaMin: trip.etaMin, boardedAt: boarding.created_at } : null,
  };
}
const myTicket = async (req: Request) => {
  const p = await passenger(req);
  const t = (await one<any>('SELECT * FROM tickets WHERE id = ? AND passenger_id = ?', int(req.params.id), p.id)) ?? fail(404, 'Ticket not found');
  return { p, t };
};

app.get('/api/tickets', h(async (req) => {
  const p = await passenger(req);
  const rows = await all('SELECT * FROM tickets WHERE passenger_id = ? ORDER BY travel_date DESC, id DESC', p.id);
  return Promise.all(rows.map(ticketView));
}));
app.get('/api/tickets/:id', h(async (req) => ticketView((await myTicket(req)).t)));

app.post('/api/tickets/:id/checkin', h(async (req) => {
  const { t } = await myTicket(req);
  if (t.status !== 'paid') fail(400, t.status === 'checked_in' ? 'You are already checked in' : 'This ticket cannot check in');
  if (t.travel_date !== todayGh()) fail(400, 'You can check in on your travel date');
  const r = routeInfo(t.route_id)!;
  const demo = TEST_MODE && req.body.demo === true;
  if (!demo) {
    const lat = Number(req.body.lat), lng = Number(req.body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) fail(400, 'Turn on location to check in');
    const m = distKm([lat, lng], [r.from.lat, r.from.lng]) * 1000;
    if (m > r.from.radius) fail(400, `You look ${(m / 1000).toFixed(1)} km from ${r.from.name}. Check in when you reach the terminal, or ask the conductor to scan you.`);
  }
  await run("UPDATE tickets SET status = 'checked_in', checked_in_at = datetime('now') WHERE id = ?", t.id);
  pushBoard(t.route_id);
  return ticketView(await one('SELECT * FROM tickets WHERE id = ?', t.id));
}));

app.post('/api/tickets/:id/share', h(async (req) => {
  const { t } = await myTicket(req);
  const b = (await one<any>('SELECT trip_id FROM boardings WHERE ticket_id = ? ORDER BY id DESC LIMIT 1', t.id)) ?? fail(400, 'You can share once you have boarded a bus');
  let s = await one<any>('SELECT token FROM share_links WHERE ticket_id = ? AND trip_id = ?', t.id, b.trip_id);
  if (!s) { s = { token: token(18) }; await run('INSERT INTO share_links (token, trip_id, ticket_id, created_at) VALUES (?, ?, ?, ?)', s.token, b.trip_id, t.id, Date.now()); }
  return { url: `${PUBLIC_URL}/t/${s.token}`, token: s.token };
}));

app.post('/api/tickets/:id/change-date', h(async (req) => {
  const { t } = await myTicket(req);
  const date = validDate(req.body.date);
  if (!['paid', 'checked_in'].includes(t.status)) fail(400, 'This ticket can no longer be changed');
  if (t.travel_date < todayGh()) fail(400, 'This ticket has passed its travel date');
  if (date < todayGh() || date === t.travel_date) fail(400, 'Pick a different date from today on');
  const r = routeInfo(t.route_id)!;
  if ((await seatsTaken(r.id, date)) + 1 > r.dailyCap) fail(409, 'That day is sold out online');
  const fee = t.date_changes >= 1 ? 500 : 0;
  if (fee && hubtel.MODE !== 'mock') fail(501, 'Paid date changes need Hubtel live payments wired up');
  await tx(async () => {
    if (fee) await run('INSERT INTO payments (booking_id, txn_id, amount, method, status) VALUES (?, ?, ?, ?, ?)', t.booking_id, `FEE-${t.code}-${t.date_changes}`, fee, 'mock', 'paid');
    const qr = signTicket({ c: t.code, r: t.route_id, d: date, n: t.name });
    await run("UPDATE tickets SET travel_date = ?, qr = ?, status = 'paid', checked_in_at = NULL, date_changes = date_changes + 1 WHERE id = ?", date, qr, t.id);
  });
  audit(`passenger:${t.passenger_id}`, 'ticket.change_date', { ticket: t.code, from: t.travel_date, to: date, fee });
  return { fee, ticket: await ticketView(await one('SELECT * FROM tickets WHERE id = ?', t.id)) };
}));

app.post('/api/tickets/:id/cancel', h(async (req) => {
  const { p, t } = await myTicket(req);
  if (!['paid', 'checked_in'].includes(t.status)) fail(400, 'This ticket can no longer be cancelled');
  const before = t.travel_date > todayGh();
  // Policy (to be approved by VIP): before the travel date, refund minus 10%; on the day, travel credit.
  const amount = before ? Math.round(t.price * 0.9) : t.price;
  const kind = before ? 'wallet' : 'credit';
  await tx(async () => {
    await run(`UPDATE tickets SET status = ? WHERE id = ?`, before ? 'cancelled' : 'credited', t.id);
    await run('INSERT INTO refunds (ticket_id, amount, kind, reason) VALUES (?, ?, ?, ?)', t.id, amount, kind, before ? 'cancel_before_date' : 'cancel_on_day');
    if (!before) await run('UPDATE passengers SET credit = credit + ? WHERE id = ?', amount, p.id);
  });
  sendSms(p.phone, before
    ? `VIP HopOn: ticket ${t.code} cancelled. ${cedis(amount)} is on its way back to your wallet or card.`
    : `VIP HopOn: ticket ${t.code} turned into ${cedis(amount)} travel credit, valid 30 days.`);
  audit(`passenger:${p.id}`, 'ticket.cancel', { ticket: t.code, amount, kind });
  pushBoard(t.route_id);
  return { kind, amount };
}));

// ---------------------------------------------------------------- crew
async function activeTripFor(c: any) {
  return one<{ id: number }>("SELECT id FROM trips WHERE (conductor_id = ? OR driver_id = ?) AND status != 'arrived' ORDER BY id DESC LIMIT 1", c.id, c.id);
}
app.get('/api/crew/me', h(async (req) => {
  const c = await crew(req);
  const t = await activeTripFor(c);
  return { crew: c, trip: t ? await tripView(t.id) : null };
}));

app.get('/api/crew/options', h(async (req) => {
  await crew(req, 'conductor', 'manager', 'admin');
  return {
    routes: [...routeCache.values()].filter((v) => v.active).sort((a, b) => a.id - b.id).map((v) => ({ id: v.id, label: v.label })),
    buses: await all("SELECT id, number, plate, seats FROM buses WHERE id NOT IN (SELECT bus_id FROM trips WHERE status != 'arrived') ORDER BY length(number), number"),
    drivers: await all("SELECT id, name FROM crew WHERE role = 'driver' AND active = 1 AND pin_hash IS NOT NULL AND id NOT IN (SELECT driver_id FROM trips WHERE status != 'arrived') ORDER BY name"),
  };
}));

/**
 * The trip's path from where the bus phone really is to the route's destination.
 * Joins the phone's position to the nearest point of the route's road path and follows the road from there.
 * Works offline and sends the phone's location to no outside service.
 */
function pathFromPhone(route: RouteInfo, lat: number, lng: number) {
  const here: [number, number] = [lat, lng];
  const p = route.path;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < p.length; i++) { const d = distKm(here, p[i]); if (d < bestD) { bestD = d; best = i; } }
  const rest = p.slice(best);
  const path: [number, number][] = bestD < 0.3 ? [here, ...rest.slice(1)] : [here, ...rest];
  if (path.length < 2) path.push(p[p.length - 1]);
  return { path, km: pathLengthKm(path) };
}
const validLatLng = (b: any) => {
  const lat = Number(b?.lat), lng = Number(b?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
};
async function useLocationForTrip(tripId: number, route: RouteInfo, at: { lat: number; lng: number }) {
  const { path, km } = pathFromPhone(route, at.lat, at.lng);
  await run('UPDATE trips SET path = ?, path_km = ?, start_lat = ?, start_lng = ?, lat = ?, lng = ?, progress = 0 WHERE id = ?',
    JSON.stringify(path), km, at.lat, at.lng, at.lat, at.lng, tripId);
}

app.post('/api/crew/trips', h(async (req) => {
  const c = await crew(req, 'conductor');
  if (await activeTripFor(c)) fail(409, 'Finish your current trip first');
  const busId = int(req.body.busId), routeId = int(req.body.routeId), driverId = int(req.body.driverId);
  const bus = (await one<any>('SELECT * FROM buses WHERE id = ?', busId)) ?? fail(400, 'Pick a bus');
  if (await one("SELECT 1 FROM trips WHERE bus_id = ? AND status != 'arrived'", busId)) fail(409, 'That bus is already on a trip');
  if (!(await one("SELECT 1 FROM crew WHERE id = ? AND role = 'driver'", driverId))) fail(400, 'Pick a driver');
  const route = routeInfo(routeId) ?? fail(400, 'Pick a route');
  // Seats this trip sells: the crew can type fewer than the bus has (even 1). The bus leaves when they fill.
  const capacity = req.body.seats == null || req.body.seats === '' ? bus.seats : int(req.body.seats);
  if (capacity < 1 || capacity > bus.seats) fail(400, `Seats must be between 1 and ${bus.seats} for Bus ${bus.number}`);
  const id = await insert("INSERT INTO trips (bus_id, route_id, conductor_id, driver_id, status, lat, lng, capacity) VALUES (?, ?, ?, ?, 'loading', ?, ?, ?)",
    busId, routeId, c.id, driverId, route.from.lat, route.from.lng, capacity);
  const at = validLatLng(req.body);
  if (at) await useLocationForTrip(id, route, at);
  audit(`crew:${c.id}`, 'trip.open', { trip: id, busId, routeId, driverId, capacity, fromPhone: !!at });
  pushBoard(routeId);
  return tripView(id);
}));

async function crewTrip(req: Request, c: any): Promise<TripView> {
  const t = (await tripView(int(req.params.id))) ?? fail(404, 'Trip not found');
  if (!['manager', 'admin'].includes(c.role) && t.conductorId !== c.id && t.driverId !== c.id) fail(403, 'Not your trip');
  return t;
}

app.get('/api/crew/trips/:id', h(async (req) => {
  const c = await crew(req);
  const t = await crewTrip(req, c);
  const boarded = await all(`SELECT bo.id, bo.created_at, bo.offline, COALESCE(tk.name, w.name, 'Walk-in') AS name, tk.code,
      CASE WHEN bo.ticket_id IS NOT NULL THEN 'app' ELSE w.method END AS kind
      FROM boardings bo LEFT JOIN tickets tk ON tk.id = bo.ticket_id LEFT JOIN walkins w ON w.id = bo.walkin_id
      WHERE bo.trip_id = ? ORDER BY bo.id DESC`, t.id);
  const queue = await all("SELECT id, code, name, checked_in_at FROM tickets WHERE route_id = ? AND travel_date = ? AND status = 'checked_in' ORDER BY checked_in_at", t.route.id, todayGh());
  const cash = await one<any>("SELECT COALESCE(SUM(CASE WHEN method='cash' THEN amount END),0) AS cash, COALESCE(SUM(CASE WHEN method='momo' THEN amount END),0) AS momo FROM walkins WHERE trip_id = ?", t.id);
  return { ...t, boarded, queue, walkinTotals: cash };
}));

// Tickets valid for this trip's route today, so the scanner can work without signal.
app.get('/api/crew/trips/:id/tickets', h(async (req) => {
  const c = await crew(req);
  const t = await crewTrip(req, c);
  return all("SELECT code, name, status FROM tickets WHERE route_id = ? AND travel_date = ? AND status IN ('paid','checked_in','boarded')", t.route.id, todayGh());
}));

type ScanResult = { tone: 'ok' | 'bad' | 'warn'; title: string; sub: string; name?: string; route?: string; help: string };
app.post('/api/crew/scan', h(async (req): Promise<ScanResult> => {
  const c = await crew(req, 'conductor');
  const trip = (await tripView(int(req.body.tripId))) ?? fail(404, 'Trip not found');
  if (trip.conductorId !== c.id) fail(403, 'Not your trip');
  const raw = String(req.body.qr || '').trim();
  const offline = !!req.body.offline;

  let code: string | null = null;
  let qrName: string | null = null; // the passenger name signed into the QR
  if (raw.startsWith('HOP1.')) {
    const claims = readTicket(raw);
    if (!claims) return { tone: 'bad', title: 'Fake or damaged QR', sub: 'The ticket signature does not match', help: 'Do not board on this code. Ask for the SMS ticket code or offer a walk-in ticket.' };
    code = claims.c;
    qrName = claims.n;
  } else if (/^VIP-?[A-Z0-9]{6}$/i.test(raw)) {
    code = raw.toUpperCase().replace(/^VIP-?/, 'VIP-');
  } else {
    return { tone: 'bad', title: 'Not a VIP ticket', sub: 'This code is not a HopOn ticket', help: 'Ask the passenger to open the ticket in the app or read out the code from the SMS.' };
  }

  let boarded = false;
  const result = await tx(async (): Promise<ScanResult> => {
    const t = (await one<any>('SELECT * FROM tickets WHERE code = ? FOR UPDATE', code)) ?? fail(404, 'Ticket not found');
    const r = routeInfo(t.route_id)!;
    const base = { name: t.name, route: r.label };
    if (qrName != null && qrName !== t.name) return { ...base, tone: 'bad', title: 'Name does not match', sub: `QR says ${qrName}`, help: 'This QR was not issued for this ticket. Do not board on it; ask for the SMS ticket code.' };
    if (['cancelled', 'credited'].includes(t.status)) return { ...base, tone: 'bad', title: 'Ticket cancelled', sub: 'Refunded or turned into credit', help: 'Do not board on this ticket. Offer a walk-in ticket.' };
    if (['boarded', 'completed'].includes(t.status)) {
      const prev = await one<any>(`SELECT b.number, bo.created_at, bo.trip_id FROM boardings bo JOIN trips tr ON tr.id = bo.trip_id JOIN buses b ON b.id = tr.bus_id WHERE bo.ticket_id = ? ORDER BY bo.id DESC LIMIT 1`, t.id);
      if (prev && prev.trip_id === trip.id) return { ...base, tone: 'ok', title: 'Already on this bus', sub: 'Scanned earlier for this trip', help: 'No change to the seat count.' };
      if (offline && prev) await run('INSERT INTO flags (kind, detail) VALUES (?, ?)', 'double_scan', JSON.stringify({ ticket: t.code, firstTrip: prev.trip_id, secondTrip: trip.id, conductor: c.name }));
      const at = prev ? new Date(prev.created_at.replace(' ', 'T') + 'Z').toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) : '';
      return { ...base, tone: 'bad', title: 'Already used', sub: prev ? `Scanned on Bus ${prev.number} at ${at}` : 'This ticket was used', help: 'Do not board on this ticket. Offer a walk-in ticket, or call support if the passenger disagrees.' };
    }
    if (t.route_id !== trip.route.id) return { ...base, tone: 'warn', title: 'Wrong route', sub: `Ticket is for ${r.label}`, help: `Send the passenger to the ${r.to.city} bay. The ticket is still valid and unused.` };
    if (t.travel_date !== todayGh()) return { ...base, route: t.travel_date, tone: 'warn', title: 'Wrong date', sub: `Ticket is for ${t.travel_date}`, help: 'The passenger can change the date in the app. Not valid today.' };
    if (trip.status !== 'loading') return { ...base, tone: 'warn', title: 'Boarding is closed', sub: 'Reopen boarding to add passengers', help: 'The ticket is still valid for the next bus.' };
    const seats = await tripSeats(trip.id);
    if (seats.filled >= trip.bus.seats) return { ...base, tone: 'warn', title: 'Bus is full', sub: `${trip.bus.seats} of ${trip.bus.seats} seats`, help: 'Board this passenger on the next bus. The ticket stays valid.' };
    if (seats.app >= trip.route.appShare) return { ...base, tone: 'warn', title: 'App seats used up', sub: `${seats.app} of ${trip.route.appShare} app seats filled`, help: 'The rest of this bus is kept for walk-ins. Board them first on the next bus.' };
    const priority = t.status === 'checked_in';
    await run('INSERT INTO boardings (trip_id, ticket_id, conductor_id, offline) VALUES (?, ?, ?, ?)', trip.id, t.id, c.id, offline ? 1 : 0);
    await run("UPDATE tickets SET status = 'boarded' WHERE id = ?", t.id);
    boarded = true;
    return { ...base, tone: 'ok', title: 'Let them board', sub: priority ? 'Checked in, priority boarding' : 'Valid today', help: `Check the passenger is ${t.name}. Seat count goes up by one; this ticket cannot be scanned again.` };
  });
  if (boarded) { pushBoard(trip.route.id); pushTrip(trip.id); }
  return result;
}));

app.post('/api/crew/walkin', h(async (req) => {
  const c = await crew(req, 'conductor');
  const trip = (await tripView(int(req.body.tripId))) ?? fail(404, 'Trip not found');
  if (trip.conductorId !== c.id) fail(403, 'Not your trip');
  if (trip.status !== 'loading') fail(400, 'Boarding is closed');
  const qty = Math.max(1, Math.min(10, Number(req.body.qty) || 1));
  const method = req.body.method === 'momo' ? 'momo' : 'cash';
  const phone = method === 'momo' ? (normPhone(req.body.phone) ?? fail(400, 'Enter the passenger MoMo number')) : null;
  await tx(async () => {
    await one('SELECT id FROM trips WHERE id = ? FOR UPDATE', trip.id); // one sale at a time per bus
    if ((await tripSeats(trip.id)).filled + qty > trip.bus.seats) fail(409, 'Not enough seats left on this bus');
    for (let i = 0; i < qty; i++) {
      const w = await insert('INSERT INTO walkins (trip_id, name, amount, method, conductor_id) VALUES (?, ?, ?, ?, ?)',
        trip.id, String(req.body.name || '').trim().slice(0, 60) || null, trip.route.fare, method, c.id);
      await run('INSERT INTO boardings (trip_id, walkin_id, conductor_id) VALUES (?, ?, ?)', trip.id, w, c.id);
    }
  });
  // MVP: the MoMo prompt is simulated as approved. Live mode would wait for Hubtel's callback.
  if (phone) sendSms(phone, `VIP HopOn: ${cedis(trip.route.fare * qty)} paid for ${qty} seat(s) on Bus ${trip.bus.number}, ${trip.route.label}. Safe journey.`);
  pushBoard(trip.route.id); pushTrip(trip.id);
  return { ok: true, amount: trip.route.fare * qty };
}));

async function setStatus(req: Request, roles: string[], from: string[], to: string, extra = '') {
  const c = await crew(req, ...roles);
  const t = await crewTrip(req, c);
  if (!from.includes(t.status)) fail(400, `Trip is ${t.status}`);
  await run(`UPDATE trips SET status = ?${extra} WHERE id = ?`, to, t.id);
  audit(`crew:${c.id}`, `trip.${to}`, { trip: t.id });
  pushBoard(t.route.id); pushTrip(t.id);
  return { c, t };
}
app.post('/api/crew/trips/:id/close', h(async (req) => { await setStatus(req, ['conductor'], ['loading'], 'closed'); return tripView(int(req.params.id)); }));
app.post('/api/crew/trips/:id/reopen', h(async (req) => { await setStatus(req, ['conductor'], ['closed'], 'loading'); return tripView(int(req.params.id)); }));

app.post('/api/crew/trips/:id/start', h(async (req) => {
  // Start from wherever the bus phone is right now, so the map follows the real bus.
  const at = validLatLng(req.body);
  if (at) {
    const pre = await crewTrip(req, await crew(req, 'driver', 'conductor'));
    if (['loading', 'closed'].includes(pre.status)) await useLocationForTrip(pre.id, routeInfo(pre.route.id)!, at);
  }
  const { t } = await setStatus(req, ['driver', 'conductor'], ['loading', 'closed'], 'departed', ", departed_at = datetime('now')");
  // Tell each passenger's emergency contacts the bus has left, with a tracking link.
  const rows = await all<any>(`SELECT tk.id, tk.name, tk.passenger_id FROM boardings bo JOIN tickets tk ON tk.id = bo.ticket_id WHERE bo.trip_id = ?`, t.id);
  for (const r of rows) {
    const contacts = await all<any>('SELECT phone FROM emergency_contacts WHERE passenger_id = ?', r.passenger_id);
    if (!contacts.length) continue;
    let s = await one<any>('SELECT token FROM share_links WHERE ticket_id = ? AND trip_id = ?', r.id, t.id);
    if (!s) { s = { token: token(18) }; await run('INSERT INTO share_links (token, trip_id, ticket_id, created_at) VALUES (?, ?, ?, ?)', s.token, t.id, r.id, Date.now()); }
    for (const ct of contacts) sendSms(ct.phone, `${r.name} has left ${t.route.from.city} on VIP Bus ${t.bus.number}. Follow the trip live: ${PUBLIC_URL}/t/${s.token}`);
  }
  return tripView(t.id);
}));

app.post('/api/crew/trips/:id/end', h(async (req) => {
  stopSim(int(req.params.id));
  const { t } = await setStatus(req, ['driver', 'conductor'], ['departed'], 'arrived', ", arrived_at = datetime('now'), progress = 1");
  const end = t.route.path[t.route.path.length - 1];
  await run('UPDATE trips SET lat = ?, lng = ? WHERE id = ?', end[0], end[1], t.id);
  const rows = await all<any>(`SELECT tk.id, tk.name, p.id AS pid, p.phone FROM boardings bo JOIN tickets tk ON tk.id = bo.ticket_id JOIN passengers p ON p.id = tk.passenger_id WHERE bo.trip_id = ?`, t.id);
  for (const r of rows) {
    await run("UPDATE tickets SET status = 'completed' WHERE id = ?", r.id);
    sendSms(r.phone, `VIP HopOn: Bus ${t.bus.number} has arrived at ${t.route.to.city} ${t.route.to.name}. Thank you for travelling with VIP.`);
    for (const ct of await all<any>('SELECT phone FROM emergency_contacts WHERE passenger_id = ?', r.pid))
      sendSms(ct.phone, `${r.name} has arrived safely at ${t.route.to.city} ${t.route.to.name} on VIP Bus ${t.bus.number}.`);
  }
  pushTrip(t.id);
  return tripView(t.id);
}));

async function recordLocation(tripId: number, lat: number, lng: number, speed: number | null) {
  const t = await tripView(tripId);
  if (!t || t.status !== 'departed') return;
  const progress = Math.max(t.progress, progressOf(t.route.path, [lat, lng]));
  await run('UPDATE trips SET lat = ?, lng = ?, speed = ?, progress = ?, loc_at = ? WHERE id = ?', lat, lng, speed, progress, Date.now(), tripId);
  await run('INSERT INTO locations (trip_id, lat, lng, speed, at) VALUES (?, ?, ?, ?, ?)', tripId, lat, lng, speed, Date.now());
  pushTrip(tripId);
}

app.post('/api/crew/trips/:id/location', h(async (req) => {
  const c = await crew(req, 'driver', 'conductor');
  const t = await crewTrip(req, c);
  const pts = Array.isArray(req.body.points) ? req.body.points : [req.body];
  for (const p of pts.slice(-50)) {
    const lat = Number(p.lat), lng = Number(p.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) await recordLocation(t.id, lat, lng, p.speed != null ? Number(p.speed) : null);
  }
}));

// Demo drive: moves the bus along the route so tracking can be shown without travelling.
const sims = new Map<number, ReturnType<typeof setInterval>>();
function stopSim(id: number) { const s = sims.get(id); if (s) { clearInterval(s); sims.delete(id); } }
app.post('/api/crew/trips/:id/simulate', h(async (req) => {
  const c = await crew(req, 'driver', 'conductor');
  const t = await crewTrip(req, c);
  stopSim(t.id);
  if (!req.body.on) return { simulating: false };
  if (!TEST_MODE) fail(403, 'Demo drive is switched off on this server');
  if (t.status !== 'departed') fail(400, 'Start the trip first');
  let f = t.progress;
  sims.set(t.id, setInterval(() => {
    f = Math.min(1, f + 1 / 120); // about 4 minutes end to end
    const [lat, lng] = pointAlong(t.route.path, f);
    recordLocation(t.id, lat, lng, 78 + Math.round(Math.random() * 10)).catch((e) => console.error('[sim]', e?.message || e));
    if (f >= 1) stopSim(t.id);
  }, 2000));
  return { simulating: true };
}));
app.get('/api/crew/trips/:id/simulate', h(async (req) => { await crew(req); return { simulating: sims.has(int(req.params.id)) }; }));

// ---------------------------------------------------------------- operations
app.get('/api/ops/overview', h(async (req) => {
  await crew(req, 'manager', 'admin');
  const today = todayGh();
  const ids = await all<{ id: number }>("SELECT id FROM trips WHERE status != 'arrived' OR substr(arrived_at, 1, 10) = ? ORDER BY id DESC", today);
  const trips = (await Promise.all(ids.map((t) => tripView(t.id)))).filter(Boolean).map((t) => t!);
  const online = await one<any>("SELECT COUNT(*) AS n, COALESCE(SUM(p.amount),0) AS amount FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE substr(p.created_at, 1, 10) = ?", today);
  const tix = await one<any>("SELECT COUNT(*) AS n FROM tickets WHERE substr(created_at, 1, 10) = ?", today);
  const walk = await one<any>("SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN method='cash' THEN amount END),0) AS cash, COALESCE(SUM(CASE WHEN method='momo' THEN amount END),0) AS momo FROM walkins WHERE substr(created_at, 1, 10) = ?", today);
  const byConductor = await all(`SELECT c.name, COUNT(w.id) AS sales, COALESCE(SUM(CASE WHEN w.method='cash' THEN w.amount END),0) AS cash,
      COALESCE(SUM(CASE WHEN w.method='momo' THEN w.amount END),0) AS momo
      FROM crew c LEFT JOIN walkins w ON w.conductor_id = c.id AND substr(w.created_at, 1, 10) = ? WHERE c.role = 'conductor' GROUP BY c.id, c.name ORDER BY cash DESC`, today);
  const refunds = await one<any>("SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS amount FROM refunds WHERE substr(created_at, 1, 10) = ?", today);
  const sold = new Map((await all<any>(`SELECT route_id, COUNT(*) AS n FROM tickets WHERE travel_date = ? AND status NOT IN ('cancelled','credited') GROUP BY route_id`, today)).map((r) => [r.route_id, r.n]));
  const queued = new Map((await all<any>(`SELECT route_id, COUNT(*) AS n FROM tickets WHERE travel_date = ? AND status = 'checked_in' GROUP BY route_id`, today)).map((r) => [r.route_id, r.n]));
  const routes = [...routeCache.values()].sort((a, b) => a.id - b.id).map((v) => ({
    id: v.id, label: v.label, fare: v.fare, fareSource: v.fareSource, km: v.km, appShare: v.appShare, dailyCap: v.dailyCap,
    soldToday: sold.get(v.id) || 0, queue: queued.get(v.id) || 0,
  }));
  return {
    today, hubtelMode: hubtel.MODE, smsLive: SMS_LIVE,
    kpis: { ticketsOnline: tix.n, onlineAmount: online.amount, walkins: walk.n, walkinCash: walk.cash, walkinMomo: walk.momo, refunds: refunds.amount,
      loading: trips.filter((t) => t.status === 'loading' || t.status === 'closed').length, onRoad: trips.filter((t) => t.status === 'departed').length },
    trips, byConductor, routes,
    terminals: terminals.map((t) => ({ id: t.id, name: t.name, city: t.city, lat: t.lat, lng: t.lng })),
    sms: await all('SELECT to_phone, body, status, created_at FROM sms_outbox ORDER BY id DESC LIMIT 25'),
    flags: await all('SELECT kind, detail, created_at FROM flags ORDER BY id DESC LIMIT 20'),
  };
}));

// ---- Crew management (managers): issue Staff IDs, reset, switch off.
const issueCode = async (crewId: number, phone: string, staffId: string, name: string) => {
  const code = otpCode();
  await run('UPDATE crew SET activation_code = ?, activation_expires = ?, failed_logins = 0, locked_until = NULL WHERE id = ?', code, Date.now() + 7 * 86400000, crewId);
  sendSms(phone, `VIP HopOn Crew: hello ${name.split(' ')[0]}, your Staff ID is ${staffId}. Activation code ${code} (valid 7 days). Open ${PUBLIC_URL}/crew and tap "First time?".`);
  return code;
};

app.get('/api/ops/crew', h(async (req) => {
  await crew(req, 'manager', 'admin');
  return all(`SELECT id, staff_id AS "staffId", name, phone, role, active, issued_at AS "issuedAt", activated_at AS "activatedAt",
    CASE WHEN pin_hash IS NOT NULL THEN 'active' WHEN activation_expires < ? THEN 'expired' ELSE 'pending' END AS state
    FROM crew ORDER BY role, staff_id`, Date.now());
}));

app.post('/api/ops/crew', h(async (req) => {
  const m = await crew(req, 'manager', 'admin');
  const name = String(req.body.name || '').trim().slice(0, 60) || fail(400, 'Add the full name as on their VIP ID');
  const phone = normPhone(req.body.phone) ?? fail(400, 'Add a Ghana phone number');
  const role = ['conductor', 'driver', 'manager'].includes(req.body.role) ? req.body.role : fail(400, 'Pick a role');
  // A person who works as both conductor and driver gets two Staff IDs on the same phone.
  // Anything else sharing a number (two IDs with the same role, or a manager) is refused.
  const same = await all<any>('SELECT staff_id, name, role FROM crew WHERE phone = ?', phone);
  const dupe = same.find((c) => c.role === role);
  if (dupe) fail(409, `That phone number already has a ${role} Staff ID (${dupe.staff_id}, ${dupe.name})`);
  if (same.length && (role === 'manager' || same.some((c) => !['conductor', 'driver'].includes(c.role)))) {
    fail(409, `That phone number already has a Staff ID (${same[0].staff_id}, ${same[0].name}). Only a conductor and a driver ID can share one number.`);
  }
  const base = { conductor: 1000, driver: 2000, manager: 9000 }[role as 'conductor' | 'driver' | 'manager'];
  const n = (await one<{ n: number }>('SELECT COUNT(*) AS n FROM crew WHERE role = ?', role))!.n;
  let k = n + 1, staffId = staffIdFor(role, base + k);
  while (await one('SELECT 1 FROM crew WHERE staff_id = ?', staffId)) staffId = staffIdFor(role, base + ++k);
  const id = await insert('INSERT INTO crew (staff_id, name, phone, role, terminal_id, issued_by) VALUES (?, ?, ?, ?, ?, ?)', staffId, name, phone, role, m.terminal_id, m.id);
  const code = await issueCode(id, phone, staffId, name);
  audit(`crew:${m.id}`, 'crew.issue', { staffId, role });
  return { id, staffId, name, phone, role, code };
}));

app.post('/api/ops/crew/:id/reset', h(async (req) => {
  const m = await crew(req, 'manager', 'admin');
  const c = (await one<any>('SELECT * FROM crew WHERE id = ?', int(req.params.id))) ?? fail(404, 'Not found');
  if (c.id === m.id) fail(400, 'Ask another manager to reset your own Staff ID');
  await run('UPDATE crew SET pin_hash = NULL, activated_at = NULL WHERE id = ?', c.id);
  await run("DELETE FROM sessions WHERE kind = 'crew' AND user_id = ?", c.id);
  const code = await issueCode(c.id, c.phone, c.staff_id, c.name);
  audit(`crew:${m.id}`, 'crew.reset', { staffId: c.staff_id });
  return { staffId: c.staff_id, code };
}));

app.post('/api/ops/crew/:id/active', h(async (req) => {
  const m = await crew(req, 'manager', 'admin');
  const c = (await one<any>('SELECT * FROM crew WHERE id = ?', int(req.params.id))) ?? fail(404, 'Not found');
  if (c.id === m.id) fail(400, 'You cannot switch off your own Staff ID');
  const on = req.body.active ? 1 : 0;
  await run('UPDATE crew SET active = ? WHERE id = ?', on, c.id);
  if (!on) await run("DELETE FROM sessions WHERE kind = 'crew' AND user_id = ?", c.id);
  audit(`crew:${m.id}`, on ? 'crew.enable' : 'crew.disable', { staffId: c.staff_id });
}));

// ---- Fleet (managers): add buses. Each bus normally has its own VIP phone for boarding and tracking.
app.get('/api/ops/buses', h(async (req) => {
  await crew(req, 'manager', 'admin');
  return all(`SELECT b.id, b.number, b.plate, b.seats,
      (SELECT t.status FROM trips t WHERE t.bus_id = b.id AND t.status != 'arrived' ORDER BY t.id DESC LIMIT 1) AS status
    FROM buses b ORDER BY length(b.number), b.number`);
}));
app.post('/api/ops/buses', h(async (req) => {
  const m = await crew(req, 'manager', 'admin');
  const number = String(req.body.number || '').trim().replace(/^bus\s*/i, '').slice(0, 10) || fail(400, 'Add a fleet number, e.g. 31');
  const plate = String(req.body.plate || '').trim().toUpperCase().replace(/\s+/g, ' ').slice(0, 16);
  if (!/^[A-Z]{1,3} \d{1,4}-\d{2}$/.test(plate)) fail(400, 'Use a Ghana plate like GT 4412-21');
  const seats = int(req.body.seats);
  if (seats < 10 || seats > 70) fail(400, 'Seats should be between 10 and 70');
  if (await one('SELECT 1 FROM buses WHERE number = ? OR plate = ?', number, plate)) fail(409, 'That fleet number or plate is already in the fleet');
  const id = await insert('INSERT INTO buses (number, plate, seats) VALUES (?, ?, ?)', number, plate, seats);
  audit(`crew:${m.id}`, 'bus.add', { number, plate, seats });
  return { id, number, plate, seats };
}));

app.put('/api/ops/routes/:id', h(async (req) => {
  const c = await crew(req, 'manager', 'admin');
  const id = int(req.params.id);
  const fare = Math.round(Number(req.body.fare) * 100), share = int(req.body.appShare), cap = int(req.body.dailyCap);
  if (!(fare > 0) || share < 0 || share > 60 || cap < 0) fail(400, 'Check the numbers');
  const before = routeInfo(id) ?? fail(404, 'Route not found');
  await run('UPDATE routes SET fare = ?, app_share = ?, daily_cap = ? WHERE id = ?', fare, share, cap, id);
  await loadNetwork();
  audit(`crew:${c.id}`, 'route.update', { id, before: { fare: before.fare, appShare: before.appShare, dailyCap: before.dailyCap }, after: { fare, share, cap } });
  pushBoard(id);
}));

// ---------------------------------------------------------------- jobs
async function housekeeping() {
  // Release unpaid holds after 15 minutes.
  const r = await run("UPDATE bookings SET status = 'expired' WHERE status = 'pending' AND created_at < ?", Date.now() - HOLD_MS);
  if (r.changes) io.to('board').emit('board:update', {});
  // Unused tickets after their travel date become travel credit.
  for (const t of await all<any>("SELECT t.*, p.phone FROM tickets t JOIN passengers p ON p.id = t.passenger_id WHERE t.status IN ('paid','checked_in') AND t.travel_date < ?", todayGh())) {
    await tx(async () => {
      await run("UPDATE tickets SET status = 'credited' WHERE id = ?", t.id);
      await run('INSERT INTO refunds (ticket_id, amount, kind, reason) VALUES (?, ?, ?, ?)', t.id, t.price, 'credit', 'unused');
      await run('UPDATE passengers SET credit = credit + ? WHERE id = ?', t.price, t.passenger_id);
    });
    sendSms(t.phone, `VIP HopOn: ticket ${t.code} was not used, so ${cedis(t.price)} is now travel credit for 30 days.`);
  }
  // Old sessions (60 days) and detailed GPS points (90 days) are removed.
  await run('DELETE FROM sessions WHERE created_at < ?', Date.now() - 60 * 86400000);
  await run('DELETE FROM locations WHERE at < ?', Date.now() - 90 * 86400000);
}

// ---------------------------------------------------------------- errors and static
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Try again.' });
});

// When the built app is present (Render serving everything, or `npm start` locally) serve it too.
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist, { setHeaders: (res, p) => { if (p.endsWith('sw.js') || p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
  app.get('*', (_req, res) => res.sendFile(join(dist, 'index.html')));
}

// ---------------------------------------------------------------- start
async function main() {
  await initDb();
  const seeded = await seedIfEmpty();
  await initKeys();
  await loadNetwork();
  setInterval(() => { housekeeping().catch((e) => console.error('[jobs]', e?.message || e)); }, 60_000);
  server.listen(PORT, () => {
    console.log(`VIP HopOn API on http://localhost:${PORT} · database: ${DRIVER}${seeded ? ' (new, seeded)' : ''} · payments: ${hubtel.MODE} · SMS: ${SMS_LIVE ? process.env.SMS_PROVIDER : 'log only'} · login codes: ${OTP_MODE}${TEST_PHONES.size ? ` (${TEST_PHONES.size} testers)` : ''}${TEST_MODE ? ' · test mode' : ''}`);
  });
}
main().catch((e) => { console.error('Could not start:', e); process.exit(1); });
