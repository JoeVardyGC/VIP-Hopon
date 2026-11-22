import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import { api, auth, live, cedis, store, todayIso, timeOf, prettyPhone, ApiError } from './api';
import { Icon, Logo, Sheet, Err, useAction, TripMap, useTestMode } from './ui';
import { PickerSheet } from './picker';
import { InstallCard } from './install';
import QRCode from 'qrcode';

type Crew = { id: number; name: string; role: 'conductor' | 'driver' | 'manager' | 'admin' };

export function CrewApp() {
  const [me, setMe] = useState<{ crew: Crew; trip: any } | null>(null);
  const [ready, setReady] = useState(false);
  const reload = useCallback(async () => {
    if (!auth.token('crew')) { setMe(null); setReady(true); return; }
    try { setMe(await api('/crew/me', { who: 'crew' })); } catch { setMe(null); }
    setReady(true);
  }, []);
  useEffect(() => { reload(); }, [reload]);
  const signOut = () => { auth.set('crew', null); setMe(null); };
  if (!ready) return <div className="app" />;
  return (
    <div className="app">
      {!me ? <CrewLogin onIn={reload} />
        : me.crew.role === 'conductor' ? <Conductor me={me.crew} trip={me.trip} reload={reload} signOut={signOut} />
        : me.crew.role === 'driver' ? <Driver me={me.crew} trip={me.trip} reload={reload} signOut={signOut} />
        : <div className="page"><div className="card pad stack"><b>Signed in as {me.crew.name} ({me.crew.role})</b><Link className="btn btn-g" to="/ops">Open the operations dashboard</Link><button className="btn btn-t" onClick={signOut}>Sign out</button></div></div>}
    </div>
  );
}

const ROLE_NAME: Record<string, string> = { conductor: 'Conductor', driver: 'Driver', manager: 'Terminal manager', admin: 'Admin' };

function CrewHeader({ me, signOut, sub }: { me: Crew; signOut: () => void; sub: string }) {
  const [card, setCard] = useState(false);
  return (
    <>
      <header style={{ background: 'var(--ink)', color: '#fff', padding: '14px 16px' }} className="between">
        <span className="row"><Logo size={28} /><span><b>HopOn Crew</b><br /><span style={{ fontSize: 13, color: '#D9CBCE' }}>{me.name} · {sub}</span></span></span>
        <span className="row" style={{ gap: 8 }}>
          <button className="icb" aria-label="My staff ID card" onClick={() => setCard(true)} style={{ color: '#fff', background: 'rgba(255,255,255,.12)' }}><Icon n="badge" size="s" /></button>
          <button className="icb" aria-label="Sign out" onClick={signOut} style={{ color: '#fff', background: 'rgba(255,255,255,.12)' }}><Icon n="logout" size="s" /></button>
        </span>
      </header>
      <div style={{ padding: '12px 16px 0' }}><InstallCard app="HopOn Crew" /></div>
      {card && <StaffCard onClose={() => setCard(false)} />}
    </>
  );
}

/** Digital staff ID with a signed QR and a live clock, so a screenshot is easy to spot. */
function StaffCard({ onClose }: { onClose: () => void }) {
  const [c, setC] = useState<any>(null);
  const [qr, setQr] = useState('');
  const [now, setNow] = useState(new Date());
  const [pinForm, setPinForm] = useState(false);
  const [p, setP] = useState({ current: '', pin: '' });
  const a = useAction();
  useEffect(() => { api('/crew/card', { who: 'crew' }).then(async (x) => { setC(x); setQr(await QRCode.toDataURL(x.qr, { margin: 0, width: 400, errorCorrectionLevel: 'M', color: { dark: '#1F1416', light: '#FFFFFF' } })); }).catch(a.setError); }, []);
  useEffect(() => { const i = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(i); }, []);
  return (
    <Sheet onClose={onClose} label="Staff ID card">
      <Err e={a.error} />
      {c && (
        <article className="staff-card" aria-label={`VIP staff ID for ${c.name}`}>
          <div className="staff-top">
            <span className="row" style={{ gap: 8 }}><Logo size={26} /><b>VIP Jeoun · HopOn Crew</b></span>
            <span className="live-badge"><i />{now.toLocaleTimeString('en-GB')}</span>
          </div>
          <div className="row" style={{ gap: 14, padding: '18px 18px 8px' }}>
            <span className="staff-ava">{c.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('')}</span>
            <div className="stack" style={{ gap: 2, minWidth: 0 }}>
              <b className="disp" style={{ fontSize: 24 }}>{c.name}</b>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--r7)' }}>{ROLE_NAME[c.role]}</span>
              <span className="lbl">{c.terminal}</span>
            </div>
          </div>
          <div className="row" style={{ gap: 16, padding: '8px 18px 18px', alignItems: 'flex-end' }}>
            <div className="stack" style={{ gap: 8, flex: 1 }}>
              <div><span className="lbl">Staff ID</span><br /><b style={{ fontSize: 20, letterSpacing: '.06em' }}>{c.staffId}</b></div>
              <div><span className="lbl">Activated</span><br /><b style={{ fontSize: 14 }}>{c.activatedAt ? new Date(c.activatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</b></div>
            </div>
            {qr && <img src={qr} alt="Staff badge QR. VIP staff can scan it to confirm this ID is genuine." width={112} height={112} style={{ imageRendering: 'pixelated' }} />}
          </div>
        </article>
      )}
      <p className="lbl" style={{ margin: 0 }}>Show this if a passenger or manager asks. The clock runs live, so a screenshot is easy to spot. Conductors can scan the QR to check it.</p>
      {!pinForm ? <button className="btn btn-o" onClick={() => setPinForm(true)}><Icon n="lock" size="s" />Change my PIN</button> : (
        <form className="stack" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); a.run(async () => { await api('/crew/pin', { body: p, who: 'crew' }); setPinForm(false); setP({ current: '', pin: '' }); }); }}>
          <input className="input" type="password" inputMode="numeric" maxLength={6} aria-label="Current PIN" placeholder="Current PIN" value={p.current} onChange={(e) => setP({ ...p, current: e.target.value.replace(/\D/g, '') })} />
          <input className="input" type="password" inputMode="numeric" maxLength={6} aria-label="New PIN" placeholder="New PIN (4 to 6 digits)" value={p.pin} onChange={(e) => setP({ ...p, pin: e.target.value.replace(/\D/g, '') })} />
          <button className="btn btn-g" disabled={a.busy}>Save new PIN</button>
        </form>
      )}
    </Sheet>
  );
}

