// End-to-end trip through the HopOn API: book, pay, check in, scan, walk-in, depart, track, arrive.
// Runs a whole trip against a running server. Point it elsewhere with E2E_API=http://host:port/api
const B = process.env.E2E_API || 'http://localhost:4000/api';
let ok = 0, bad = 0;
const check = (cond, label, extra = '') => { cond ? ok++ : bad++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); };
async function call(path, { body, token, method } = {}) {
  const r = await fetch(B + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j, _arr: Array.isArray(j) ? j : undefined };
}
const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

// Passenger signs in
const phone = '0201112223';
const otp = await call('/auth/otp', { body: { phone } });
check(otp.devCode?.length === 6, 'OTP issued (test mode shows code)');
const wrong = await call('/auth/verify', { body: { phone, code: '000000' } });
check(wrong.status === 400, 'wrong code rejected');
const v = await call('/auth/verify', { body: { phone, code: otp.devCode, name: 'Kojo Test' } });
const P = v.token; check(!!P, 'passenger signed in');
await call('/me/contacts', { body: { name: 'Mum', phone: '0277000111' }, token: P });

// Book 2 open tickets for today and pay in test mode
const bk = await call('/bookings', { body: { routeId: 1, date: today, names: ['Kojo Test', 'Esi Test'] }, token: P });
check(bk.checkoutUrl === `/pay/${bk.bookingId}`, 'booking held, checkout opened');
const declined = await call('/hubtel/mock/pay', { body: { bookingId: bk.bookingId, outcome: 'decline' }, token: P });
check(declined.status === 402, 'declined payment issues nothing');
const paid = await call('/hubtel/mock/pay', { body: { bookingId: bk.bookingId, method: 'mtn' }, token: P });
check(paid.ok, 'payment approved');
const again = await call('/hubtel/mock/pay', { body: { bookingId: bk.bookingId, method: 'mtn' }, token: P });
const tickets = (await call('/tickets', { token: P }))._arr;
check(tickets.length === 2, 'exactly 2 tickets issued (repeat callback ignored)', `got ${tickets.length}`);
const [t1, t2] = tickets;
check(t1.qr.startsWith('HOP1.'), 'ticket has signed QR');

// Check in at the terminal (too far, then test-mode)
const far = await call(`/tickets/${t1.id}/checkin`, { body: { lat: 6.0, lng: -0.5 }, token: P });
check(far.status === 400, 'check-in refused far from terminal');
const near = await call(`/tickets/${t1.id}/checkin`, { body: { lat: 5.5702, lng: -0.2157 }, token: P });
check(near.status === 'checked_in', 'check-in accepted at Circle');

// Conductor opens boarding on Bus 14 with driver Kofi
const C = (await call('/crew/login', { body: { phone: '0244000001', pin: '1111' } })).token;
const D = (await call('/crew/login', { body: { phone: '0244000003', pin: '3333' } })).token;
check(!!C && !!D, 'conductor and driver signed in');
const badPin = await call('/crew/login', { body: { phone: '0244000001', pin: '0000' } });
check(badPin.status === 401, 'wrong crew PIN rejected');
const opts = await call('/crew/options', { token: C });
const bus = opts.buses.find((b) => b.number === '14') || opts.buses[0];
const driver = opts.drivers.find((d) => d.name === 'Kofi Boateng') || opts.drivers[0];
const trip = await call('/crew/trips', { body: { routeId: 1, busId: bus.id, driverId: driver.id }, token: C });
check(trip.status === 'loading', `trip ${trip.id} opened, Bus ${trip.bus?.number}`);
const board = await call('/board?route=1');
check(board.trips.some((t) => t.id === trip.id) && board.queue >= 1, 'passenger loading board shows the bus and the priority line');

// Scans
const s1 = await call('/crew/scan', { body: { tripId: trip.id, qr: t1.qr }, token: C });
check(s1.tone === 'ok' && /priority/i.test(s1.sub), 'QR scan: let them board (priority)', s1.title);
const s1b = await call('/crew/scan', { body: { tripId: trip.id, qr: t1.qr }, token: C });
check(s1b.tone === 'ok' && /Already on this bus/.test(s1b.title), 'same ticket again on same bus: no double count');
const s2 = await call('/crew/scan', { body: { tripId: trip.id, qr: t2.code }, token: C });
check(s2.tone === 'ok', 'typed SMS code works');
const forged = t1.qr.slice(0, -4) + (t1.qr.endsWith('AAAA') ? 'BBBB' : 'AAAA');
const s3 = await call('/crew/scan', { body: { tripId: trip.id, qr: forged }, token: C });
check(s3.tone === 'bad' && /Fake/.test(s3.title), 'forged QR rejected');
const s4 = await call('/crew/scan', { body: { tripId: trip.id, qr: 'hello' }, token: C });
check(s4.tone === 'bad', 'random code rejected');

// Wrong-date ticket
const bk2 = await call('/bookings', { body: { routeId: 1, date: tomorrow, names: ['Kojo Test'] }, token: P });
await call('/hubtel/mock/pay', { body: { bookingId: bk2.bookingId }, token: P });
const tmr = (await call('/tickets', { token: P }))._arr.find((t) => t.date === tomorrow);
const s5 = await call('/crew/scan', { body: { tripId: trip.id, qr: tmr.qr }, token: C });
check(s5.tone === 'warn' && /Wrong date/.test(s5.title), 'tomorrow\'s ticket: wrong date warning');

// Walk-ins
const w1 = await call('/crew/walkin', { body: { tripId: trip.id, qty: 3, method: 'cash' }, token: C });
const w2 = await call('/crew/walkin', { body: { tripId: trip.id, qty: 1, method: 'momo', phone: '0555123456' }, token: C });
check(w1.ok && w2.ok, 'walk-in cash x3 and MoMo x1 recorded');
const detail = await call(`/crew/trips/${trip.id}`, { token: C });
check(detail.filled === 6 && detail.appFilled === 2, 'seat count 6 (2 app + 4 walk-in)', `filled=${detail.filled} app=${detail.appFilled}`);
check(detail.walkinTotals.cash === 3 * detail.route.fare, 'cash total = 3 walk-in fares');

// Depart
const early = await call(`/crew/trips/${trip.id}/start`, { body: {}, token: P });
check(early.status === 401, 'a passenger cannot start a trip');
await call(`/crew/trips/${trip.id}/close`, { body: {}, token: C });
const late = await call('/crew/walkin', { body: { tripId: trip.id, qty: 1, method: 'cash' }, token: C });
check(late.status === 400, 'no sales after boarding closed');
const started = await call(`/crew/trips/${trip.id}/start`, { body: {}, token: D });
check(started.status === 'departed', 'driver started trip');

// Location + share link + tracking
await call(`/crew/trips/${trip.id}/location`, { body: { points: [{ lat: 5.8089, lng: -0.3503, speed: 82 }] }, token: D });
const share = await call(`/tickets/${t1.id}/share`, { body: {}, token: P });
check(/\/t\//.test(share.url), 'share link created');
const tr = await call(`/track/${share.token}`);
check(tr.status === 'departed' && tr.progress > 0 && tr.etaMin > 0 && !tr.driver, 'public tracking shows bus, progress and ETA, no crew names', `progress=${tr.progress?.toFixed(2)} eta=${tr.etaMin}m`);
const sim = await call(`/crew/trips/${trip.id}/simulate`, { body: { on: true }, token: D });
check(sim.simulating, 'demo drive started');
await new Promise((r) => setTimeout(r, 4500));
const tr2 = await call(`/track/${share.token}`);
check(tr2.progress > tr.progress, 'bus moved along the route', `progress=${tr2.progress.toFixed(3)}`);

// Ops dashboard
const M = (await call('/crew/login', { body: { phone: '0244000009', pin: '9999' } })).token;
const notOps = await call('/ops/overview', { token: C });
check(notOps.status === 403, 'conductor cannot open ops dashboard');
const ops = await call('/ops/overview', { token: M });
check(ops.kpis.onRoad >= 1 && ops.kpis.walkinCash >= 45000, 'ops shows bus on road and walk-in cash');
check(ops.sms.some((s) => /has left Accra/.test(s.body) && s.to_phone === '0277000111'), 'Mum got a "has left" SMS with tracking link');

// Arrive
const ended = await call(`/crew/trips/${trip.id}/end`, { body: {}, token: D });
check(ended.status === 'arrived', 'driver ended trip');
const tr3 = await call(`/track/${share.token}`);
check(tr3.status === 'arrived' && tr3.position === undefined, 'tracking link now shows arrived, no live position');
const ops2 = await call('/ops/overview', { token: M });
check(ops2.sms.some((s) => /arrived safely/.test(s.body) && s.to_phone === '0277000111'), 'Mum got "arrived safely" SMS');
const used = (await call('/tickets', { token: P }))._arr.find((t) => t.id === t1.id);
check(used.status === 'completed', 'ticket marked completed');

// Change date and cancel on the future ticket
const ch = await call(`/tickets/${tmr.id}/change-date`, { body: { date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10) }, token: P });
check(ch.fee === 0, 'first date change free');
const ch2 = await call(`/tickets/${tmr.id}/change-date`, { body: { date: tomorrow }, token: P });
check(ch2.fee === 500, 'second date change costs GH₵5');
const cancel = await call(`/tickets/${tmr.id}/cancel`, { body: {}, token: P });
check(cancel.kind === 'wallet' && cancel.amount === Math.round(tmr.price * 0.9), 'cancel before travel date: fare minus 10% back');

// Daily cap
await call(`/ops/routes/3`, { method: 'PUT', body: { fare: 100, appShare: 30, dailyCap: 0 }, token: M });
const capped = await call('/bookings', { body: { routeId: 3, date: today, names: ['X'] }, token: P });
check(capped.status === 409, 'daily online cap blocks sales');
await call(`/ops/routes/3`, { method: 'PUT', body: { fare: 100, appShare: 30, dailyCap: 300 }, token: M });

console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