function CrewLogin({ onIn }: { onIn: () => void }) {
  const [mode, setMode] = useState<'signin' | 'activate'>('signin');
  const [f, setF] = useState({ staffId: '', pin: '', phone: '', code: '', pin2: '' });
  const a = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: k === 'staffId' ? e.target.value.toUpperCase() : e.target.value });
  const signin = () => a.run(async () => { const r = await api('/crew/login', { body: { id: f.staffId, pin: f.pin } }); auth.set('crew', r.token); onIn(); });
  const activate = () => a.run(async () => {
    if (f.pin !== f.pin2) throw new Error('The two PINs do not match');
    const r = await api('/crew/activate', { body: { staffId: f.staffId, phone: f.phone, code: f.code, pin: f.pin } });
    auth.set('crew', r.token); onIn();
  });
  return (
    <>
      <header className="auth-hero" style={{ background: 'var(--ink)', color: '#fff', padding: '20px 20px 64px', minHeight: mode === 'activate' ? 200 : 280 }}>
        <div className="brand"><Logo />HopOn Crew</div>
        <div className="auth-title">
          <h1 className="disp" style={{ fontSize: 30 }}>{mode === 'signin' ? 'Sign in with your Staff ID' : 'Activate your Staff ID'}</h1>
          <p style={{ color: '#D9CBCE', margin: '8px 0 0' }}>For VIP conductors, drivers and terminal managers.</p>
        </div>
      </header>
      <main className="page auth-main" style={{ marginTop: -40, position: 'relative' }}>
        {mode === 'signin' ? (
          <form className="card pad stack" style={{ boxShadow: 'var(--sh2)' }} onSubmit={(e) => { e.preventDefault(); signin(); }}>
            <label className="field"><span>Staff ID</span>
              <span className="input-wrap"><Icon n="badge" size="s" /><input autoCapitalize="characters" autoComplete="username" placeholder="VIP-C1001" value={f.staffId} onChange={set('staffId')} required /></span>
            </label>
            <label className="field"><span>PIN</span>
              <span className="input-wrap"><Icon n="lock" size="s" /><input type="password" inputMode="numeric" autoComplete="current-password" maxLength={6} value={f.pin} onChange={set('pin')} required /></span>
            </label>
            <Err e={a.error} />
            <button className="btn btn-g" disabled={a.busy}>Sign in</button>
            <button type="button" className="btn btn-t" onClick={() => { setMode('activate'); a.setError(null); }}>First time? Activate your Staff ID</button>
          </form>
        ) : (
          <form className="card pad stack" style={{ boxShadow: 'var(--sh2)' }} onSubmit={(e) => { e.preventDefault(); activate(); }}>
            <p className="mut" style={{ margin: 0, fontSize: 14 }}>Use the Staff ID on your VIP ID card and the code VIP texted to your phone.</p>
            <label className="field"><span>Staff ID</span>
              <span className="input-wrap"><Icon n="badge" size="s" /><input autoCapitalize="characters" autoComplete="username" placeholder="VIP-C1003" value={f.staffId} onChange={set('staffId')} required /></span>
            </label>
            <label className="field"><span>Phone number VIP has for you</span>
              <span className="input-wrap"><Icon n="phone" size="s" /><input inputMode="tel" autoComplete="tel" placeholder="024 400 0005" value={f.phone} onChange={set('phone')} required /></span>
            </label>
            <label className="field"><span>Activation code from the SMS</span>
              <input className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.replace(/\D/g, '') })} required style={{ letterSpacing: '.3em', textAlign: 'center' }} />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label className="field"><span>New PIN</span><input className="input" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} required /></label>
              <label className="field"><span>Repeat PIN</span><input className="input" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={f.pin2} onChange={(e) => setF({ ...f, pin2: e.target.value.replace(/\D/g, '') })} required /></label>
            </div>
            <span className="lbl">4 to 6 digits. Not 1234 or all the same digit. Never share it.</span>
            <Err e={a.error} />
            <button className="btn btn-g" disabled={a.busy}>Activate and sign in</button>
            <button type="button" className="btn btn-t" onClick={() => { setMode('signin'); a.setError(null); }}>I already have a PIN</button>
          </form>
        )}
        <div className="note" style={{ fontSize: 14 }}><b>No Staff ID?</b> Only VIP can issue one. Ask your terminal manager. Demo Staff IDs are in the project README.</div>
        <Link to="/" className="lbl" style={{ textAlign: 'center' }}>Passenger app</Link>
      </main>
    </>
  );
}

// ---------------------------------------------------------------- offline scanning support
const b64uToBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
async function verifyOffline(qr: string, publicKey: string): Promise<{ c: string; r: number; d: string; n: string } | null> {
  const [tag, body, sig] = qr.split('.');
  if (tag !== 'HOP1' || !body || !sig) return null;
  try {
    const key = await crypto.subtle.importKey('raw', b64uToBytes(publicKey), { name: 'Ed25519' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'Ed25519' }, key, b64uToBytes(sig), new TextEncoder().encode(body));
    return ok ? JSON.parse(new TextDecoder().decode(b64uToBytes(body))) : null;
  } catch { return null; }
}
const qKey = 'hopon.crew.queue';
const getQueue = (): any[] => JSON.parse(store.get(qKey) || '[]');
const setQueue = (q: any[]) => store.set(qKey, JSON.stringify(q));

// ---------------------------------------------------------------- conductor
function Conductor({ me, trip, reload, signOut }: { me: Crew; trip: any; reload: () => void; signOut: () => void }) {
  if (!trip) return <><CrewHeader me={me} signOut={signOut} sub="Conductor" /><OpenTrip reload={reload} /></>;
  return <><CrewHeader me={me} signOut={signOut} sub="Conductor" /><ConductorTrip tripId={trip.id} reload={reload} /></>;
}

/** This phone's position, or null if location is off or slow. The bus phone's location is where the trip starts. */
function getPosition(timeout = 8000): Promise<{ lat: number; lng: number; acc: number } | null> {
  return new Promise((res) => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      () => res(null), { enableHighAccuracy: true, timeout, maximumAge: 15000 });
  });
}

function OpenTrip({ reload }: { reload: () => void }) {
  const [opt, setOpt] = useState<any>(null);
  const [f, setF] = useState({ routeId: '', busId: '', driverId: '' });
  const [seats, setSeats] = useState('');
  const [pick, setPick] = useState(false);
  const [pos, setPos] = useState<{ lat: number; lng: number; acc: number } | null | 'asking'>('asking');
  const a = useAction();
  useEffect(() => { api('/crew/options', { who: 'crew' }).then((o) => { setOpt(o); setF({ routeId: o.routes[0]?.id ?? '', busId: o.buses[0]?.id ?? '', driverId: o.drivers[0]?.id ?? '' }); }).catch(a.setError); }, []);
  useEffect(() => { getPosition().then(setPos); }, []);
  const route = opt?.routes.find((r: any) => String(r.id) === String(f.routeId));
  const bus = opt?.buses.find((b: any) => String(b.id) === String(f.busId));
  useEffect(() => { if (bus) setSeats(String(bus.seats)); }, [bus?.id]);
  const n = Number(seats);
  const seatsOk = Number.isInteger(n) && n >= 1 && (!bus || n <= bus.seats);
  const open = () => a.run(async () => {
    const here = pos && pos !== 'asking' ? pos : await getPosition(5000);
    await api('/crew/trips', { body: { ...f, seats: n, ...(here ? { lat: here.lat, lng: here.lng } : {}) }, who: 'crew' });
    reload();
  });
  return (
    <main className="page">
      <h1 className="disp" style={{ fontSize: 30 }}>Open boarding</h1>
      <form className="card pad stack" onSubmit={(e) => { e.preventDefault(); open(); }}>
        <div className="field"><span>Route</span>
          <button type="button" className="input" onClick={() => setPick(true)} style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <Icon n="search" size="s" /><span style={{ flex: 1 }}>{route?.label || 'Choose a route'}</span><Icon n="chev" size="s" />
          </button>
        </div>
        {pick && opt && <PickerSheet title="Route" placeholder="Type a town, e.g. Tamale" value={route?.id}
          items={opt.routes.map((r: any) => ({ id: r.id, title: r.label, keywords: r.label.split(' to '), badge: <Icon n="bus" size="s" /> }))}
          onPick={(it) => setF({ ...f, routeId: String(it.id) })} onClose={() => setPick(false)} />}
        <label className="field"><span>Bus</span><select className="input" value={f.busId} onChange={(e) => setF({ ...f, busId: e.target.value })}>{opt?.buses.map((b: any) => <option key={b.id} value={b.id}>Bus {b.number} · {b.plate} · {b.seats} seats</option>)}</select></label>
        <label className="field"><span>Driver</span><select className="input" value={f.driverId} onChange={(e) => setF({ ...f, driverId: e.target.value })}>{opt?.drivers.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <div className="field">
          <span>Seats to sell on this trip</span>
          <div className="seat-input">
            <button type="button" className="icb" aria-label="One seat fewer" onClick={() => setSeats(String(Math.max(1, (n || 1) - 1)))}>−</button>
            <input className="input" inputMode="numeric" aria-label="Seats to sell" value={seats} onChange={(e) => setSeats(e.target.value.replace(/\D/g, '').slice(0, 2))} />
            <button type="button" className="icb" aria-label="One seat more" onClick={() => setSeats(String(Math.min(bus?.seats || 70, (n || 0) + 1)))}>+</button>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {[1, 5, 10].map((k) => <button key={k} type="button" className="chip dim" style={{ border: 'none', cursor: 'pointer', minHeight: 32 }} onClick={() => setSeats(String(k))}>{k}</button>)}
            {bus && <button type="button" className="chip dim" style={{ border: 'none', cursor: 'pointer', minHeight: 32 }} onClick={() => setSeats(String(bus.seats))}>Full bus ({bus.seats})</button>}
          </div>
          <span className="lbl">{seatsOk ? `The bus is full and ready to leave after ${n} seat${n === 1 ? '' : 's'}. Type 1 for a quick test.` : `Type a number from 1 to ${bus?.seats ?? 42}.`}</span>
        </div>
        <div className={pos && pos !== 'asking' ? 'okbox row' : 'note row'} style={{ fontSize: 14, fontWeight: 500 }}>
          <Icon n="pin" size="s" />
          <span>{pos === 'asking' ? 'Finding this phone’s location…'
            : pos ? `Trip starts from this phone’s location (accurate to about ${pos.acc} m). The map follows the bus phone.`
            : `Location is off, so the trip starts from ${route ? route.label.split(' to ')[0] : 'the'} terminal. Allow location for this site to use where the bus really is.`}</span>
        </div>
        {opt && (!opt.buses.length || !opt.drivers.length) && <div className="note">{!opt.buses.length ? 'Every bus is on a trip.' : 'Every driver is on a trip.'}</div>}
        <Err e={a.error} />
        <button className="btn btn-g" disabled={a.busy || !f.busId || !f.driverId || !seatsOk}>Open boarding</button>
      </form>
    </main>
  );
}

function ConductorTrip({ tripId, reload }: { tripId: number; reload: () => void }) {
  const [t, setT] = useState<any>(null);
  const [view, setView] = useState<'board' | 'scan'>('board');
  const [walkin, setWalkin] = useState(false);
  const [queued, setQueued] = useState(getQueue().length);
  const a = useAction();

  const load = useCallback(() => api(`/crew/trips/${tripId}`, { who: 'crew' }).then(setT).catch(a.setError), [tripId]);
  useEffect(() => { load(); return live(`trip:${tripId}`, 'trip:update', load); }, [load, tripId]);
  useEffect(() => live('board', 'board:update', load), [load]);

  // Cache today's tickets + the signing key so scanning keeps working without signal.
  useEffect(() => {
    Promise.all([api('/config'), api(`/crew/trips/${tripId}/tickets`, { who: 'crew' })]).then(([cfg, tickets]) => {
      store.set('hopon.crew.cache', JSON.stringify({ tripId, publicKey: cfg.publicKey, routeId: t?.route.id, date: todayIso(), tickets }));
    }).catch(() => {});
  }, [tripId, t?.route.id, t?.filled]);

  // Sync offline scans when signal returns.
  useEffect(() => {
    const sync = async () => {
      const q = getQueue();
      if (!q.length) return;
      const left: any[] = [];
      for (const item of q) {
        try { await api('/crew/scan', { body: item, who: 'crew' }); } catch (e) { if (e instanceof ApiError && e.status === 0) left.push(item); }
      }
      setQueue(left); setQueued(left.length); load();
    };
    sync();
    const iv = setInterval(sync, 15000);
    window.addEventListener('online', sync);
    return () => { clearInterval(iv); window.removeEventListener('online', sync); };
  }, [load]);

  if (!t) return <main className="page"><Err e={a.error} /></main>;
  if (view === 'scan') return <Scanner trip={t} onBack={() => { setView('board'); load(); setQueued(getQueue().length); }} onQueued={() => setQueued(getQueue().length)} />;
  // One phone per bus: once boarding closes, this phone becomes the driver's Start Trip panel.
  if (t.status !== 'loading') {
    return <DriverPanel trip={t} reload={reload}
      onReopen={t.status === 'closed' ? () => a.run(async () => { await api(`/crew/trips/${t.id}/reopen`, { body: {}, who: 'crew' }); load(); }) : undefined} />;
  }
  const pct = Math.round((t.filled / t.bus.seats) * 100);
  const left = t.bus.seats - t.filled;
  const full = left <= 0;

  return (
    <main className="page">
      <div className="card pad stack" style={{ background: 'var(--r7)', color: '#fff' }}>
        <div className="between"><span><span style={{ color: 'var(--r1)', fontSize: 14 }}>{t.route.label}</span><br /><b className="disp" style={{ fontSize: 30 }}>Bus {t.bus.number}</b></span>
          <span className="chip" style={{ background: 'rgba(255,255,255,.16)', color: '#fff' }}>{t.status === 'loading' ? 'Boarding open' : t.status === 'closed' ? 'Boarding closed' : t.status === 'departed' ? 'On the road' : t.status}</span></div>
        <div className="bar" style={{ background: 'rgba(255,255,255,.2)', height: 12, borderRadius: 6 }}><span style={{ width: pct + '%', background: 'var(--g)' }} /></div>
        <div className="between" style={{ fontSize: 15 }}><span><b style={{ fontSize: 22 }}>{t.filled}</b> / {t.bus.seats} seats{t.bus.busSeats > t.bus.seats ? ` (bus has ${t.bus.busSeats})` : ""}</span><span>{left} left · app {t.appFilled}/{Math.min(t.route.appShare, t.bus.seats)}</span></div>
        <span style={{ fontSize: 13, color: 'var(--r1)' }}>Driver: {t.driver}</span>
      </div>
      {queued > 0 && <div className="note row"><Icon n="wifioff" size="s" />{queued} offline scan(s) waiting to sync.</div>}
      <Err e={a.error} />

      {full && <div className="okbox row" role="status"><Icon n="check" size="s" /><span><b>Bus is full.</b> Close boarding and hand this phone to {t.driver?.split(' ')[0] || 'the driver'}.</span></div>}
      {!full && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <button className="btn btn-g" style={{ minHeight: 88, flexDirection: 'column', gap: 4 }} onClick={() => setView('scan')}><Icon n="scan" />Scan ticket</button>
          <button className="btn btn-o" style={{ minHeight: 88, flexDirection: 'column', gap: 4 }} onClick={() => setWalkin(true)}><Icon n="cash" />Walk-in sale</button>
        </div>
      )}
      <button className={`btn ${full ? 'btn-r' : 'btn-k'}`} style={full ? { minHeight: 72, fontSize: 19 } : undefined} disabled={a.busy}
        onClick={() => { if (full || confirm(`Close boarding with ${t.filled} of ${t.bus.seats} seats filled?`)) a.run(async () => { await api(`/crew/trips/${t.id}/close`, { body: {}, who: 'crew' }); load(); }); }}>
        <Icon n="flag" size="s" />Close boarding · hand to driver
      </button>

      {t.queue.length > 0 && t.status === 'loading' && (
        <section className="stack">
          <h2 className="h2">Priority line ({t.queue.length})</h2>
          <div className="card list">{t.queue.map((q: any) => <div key={q.id} className="li"><span className="chip ok">{timeOf(q.checked_in_at)}</span><b style={{ flex: 1 }}>{q.name}</b><span className="lbl">{q.code}</span></div>)}</div>
        </section>
      )}
      <section className="stack">
        <div className="between"><h2 className="h2">On board ({t.boarded.length})</h2><span className="lbl">Cash {cedis(t.walkinTotals.cash)} · MoMo {cedis(t.walkinTotals.momo)}</span></div>
        <div className="card list scroll">
          {t.boarded.map((b: any) => <div key={b.id} className="li"><span className={`chip ${b.kind === 'app' ? 'ok' : 'dim'}`}>{b.kind === 'app' ? 'App' : b.kind === 'cash' ? 'Cash' : 'MoMo'}</span><span style={{ flex: 1 }}>{b.name}</span>{b.offline ? <Icon n="wifioff" size="xs" label="Scanned offline" /> : null}<span className="lbl">{timeOf(b.created_at)}</span></div>)}
          {!t.boarded.length && <div className="li mut">Nobody yet.</div>}
        </div>
      </section>
      {walkin && <WalkinSheet trip={t} onClose={() => setWalkin(false)} onDone={() => { setWalkin(false); load(); }} />}
    </main>
  );
}

function WalkinSheet({ trip, onClose, onDone }: { trip: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ qty: 1, method: 'cash', phone: '', name: '' });
  const a = useAction();
  return (
    <Sheet onClose={onClose} label="Walk-in sale">
      <h2 className="h2">Walk-in ticket</h2>
      <div className="between"><span className="mut">Seats</span>
        <span className="row"><button className="icb" style={{ background: 'var(--ln)' }} aria-label="One fewer" onClick={() => setF({ ...f, qty: Math.max(1, f.qty - 1) })}>−</button><b style={{ fontSize: 22, minWidth: 24, textAlign: 'center' }}>{f.qty}</b><button className="icb" style={{ background: 'var(--ln)' }} aria-label="One more" onClick={() => setF({ ...f, qty: Math.min(10, f.qty + 1) })}>+</button></span></div>
      <div className="seg" role="group" aria-label="Payment">
        <button aria-pressed={f.method === 'cash'} onClick={() => setF({ ...f, method: 'cash' })}>Cash</button>
        <button aria-pressed={f.method === 'momo'} onClick={() => setF({ ...f, method: 'momo' })}>Mobile Money</button>
      </div>
      {f.method === 'momo' && <label className="field"><span>Passenger MoMo number</span><input className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>}
      <label className="field"><span>Name (optional)</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <div className="between"><span className="mut">{f.method === 'cash' ? 'Collect' : 'Request'}</span><b style={{ fontSize: 26 }}>{cedis(trip.route.fare * f.qty)}</b></div>
      {f.method === 'momo' && <p className="lbl" style={{ margin: 0 }}>Test mode: the MoMo prompt is treated as approved.</p>}
      <Err e={a.error} />
      <button className="btn btn-g" disabled={a.busy} onClick={() => a.run(async () => { await api('/crew/walkin', { body: { tripId: trip.id, ...f }, who: 'crew' }); onDone(); })}>
        {f.method === 'cash' ? `Cash received · add ${f.qty} seat(s)` : 'Send MoMo request'}</button>
    </Sheet>
  );
}

type Result = { tone: 'ok' | 'bad' | 'warn'; title: string; sub: string; name?: string; route?: string; help: string };

function Scanner({ trip, onBack, onQueued }: { trip: any; onBack: () => void; onQueued: () => void }) {
  const [res, setRes] = useState<Result | null>(null);
  const open = useRef(false);
  useEffect(() => {
    open.current = !!res;
    if (res && navigator.vibrate) navigator.vibrate(res.tone === "ok" ? 90 : [220, 90, 220]);
  }, [res]);
  const [code, setCode] = useState('');
  const [camErr, setCamErr] = useState('');
  const busy = useRef(false);
  const last = useRef({ text: '', at: 0 });
  const cam = useRef<Html5Qrcode | null>(null);

  const check = useCallback(async (text: string) => {
    if (busy.current || open.current) return; // ignore the camera while a result is showing
    if (text === last.current.text && Date.now() - last.current.at < 4000) return;
    last.current = { text, at: Date.now() };
    busy.current = true;
    try {
      if (text.startsWith('STF1.')) {
        // A staff ID card, not a ticket: confirm the person really is VIP crew.
        const v = await api<any>('/verify-staff', { body: { qr: text } });
        setRes(v.valid
          ? { tone: 'ok', title: 'Genuine VIP staff', sub: `${v.name} · ${v.role}`, name: v.name, route: v.staffId, help: 'This staff ID card was issued by VIP and is switched on.' }
          : { tone: 'bad', title: 'Not valid staff ID', sub: v.reason, help: 'Do not accept this card. Tell your terminal manager.' });
        return;
      }
      setRes(await api<Result>('/crew/scan', { body: { tripId: trip.id, qr: text }, who: 'crew' }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) setRes(await offlineCheck(text));
      else setRes({ tone: 'bad', title: 'Not found', sub: e instanceof Error ? e.message : 'Unknown ticket', help: 'Check the code with the passenger, or offer a walk-in ticket.' });
    } finally { busy.current = false; }
  }, [trip.id]);

  const offlineCheck = async (text: string): Promise<Result> => {
    const cache = JSON.parse(store.get('hopon.crew.cache') || '{}');
    const claims = text.startsWith('HOP1.') && cache.publicKey ? await verifyOffline(text, cache.publicKey) : null;
    if (!claims) return { tone: 'bad', title: 'Cannot check offline', sub: 'Only app QR codes work without signal', help: 'Ask for the QR code, or wait for signal to check a typed code.' };
    if (claims.r !== trip.route.id) return { tone: 'warn', title: 'Wrong route', sub: 'Ticket is for another route', name: claims.n, help: 'The ticket is still valid. Send the passenger to the right bay.' };
    if (claims.d !== todayIso()) return { tone: 'warn', title: 'Wrong date', sub: `Ticket is for ${claims.d}`, name: claims.n, help: 'Not valid today.' };
    const used: string[] = JSON.parse(store.get('hopon.crew.used') || '[]');
    const known = (cache.tickets || []).find((x: any) => x.code === claims.c);
    if (used.includes(claims.c) || known?.status === 'boarded') return { tone: 'bad', title: 'Already used', sub: 'Scanned before on this phone or another bus', name: claims.n, help: 'Do not board on this ticket.' };
    store.set('hopon.crew.used', JSON.stringify([...used, claims.c]));
    setQueue([...getQueue(), { tripId: trip.id, qr: text, offline: true }]);
    onQueued();
    return { tone: 'ok', title: 'Let them board', sub: 'Checked offline · will sync', name: claims.n, route: trip.route.label, help: `Check the passenger is ${claims.n}. The signature is genuine; this scan uploads when signal returns.` };
  };

  useEffect(() => {
    const q = new Html5Qrcode('reader', { verbose: false } as any);
    cam.current = q;
    // Square camera window, the same size as the QR on the passenger's ticket (see --qr-size).
    q.start({ facingMode: 'environment' }, { fps: 12, aspectRatio: 1, disableFlip: true }, (t) => check(t), () => {})
      .catch(() => setCamErr('Camera not available here. Type the ticket code from the SMS instead.'));
    return () => { q.isScanning ? q.stop().then(() => q.clear()).catch(() => {}) : q.clear(); };
  }, [check]);

  const icon = res?.tone === 'ok' ? 'check' : res?.tone === 'bad' ? 'x' : 'warn';
  return (
    <div className="dark" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <header className="between" style={{ padding: '12px 16px' }}>
        <button className="icb" aria-label="Back to bus" onClick={onBack} style={{ background: 'rgba(255,255,255,.12)', color: '#fff' }}><Icon n="back" size="s" /></button>
        <span style={{ textAlign: 'center' }}><b>Scan tickets</b><br /><span style={{ fontSize: 12, color: '#CDBDC0' }}>Bus {trip.bus.number} to {trip.route.to.city}</span></span>
        <span style={{ width: 44 }} />
      </header>
      <div style={{ padding: '8px 16px' }}>
        <div className="scan-window" aria-label="Camera. Hold the ticket QR inside the square.">
          <div id="reader" />
          {camErr && <span className="scan-off"><Icon n="scan" size="l" />Camera off</span>}
          <svg className="scan-corners" viewBox="0 0 272 272" aria-hidden="true"><path d="M4 60V30A26 26 0 0 1 30 4h30M212 4h30a26 26 0 0 1 26 26v30M268 212v30a26 26 0 0 1-26 26h-30M60 268H30A26 26 0 0 1 4 242v-30" stroke="#F2B227" strokeWidth="7" fill="none" strokeLinecap="round" /></svg>
          {!res && !camErr && <span className="scan-line" aria-hidden="true" />}
        </div>
        {camErr && <p style={{ color: '#F8D7DC', textAlign: 'center', fontSize: 14 }}>{camErr}</p>}
        <p style={{ textAlign: 'center', fontSize: 14, color: '#D9CBCE' }}>Fit the ticket's QR inside the square. Works without internet.</p>
        <form className="row" onSubmit={(e) => { e.preventDefault(); last.current = { text: '', at: 0 }; check(code.trim()); }}>
          <input className="input" aria-label="Ticket code" placeholder="VIP-XXXXXX" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} style={{ textTransform: 'uppercase' }} />
          <button className="btn btn-g btn-sm" style={{ height: 52 }}>Check</button>
        </form>
      </div>
      {res && (
        // Floating result card over the camera; Scan next closes it and the camera carries on.
        <div className="scan-pop-bg" onClick={() => { setRes(null); setCode(''); }}>
          <section role="alertdialog" aria-modal="true" aria-live="assertive" aria-labelledby="scan-title" className={`scan-pop ${res.tone}`} onClick={(e) => e.stopPropagation()}>
            <span className="scan-pop-badge"><Icon n={icon} size="l" /></span>
            <h2 id="scan-title" className="disp" style={{ fontSize: 30 }}>{res.title}</h2>
            <b className="scan-pop-sub">{res.sub}</b>
            {res.name && (
              <div className="scan-pop-who">
                <div><span className="lbl">Passenger</span><b>{res.name}</b></div>
                <div><span className="lbl">Ticket</span><b>{res.route}</b></div>
              </div>
            )}
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--ink2)' }}>{res.help}</p>
            <button autoFocus className="btn btn-g" onClick={() => { setRes(null); setCode(''); }}><Icon n="scan" size="s" />Scan next</button>
          </section>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- driver
function Driver({ me, trip, reload, signOut }: { me: Crew; trip: any; reload: () => void; signOut: () => void }) {
  if (!trip) {
    return (<><CrewHeader me={me} signOut={signOut} sub="Driver" />
      <main className="page"><div className="card pad stack"><b>No trip assigned yet</b><span className="mut">On most buses the conductor hands you the bus phone when boarding closes. If you have your own phone, the trip appears here once the conductor picks you as driver.</span><button className="btn btn-o" onClick={reload}><Icon n="refresh" size="s" />Check again</button></div></main></>);
  }
  return <><CrewHeader me={me} signOut={signOut} sub="Driver" /><DriverPanel trip={trip} reload={reload} /></>;
}

/** Keeps the screen awake during a trip so the browser keeps sending GPS. */
function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return;
    let lock: any = null;
    const get = () => (navigator as any).wakeLock.request('screen').then((l: any) => { lock = l; }).catch(() => {});
    get();
    const vis = () => document.visibilityState === 'visible' && get();
    document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); lock?.release?.(); };
  }, [on]);
}

/**
 * The driver's side of the bus phone: Start Trip, live map while driving, End Trip.
 * Shown to the driver on their own phone, or on the shared bus phone once the conductor closes boarding.
 */
function DriverPanel({ trip, reload, onReopen }: { trip: any; reload: () => void; onReopen?: () => void }) {
  const [t, setT] = useState<any>(trip);
  const [sim, setSim] = useState(false);
  const [gps, setGps] = useState<'off' | 'on' | 'denied'>('off');
  const buffer = useRef<any[]>([]);
  const a = useAction();
  useWakeLock(t?.status === 'departed');
  const testMode = useTestMode();

  useEffect(() => setT((o: any) => ({ ...o, ...trip })), [trip]);
  useEffect(() => {
    if (!trip?.id) return;
    api(`/crew/trips/${trip.id}/simulate`, { who: 'crew' }).then((r) => setSim(r.simulating)).catch(() => {});
    return live(`trip:${trip.id}`, 'trip:update', (v) => setT((o: any) => ({ ...o, ...v })));
  }, [trip?.id]);

  // Real GPS: send every ~5 s while departed, buffering through dead zones.
  useEffect(() => {
    if (t?.status !== 'departed' || sim || !navigator.geolocation) return;
    let lastSent = 0;
    const id = navigator.geolocation.watchPosition((p) => {
      setGps('on');
      buffer.current.push({ lat: p.coords.latitude, lng: p.coords.longitude, speed: p.coords.speed != null ? p.coords.speed * 3.6 : null });
      if (Date.now() - lastSent < 5000) return;
      lastSent = Date.now();
      const pts = buffer.current.splice(0);
      api(`/crew/trips/${t.id}/location`, { body: { points: pts }, who: 'crew' }).catch(() => buffer.current.unshift(...pts));
    }, () => setGps('denied'), { enableHighAccuracy: true, maximumAge: 5000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [t?.status, t?.id, sim]);

  const act = (path: string, body: any = {}) => a.run(async () => { const r = await api(`/crew/trips/${t.id}/${path}`, { body, who: 'crew' }); if (r?.id) setT(r); return r; });
  const full = t.filled >= t.bus.seats;

  return (
    <>
      <main className="page">
        {(t.status === 'loading' || t.status === 'closed') && (
          <section className="driver-ready" aria-labelledby="ready-h">
            <span className="chip" style={{ background: 'rgba(255,255,255,.16)', color: '#fff', alignSelf: 'flex-start' }}><Icon n="bus" size="xs" />Driver · Bus {t.bus.number}</span>
            <h1 id="ready-h" className="disp" style={{ fontSize: 34 }}>{full ? 'Bus is full.' : 'Boarding closed.'}<br />Ready to go?</h1>
            <div className="ready-facts">
              <div><b>{t.filled}/{t.bus.seats}</b><span>on board</span></div>
              <div><b>{t.route.to.city}</b><span>{t.route.km} km</span></div>
              <div><b>{t.driver?.split(' ')[0] || 'Driver'}</b><span>driving</span></div>
            </div>
            <Err e={a.error} />
            <button className="btn start-btn" disabled={a.busy} onClick={async () => { const here = await getPosition(6000); await act('start', here ? { lat: here.lat, lng: here.lng } : {}); }}><Icon n="play" />Start Trip</button>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--r1)' }}>This phone shares the bus location with passengers, their families and VIP operations until you tap End Trip. Keep it on the dashboard, charging.</p>
            {onReopen && <button className="btn btn-t" style={{ color: '#fff' }} disabled={a.busy} onClick={onReopen}>Back to boarding (conductor)</button>}
          </section>
        )}
        {t.status === 'departed' && <>
          <div className="card pad stack" style={{ gap: 4 }}>
            <span className="lbl">{t.route.label}</span>
            <b className="disp" style={{ fontSize: 26 }}>Bus {t.bus.number} · {t.bus.plate}</b>
            <span className="mut" style={{ fontSize: 14 }}>{t.filled} passengers on board</span>
          </div>
          <Err e={a.error} />
          <TripMap paths={[t.route.path]} progress={t.progress} buses={t.position ? [{ id: t.id, lat: t.position.lat, lng: t.position.lng, label: t.bus.number }] : []}
            points={[{ lat: t.route.path[t.route.path.length - 1][0], lng: t.route.path[t.route.path.length - 1][1], label: t.route.to.city, end: true }]} />
          <div className="card pad stack">
            <div className="between"><b>{t.distLeftKm} km to {t.route.to.city}</b><span className="live"><i />Sharing location</span></div>
            <span className="bar"><span style={{ width: Math.round(t.progress * 100) + '%' }} /></span>
            <span className="lbl">{sim ? 'Demo drive is moving the bus along the route.' : gps === 'on' ? 'Using this phone’s GPS.' : gps === 'denied' ? 'Location is blocked. Allow it in the browser, or use the demo drive.' : 'Waiting for GPS…'}</span>
          </div>
          {(testMode || sim) && <button className="btn btn-o" disabled={a.busy} onClick={async () => { const r = await act('simulate', { on: !sim }); if (r) setSim(r.simulating); }}><Icon n={sim ? 'stop' : 'bus'} size="s" />{sim ? 'Stop demo drive' : 'Test mode: demo drive'}</button>}
          <button className="btn btn-k" style={{ minHeight: 80, fontSize: 20 }} disabled={a.busy} onClick={() => { if (confirm('End the trip? Passengers and families get an "arrived safely" message.')) act('end'); }}><Icon n="flag" />End Trip</button>
        </>}
        {t.status === 'arrived' && <>
          <div className="card empty">
            <span className="tile" style={{ borderRadius: 32, background: 'var(--ok)', color: '#fff' }}><Icon n="check" size="l" /></span>
            <h1 className="disp" style={{ fontSize: 28 }}>Arrived at {t.route.to.city}</h1>
            <span className="mut">Trip ended at {timeOf(t.arrivedAt)}. Passengers and families got the "arrived safely" text.</span>
          </div>
          <button className="btn btn-g" onClick={reload}>Done · back to boarding</button>
        </>}
      </main>
    </>
  );
}

export { prettyPhone };
