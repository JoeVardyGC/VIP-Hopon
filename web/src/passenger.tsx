import { useCallback, useEffect, useMemo, useState, createContext, useContext, type ReactNode } from 'react';
import { Link, NavLink, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { api, auth, live, cedis, todayIso, addDays, niceDate, timeOf, firstName, initials, prettyPhone, store } from './api';
import { Icon, Logo, Sheet, Err, useAction, TripMap, townCode, hrs, useTestMode } from './ui';
import { PickerSheet, type PickItem } from './picker';
import { PAY_METHODS } from './paylogos';
import { InstallCard } from './install';

// ------------------------------------------------------------ session
type Me = { id: number; phone: string; name: string | null; credit: number; contacts: { id: number; name: string; phone: string }[] };
const MeCtx = createContext<{ me: Me | null; reload: () => Promise<void>; signOut: () => void }>({ me: null, reload: async () => {}, signOut: () => {} });
export const useMe = () => useContext(MeCtx);

export function PassengerApp({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const loc = useLocation();
  const reload = useCallback(async () => {
    if (!auth.token('passenger')) { setMe(null); setReady(true); return; }
    try { setMe(await api('/me', { who: 'passenger' })); } catch { setMe(null); }
    setReady(true);
  }, []);
  useEffect(() => { reload(); }, [reload]);
  const signOut = () => { auth.set('passenger', null); setMe(null); };
  if (!ready) return <div className="app" />;
  if (!me && loc.pathname !== '/signin') return <Navigate to={`/signin?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <MeCtx.Provider value={{ me, reload, signOut }}><div className="app">{children}</div></MeCtx.Provider>;
}

function Tabs() {
  return (
    <nav className="tabs" aria-label="Main">
      <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}><Icon n="home" />Home</NavLink>
      <NavLink to="/tickets" className={({ isActive }) => (isActive ? 'active' : '')}><Icon n="ticket" />Tickets</NavLink>
      <NavLink to="/trip" className={({ isActive }) => (isActive ? 'active' : '')}><Icon n="nav" />Live trip</NavLink>
    </nav>
  );
}

function BackBtn({ to, label = 'Back', light }: { to?: string; label?: string; light?: boolean }) {
  const nav = useNavigate();
  return (
    <button className="icb" aria-label={label} onClick={() => (to ? nav(to) : nav(-1))}
      style={light ? { background: 'rgba(255,255,255,.14)', color: '#fff' } : { background: '#fff', boxShadow: 'var(--sh1)', color: 'var(--ink)' }}>
      <Icon n="back" size="s" />
    </button>
  );
}

// ------------------------------------------------------------ data hooks
export type Town = { id: number; name: string; city: string; region: string; aliases: string[]; departures: number };
export type RouteT = { id: number; label: string; from: { id: number; name: string; city: string }; to: { id: number; name: string; city: string }; fare: number; km: number; hours: number };
let townCache: Town[] | null = null, routeCache: RouteT[] | null = null;
export function useNetwork() {
  const [towns, setTowns] = useState<Town[]>(townCache || []);
  const [routes, setRoutes] = useState<RouteT[]>(routeCache || []);
  useEffect(() => {
    if (!townCache) api<Town[]>('/towns').then((t) => { townCache = t; setTowns(t); }).catch(() => {});
    if (!routeCache) api<RouteT[]>('/routes').then((r) => { routeCache = r; setRoutes(r); }).catch(() => {});
  }, []);
  return { towns, routes };
}
const placeName = (t?: { city: string; name: string }) => (t ? (t.name === 'VIP station' ? t.city : `${t.city}, ${t.name}`) : '');

// ------------------------------------------------------------ sign in
export function SignIn() {
  const { me, reload } = useMe();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<{ phone: string; devCode?: string } | null>(null);
  const a = useAction();
  const next = sp.get('next') || '/';
  if (me) return <Navigate to={next} replace />;

  const send = () => a.run(async () => setSent(await api('/auth/otp', { body: { phone } })));
  const verify = () => a.run(async () => {
    const r = await api('/auth/verify', { body: { phone: sent!.phone, code, name } });
    auth.set('passenger', r.token);
    await reload();
    nav(next, { replace: true });
  });

  return (
    <>
      <section className="hero auth-hero">
        <RouteDoodle tall />
        <div className="brand" style={{ position: 'relative' }}><Logo />VIP HopOn</div>
        <div className="auth-title">
          <h1 className="disp" style={{ fontSize: 34 }}>Book from home.<br />Hop on.</h1>
          <p style={{ color: 'var(--r1)', fontSize: 17, margin: '8px 0 0' }}>They watch you arrive.</p>
        </div>
      </section>
      <main className="page auth-main" style={{ marginTop: -40, position: 'relative' }}>
        {!sent ? (
          <form className="card pad stack" style={{ boxShadow: 'var(--sh3)' }} onSubmit={(e) => { e.preventDefault(); send(); }}>
            <h2 className="h2">Sign in with your phone</h2>
            <label className="field"><span>Phone number</span>
              <span className="input-wrap"><Icon n="phone" size="s" /><input inputMode="tel" autoComplete="tel" placeholder="024 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} required /></span>
            </label>
            <label className="field"><span>Your name (first time only)</span>
              <span className="input-wrap"><Icon n="user" size="s" /><input autoComplete="name" placeholder="Ama Mensah" value={name} onChange={(e) => setName(e.target.value)} /></span>
            </label>
            <Err e={a.error} />
            <button className="btn btn-g" disabled={a.busy}>Send me a code<Icon n="arrow" size="s" /></button>
            <p className="lbl" style={{ margin: 0 }}>We text a 6-digit code. No password needed.</p>
          </form>
        ) : (
          <form className="card pad stack" style={{ boxShadow: 'var(--sh3)' }} onSubmit={(e) => { e.preventDefault(); verify(); }}>
            <h2 className="h2">Enter the code</h2>
            <p className="mut" style={{ margin: 0 }}>Sent by SMS to {prettyPhone(sent.phone)}.</p>
            {sent.devCode && <div className="note"><b>Test mode:</b> no SMS is sent yet. Your code is <b>{sent.devCode}</b>.</div>}
            <label className="field"><span>6-digit code</span>
              <input className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus style={{ letterSpacing: '.4em', fontSize: 24, textAlign: 'center' }} />
            </label>
            <Err e={a.error} />
            <button className="btn btn-g" disabled={a.busy || code.length !== 6}>Continue</button>
            <button type="button" className="btn btn-t" onClick={() => { setSent(null); setCode(''); }}>Use a different number</button>
          </form>
        )}
        <p className="lbl" style={{ textAlign: 'center' }}>VIP crew? <Link to="/crew">Open the crew app</Link> · <Link to="/ops">Operations</Link></p>
      </main>
    </>
  );
}

/** The road behind the red header. `tall` stretches it down the sign-in header so long phones show the road, not empty red. */
function RouteDoodle({ tall }: { tall?: boolean }) {
  if (tall) {
    return (
      <svg aria-hidden="true" viewBox="0 0 390 600" preserveAspectRatio="xMidYMax slice" className="road-tall">
        <path d="M-20 600 C 70 570, 40 500, 150 470 S 330 440, 300 380 S 210 340, 300 320 S 400 305, 440 290" stroke="#FFFFFF" strokeWidth="30" fill="none" strokeLinecap="round" />
        <path d="M-20 600 C 70 570, 40 500, 150 470 S 330 440, 300 380 S 210 340, 300 320 S 400 305, 440 290" stroke="#B3122E" strokeWidth="3.5" fill="none" strokeDasharray="12 14" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" width="390" height="300" viewBox="0 0 390 300" style={{ position: 'absolute', right: -40, top: 0, opacity: 0.22, pointerEvents: 'none' }}>
      <path d="M-10 250 C 90 240, 120 150, 210 140 S 330 60, 420 20" stroke="#FFFFFF" strokeWidth="22" fill="none" strokeLinecap="round" />
      <path d="M-10 250 C 90 240, 120 150, 210 140 S 330 60, 420 20" stroke="#B3122E" strokeWidth="3" fill="none" strokeDasharray="10 12" />
    </svg>
  );
}

// ------------------------------------------------------------ home
const POPULAR = ['Kumasi', 'Tamale', 'Bolgatanga', 'Wa', 'Takoradi', 'Sunyani', 'Techiman', 'Cape Coast'];

export function Home() {
  const { me } = useMe();
  const { towns, routes } = useNetwork();
  const nav = useNavigate();
  const saved = JSON.parse(store.get('hopon.search') || '{}');
  const [fromId, setFromId] = useState<number | null>(saved.from ?? null);
  const [toId, setToId] = useState<number | null>(saved.to ?? null);
  const [date, setDate] = useState(todayIso());
  const [qty, setQty] = useState(1);
  const [loading, setLoading] = useState<any[]>([]);
  const [next, setNext] = useState<any>(null);
  const [picker, setPicker] = useState<'' | 'from' | 'to'>('');
  const [account, setAccount] = useState(false);

  const accra = towns.find((t) => t.city === 'Accra');
  const from = towns.find((t) => t.id === fromId) || accra;
  const reach = useMemo(() => new Map(routes.filter((r) => r.from.id === from?.id).map((r) => [r.to.id, r])), [routes, from?.id]);
  const to = towns.find((t) => t.id === toId && reach.has(t.id)) || towns.find((t) => t.city === 'Kumasi' && reach.has(t.id)) || towns.find((t) => reach.has(t.id));
  const route = to ? reach.get(to.id) : undefined;
  useEffect(() => { if (from && to) store.set('hopon.search', JSON.stringify({ from: from.id, to: to.id })); }, [from?.id, to?.id]);

  const loadBoard = useCallback(() => { if (from) api(`/terminal-board?from=${from.id}`).then(setLoading).catch(() => {}); }, [from?.id]);
  useEffect(() => { loadBoard(); return live('board', 'board:update', loadBoard); }, [loadBoard]);
  useEffect(() => {
    api<any[]>('/tickets', { who: 'passenger' }).then((t) => setNext(t.find((x) => ['paid', 'checked_in', 'boarded'].includes(x.status)) || null)).catch(() => {});
  }, []);

  const townItem = (t: Town, extra?: Partial<PickItem>): PickItem => ({
    id: t.id, title: t.city, sub: `${t.region}${t.name !== 'VIP station' ? ` · ${t.name} terminal` : ''}`,
    keywords: [...t.aliases, t.region, t.region.replace(' Region', '')], ...extra,
  });
  const fromItems = towns.filter((t) => t.departures > 0).map((t) => townItem(t, { sub: `${t.region} · ${t.departures} destination${t.departures > 1 ? 's' : ''}` }));
  const toItems = towns.filter((t) => t.id !== from?.id).map((t) => {
    const r = reach.get(t.id);
    return townItem(t, r ? { note: `${t.region} · ${r.km} km · ${cedis(r.fare)}` } : { disabled: true, note: `No direct VIP bus from ${from?.city} yet` });
  }).sort((a, b) => Number(!!a.disabled) - Number(!!b.disabled));
  const popularIds = POPULAR.map((c) => towns.find((t) => t.city === c && reach.has(t.id))?.id).filter(Boolean) as number[];

  const swap = () => { if (to && from) { setFromId(to.id); setToId(from.id); } };

  return (
    <>
      <section className="hero home-hero">
        <RouteDoodle />
        <div className="between" style={{ position: 'relative' }}>
          <div className="brand"><Logo />VIP HopOn</div>
          <button className="icb" aria-label="Account" onClick={() => setAccount(true)} style={{ background: '#fff', color: 'var(--r7)', fontWeight: 700 }}>{initials(me?.name || me?.phone)}</button>
        </div>
        <div style={{ marginTop: 24, position: 'relative' }}>
          <span style={{ color: 'var(--r1)', fontSize: 16 }}>Akwaaba{me?.name ? `, ${firstName(me.name)}` : ''}</span>
          <h1 className="disp" style={{ fontSize: 38, marginTop: 8 }}>Where to today?</h1>
        </div>
      </section>

      <main className="page" style={{ marginTop: -76, position: 'relative', gap: 20 }}>
        <form className="card" style={{ padding: '8px 16px 16px', boxShadow: 'var(--sh3)' }} onSubmit={(e) => { e.preventDefault(); if (route) nav(`/board/${route.id}?date=${date}&qty=${qty}`); }}>
          <div style={{ position: 'relative' }}>
            <button type="button" className="od-row" onClick={() => setPicker('from')} aria-label={`From ${from?.city || ''}. Change`}>
              <span className="od-ic"><span className="ring" /></span>
              <span className="od-txt"><span className="lbl">From</span><span className="od-val">{placeName(from) || 'Choose a town'}</span></span>
            </button>
            <span aria-hidden="true" className="od-dots" />
            <div style={{ marginLeft: 36, borderTop: '1px solid var(--ln)' }} />
            <button type="button" className="od-row" onClick={() => setPicker('to')} aria-label={`To ${to?.city || ''}. Change`}>
              <span className="od-ic" style={{ color: 'var(--r7)' }}><Icon n="pin" /></span>
              <span className="od-txt"><span className="lbl">To</span><span className="od-val">{placeName(to) || 'Where are you going?'}</span></span>
            </button>
            <button type="button" className="icb" aria-label="Swap from and to" onClick={swap} style={{ position: 'absolute', right: 0, top: 38, background: '#fff', boxShadow: 'var(--sh2)', color: 'var(--r7)' }}><Icon n="swap" size="s" /></button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, padding: '8px 0 16px' }}>
            <label className="tile-btn">
              <Icon n="cal" size="s" />
              <span className="stack" style={{ gap: 0 }}><span style={{ fontSize: 12, color: 'var(--mut)' }}>Date</span><span style={{ fontSize: 15, fontWeight: 600 }}>{niceDate(date)}</span></span>
              <input type="date" aria-label="Travel date" min={todayIso()} max={addDays(todayIso(), 30)} value={date} onChange={(e) => setDate(e.target.value || todayIso())} />
            </label>
            <label className="tile-btn">
              <Icon n="users" size="s" />
              <span className="stack" style={{ gap: 0 }}><span style={{ fontSize: 12, color: 'var(--mut)' }}>Passengers</span><span style={{ fontSize: 15, fontWeight: 600 }}>{qty} {qty === 1 ? 'adult' : 'adults'}</span></span>
              <select aria-label="Passengers" value={qty} onChange={(e) => setQty(Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} {n === 1 ? 'adult' : 'adults'}</option>)}
              </select>
            </label>
          </div>
          {route && <p className="lbl" style={{ margin: '0 0 12px', textAlign: 'center' }}>{route.km} km · about {hrs(route.hours)} · from {cedis(route.fare)}</p>}
          <button className="btn btn-g" disabled={!route}>{date === todayIso() ? 'Find buses loading now' : 'See open tickets'}<Icon n="arrow" size="s" /></button>
        </form>

        {next && (
          <Link to={`/tickets/${next.id}`} className="card row" style={{ padding: 16, gap: 16, textDecoration: 'none', color: 'var(--ink)' }}>
            <span className="tile" style={{ width: 52, height: 52, borderRadius: 16, background: 'var(--r0)', color: 'var(--r7)' }}><Icon n="ticket" /></span>
            <span className="stack" style={{ gap: 4, flex: 1, minWidth: 0 }}>
              <b style={{ fontSize: 17 }}>{next.route.from.city} to {next.route.to.city}</b>
              <span className="mut" style={{ fontSize: 14 }}>Your next trip: {niceDate(next.date).toLowerCase()}, any VIP bus</span>
              {me?.contacts[0] && <span className="chip ok" style={{ alignSelf: 'flex-start', minHeight: 24, fontSize: 12 }}><Icon n="shield" size="xs" />{firstName(me.contacts[0].name)} gets arrival alerts</span>}
            </span>
            <Icon n="chev" size="s" />
          </Link>
        )}

        <InstallCard app="VIP HopOn" />

        {popularIds.length > 0 && (
          <section className="stack" aria-labelledby="pop-h">
            <h2 id="pop-h" className="h2" style={{ padding: '0 4px' }}>Popular from {from?.city}</h2>
            <div className="popular">
              {popularIds.slice(0, 4).map((id) => {
                const r = reach.get(id)!; const town = towns.find((x) => x.id === id)!;
                return <button key={id} onClick={() => { setToId(id); window.scrollTo({ top: 0, behavior: 'smooth' }); }} aria-label={`Go to ${town.city}, ${cedis(r.fare)}`}><b>{town.city}</b><span>{cedis(r.fare)} · {hrs(r.hours)}</span></button>;
              })}
            </div>
          </section>
        )}

        <section className="stack fill">
          <div className="between" style={{ padding: '0 4px', alignItems: 'baseline' }}>
            <h2 className="h2">Loading at {from?.name === 'VIP station' ? from?.city : from?.name || 'the terminal'} now</h2>
            <span className="live"><i />Live</span>
          </div>
          {loading.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              {loading.map((t) => {
                const left = t.bus.seats - t.filled;
                const pct = Math.round((t.filled / t.bus.seats) * 100);
                const hot = pct > 85;
                return (
                  <Link key={t.id} to={`/board/${t.routeId}`} className="card stack" style={{ padding: 14, gap: 10, textDecoration: 'none', color: 'var(--ink)' }}>
                    <span className="between"><b style={{ fontSize: 15 }}>{t.to.city}</b><span style={{ fontSize: 12, color: 'var(--mut)' }}>Bus {t.bus.number}</span></span>
                    <span className={`bar thin${hot ? ' gold' : ''}`}><span style={{ width: pct + '%' }} /></span>
                    <span style={{ fontSize: 13, color: hot ? 'var(--gi)' : 'var(--ink2)', fontWeight: hot ? 700 : 500 }}>
                      {t.status === 'closed' ? 'Leaving now' : hot ? `Almost full, ${left} left` : <><b>{left}</b> seats left</>}
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="card empty">
              <span className="tile" style={{ background: 'var(--bg)', color: 'var(--mut)' }}><Icon n="bus" /></span>
              <b style={{ fontSize: 16 }}>No bus loading at {from?.city} right now</b>
              <span className="mut" style={{ fontSize: 14, maxWidth: 300 }}>Book an open ticket. This board shows the next bus the moment a conductor opens boarding.</span>
            </div>
          )}
        </section>
      </main>
      <Tabs />
      {picker === 'from' && <PickerSheet title="Leaving from" placeholder="Type your town, e.g. Accra" items={fromItems} value={from?.id}
        popular={towns.filter((t) => ['Accra', 'Kumasi'].includes(t.city)).map((t) => t.id)}
        onPick={(it) => setFromId(Number(it.id))} onClose={() => setPicker('')} />}
      {picker === 'to' && <PickerSheet title="Going to" placeholder="Type a town, region or nickname (Bolga, Tadi)" items={toItems} value={to?.id}
        popular={popularIds} onPick={(it) => setToId(Number(it.id))} onClose={() => setPicker('')}
        empty={(q) => <div className="card pad stack"><b>No VIP town called "{q}"</b><span className="mut" style={{ fontSize: 14 }}>Try the nearest big town or the region name. VIP serves {towns.length} towns.</span></div>} />}
      {account && <Account onClose={() => setAccount(false)} />}
    </>
  );
}

function Account({ onClose }: { onClose: () => void }) {
  const { me, reload, signOut } = useMe();
  const [name, setName] = useState(me?.name || '');
  const [c, setC] = useState({ name: '', phone: '' });
  const a = useAction();
  if (!me) return null;
  return (
    <Sheet onClose={onClose} label="Account">
      <h2 className="h2">Your account</h2>
      <p className="mut" style={{ margin: 0 }}>{prettyPhone(me.phone)} · Travel credit <b>{cedis(me.credit)}</b></p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); a.run(async () => { await api('/me', { method: 'PUT', body: { name }, who: 'passenger' }); await reload(); }); }}>
        <label className="field" style={{ flex: 1 }}><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <button className="btn btn-o btn-sm" style={{ alignSelf: 'flex-end', height: 52 }}>Save</button>
      </form>
      <h3 className="h2" style={{ fontSize: 17 }}>Emergency contacts</h3>
      <p className="lbl" style={{ margin: 0 }}>They get a text with a live tracking link when your bus leaves, and another when you arrive.</p>
      <div className="card list" style={{ boxShadow: 'inset 0 0 0 1.5px var(--ln2)' }}>
        {me.contacts.map((x) => (
          <div key={x.id} className="li"><Icon n="shield" size="s" /><span style={{ flex: 1 }}><b>{x.name}</b><br /><span className="lbl">{prettyPhone(x.phone)}</span></span>
            <button className="icb" aria-label={`Remove ${x.name}`} onClick={() => a.run(async () => { await api(`/me/contacts/${x.id}`, { method: 'DELETE', who: 'passenger' }); await reload(); })}><Icon n="trash" size="s" /></button></div>
        ))}
        {!me.contacts.length && <div className="li mut">No contacts yet.</div>}
      </div>
      {me.contacts.length < 3 && (
        <form className="stack" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); a.run(async () => { await api('/me/contacts', { body: c, who: 'passenger' }); setC({ name: '', phone: '' }); await reload(); }); }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input className="input" aria-label="Contact name" placeholder="Name, e.g. Mum" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} required />
            <input className="input" aria-label="Contact phone" inputMode="tel" placeholder="020 000 0000" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} required />
          </div>
          <button className="btn btn-o"><Icon n="plus" size="s" />Add contact</button>
        </form>
      )}
      <Err e={a.error} />
      <button className="btn btn-t" onClick={() => { signOut(); onClose(); }}><Icon n="logout" size="s" />Sign out</button>
    </Sheet>
  );
}

// ------------------------------------------------------------ loading board
function SeatMap({ seats, filled }: { seats: number; filled: number }) {
  const cols = Math.max(2, Math.ceil((seats - 2) / 4) + 1);
  const cells: { col: number; row: number; on: boolean }[] = [];
  let n = 0;
  for (let col = 1; col <= cols && n < seats; col++) {
    const rows = col === cols ? [1, 2, 4, 5].slice(0, seats - n) : [1, 2, 4, 5];
    for (const row of rows) { if (n >= seats) break; cells.push({ col, row, on: n < filled }); n++; }
  }
  return (
    <div role="img" aria-label={`${filled} of ${seats} seats taken`} className="seatmap">
      <span aria-hidden="true" className="wheel" />
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: 'repeat(2, 22px) 14px repeat(2, 22px)', gap: 5 }}>
        {cells.map((c, i) => <span key={i} className={`seat${c.on ? ' on' : ''}`} style={{ gridColumn: c.col, gridRow: c.row }} />)}
      </div>
    </div>
  );
}

export function Board() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const { me } = useMe();
  const nav = useNavigate();
  const [board, setBoard] = useState<any>(null);
  const [book, setBook] = useState(false);
  const date = sp.get('date') || todayIso();
  const qty = Number(sp.get('qty') || 1);
  const [names, setNames] = useState<string[]>(() => Array.from({ length: qty }, (_, i) => (i === 0 ? me?.name || '' : '')));
  const [useCredit, setUseCredit] = useState(true);
  const a = useAction();

  const load = useCallback(() => { api(`/board?route=${id}`).then(setBoard).catch(a.setError); }, [id]);
  useEffect(() => { load(); return live('board', 'board:update', (d) => (!d.routeId || String(d.routeId) === id) && load()); }, [load, id]);
  if (!board) return <main className="page"><Err e={a.error} /></main>;

  const today = date === todayIso();
  const [cur, ...others] = board.trips;
  const total = board.route.fare * names.length;
  const credit = useCredit ? Math.min(me?.credit || 0, total) : 0;
  const create = () => a.run(async () => {
    const r = await api('/bookings', { body: { routeId: board.route.id, date, names, useCredit }, who: 'passenger' });
    if (r.paid) nav(`/tickets?paid=${r.bookingId}`);
    else if (r.checkoutUrl.startsWith('/')) nav(r.checkoutUrl);
    else window.location.href = r.checkoutUrl;
  });
  const startBooking = () => (names.length === 1 && names[0].trim() ? create() : setBook(true));
  const fromName = board.route.from.name === 'VIP station' ? board.route.from.city : board.route.from.name;

  return (
    <>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 16px 16px' }}>
        <BackBtn to="/" label="Back to Home" />
        <div className="stack" style={{ gap: 2, minWidth: 0 }}>
          <h1 className="od-title">{board.route.from.city}<Icon n="arrow" size="s" label="to" />{board.route.to.city}</h1>
          <span style={{ fontSize: 14, color: 'var(--mut)' }}>{today ? `Today from ${fromName}. Buses leave when full.` : `${niceDate(date)} · any VIP bus that day`}</span>
        </div>
      </header>

      <main className="page" style={{ paddingTop: 0 }}>
        {today && cur ? (
          <section className="card stack" style={{ padding: 20, gap: 20 }} aria-labelledby="loading-now">
            <div className="row">
              <span className="tile" style={{ width: 48, height: 48, background: 'var(--r7)', color: '#fff' }}><Icon n="bus" /></span>
              <div className="stack" style={{ flex: 1, gap: 2 }}>
                <h2 id="loading-now" className="h2">Bus {cur.bus.number}</h2>
                <span style={{ fontSize: 14, color: 'var(--mut)' }}>{cur.bus.plate} · loading since {timeOf(cur.openedAt)}</span>
              </div>
              <span className="chip warn"><span className="dot-pulse" />{cur.status === 'closed' ? 'Leaving' : 'Boarding'}</span>
            </div>
            <SeatMap seats={cur.bus.seats} filled={cur.filled} />
            <div className="between" style={{ alignItems: 'flex-end' }}>
              <div className="stack" style={{ gap: 4 }}>
                <span className="disp" style={{ fontSize: 44, lineHeight: 1 }}>{cur.bus.seats - cur.filled}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink2)' }}>seats left of {cur.bus.seats}</span>
              </div>
              <div className="stack" style={{ gap: 6, alignItems: 'flex-end' }}>
                <span className="row" style={{ gap: 6, fontSize: 13, color: 'var(--mut)' }}><i className="key on" />Taken<i className="key" style={{ marginLeft: 8 }} />Free</span>
                <span className="row" style={{ gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--ink2)' }}><Icon n="clock" size="xs" />{cur.status === 'closed' ? 'Leaving now' : `Leaves in about ${Math.max(2, Math.round((cur.bus.seats - cur.filled) * 1.2))} min`}</span>
              </div>
            </div>
          </section>
        ) : today ? (
          <section className="card empty">
            <span className="tile" style={{ background: 'var(--bg)', color: 'var(--mut)' }}><Icon n="bus" /></span>
            <b style={{ fontSize: 17 }}>No bus loading yet</b>
            <span className="mut" style={{ fontSize: 14 }}>VIP buses leave when full. This board updates the moment a conductor opens boarding, so you can leave home at the right time.</span>
          </section>
        ) : (
          <section className="card pad stack" style={{ gap: 10 }}>
            <span className="chip ok" style={{ alignSelf: 'flex-start' }}><Icon n="ticket" size="xs" />Open ticket</span>
            <b style={{ fontSize: 17 }}>Valid on any VIP bus to {board.route.to.city} on {niceDate(date)}</b>
            <span className="mut" style={{ fontSize: 14 }}>No fixed departure time. On the day, this board shows which bus is loading and how many seats are left.</span>
          </section>
        )}

        <div className="okbox row" style={{ fontWeight: 500, gap: 12 }}>
          <Icon n="shield" size="s" />
          <span style={{ lineHeight: 1.45 }}>App tickets board first. If {cur ? `Bus ${cur.bus.number}` : 'a bus'} fills, your ticket works on the next one.</span>
        </div>

        {today && others.map((t: any) => (
          <section key={t.id} className="card row" style={{ padding: '14px 16px' }}>
            <span className="tile" style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--bg)', color: 'var(--mut)' }}><Icon n="bus" size="s" /></span>
            <div className="stack" style={{ flex: 1, gap: 2 }}><b style={{ fontSize: 15 }}>Bus {t.bus.number} is also loading</b><span style={{ fontSize: 13, color: 'var(--mut)' }}>{t.bus.seats - t.filled} seats left</span></div>
          </section>
        ))}
        {today && board.queue > 0 && <p className="lbl" style={{ margin: '0 4px' }}>{board.queue} app passenger{board.queue > 1 ? 's' : ''} checked in and waiting · {board.onRoad} bus{board.onRoad === 1 ? '' : 'es'} on the road</p>}

        <section aria-label="Trip facts" className="card facts push-down">
          <span><Icon n="snow" size="s" />Air-conditioned</span>
          <span><Icon n="nav" size="s" />{board.route.km} km</span>
          <span><Icon n="clock" size="s" />About {hrs(board.route.hours)}</span>
        </section>
        <Err e={a.error} />
      </main>

      <footer className="paybar">
        <div className="stack" style={{ gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 13, color: 'var(--mut)' }}>{names.length} adult{names.length > 1 ? 's' : ''}, any bus {today ? 'today' : niceDate(date)}</span>
          <span className="disp" style={{ fontSize: 22 }}>{cedis(total)}</span>
        </div>
        <button className="btn btn-g" style={{ flex: 1 }} disabled={a.busy} onClick={startBooking}>Book this trip</button>
      </footer>

      {book && (
        <Sheet onClose={() => setBook(false)} label="Passenger details">
          <h2 className="h2">Who is travelling?</h2>
          {names.map((n, i) => (
            <label key={i} className="field"><span>Passenger {i + 1} full name</span>
              <input className="input" value={n} onChange={(e) => setNames(names.map((x, j) => (j === i ? e.target.value : x)))} placeholder="Name on the ticket" /></label>
          ))}
          {(me?.credit || 0) > 0 && (
            <label className="row" style={{ minHeight: 44 }}><input type="checkbox" checked={useCredit} onChange={(e) => setUseCredit(e.target.checked)} style={{ width: 22, height: 22 }} />
              Use my travel credit ({cedis(me!.credit)})</label>
          )}
          <div className="between"><span className="mut">To pay</span><b style={{ fontSize: 22 }}>{cedis(total - credit)}</b></div>
          <Err e={a.error} />
          <button className="btn btn-g" disabled={a.busy || names.some((n) => !n.trim())} onClick={create}>{total - credit === 0 ? 'Get tickets with credit' : 'Continue to checkout'}</button>
          <p className="lbl" style={{ margin: 0 }}>Places are held for 15 minutes while you pay.</p>
        </Sheet>
      )}
    </>
  );
}

// ------------------------------------------------------------ checkout (test mode stands in for Hubtel)
export function Pay() {
  const { id } = useParams();
  const nav = useNavigate();
  const [b, setB] = useState<any>(null);
  const [method, setMethod] = useState<string>('mtn');
  const [wallet, setWallet] = useState('');
  const [pending, setPending] = useState(false);
  const a = useAction();
  const { routes } = useNetwork();
  const testMode = useTestMode();
  useEffect(() => { api(`/bookings/${id}`, { who: 'passenger' }).then((x) => { setB(x); setWallet(prettyPhone(x.phone)); }).catch(a.setError); }, [id]);
  if (!b) return <main className="page"><Err e={a.error} /></main>;
  if (b.status === 'paid') return <Navigate to={`/tickets?paid=${b.id}`} replace />;
  const m = PAY_METHODS.find((x) => x.id === method)!;
  const route = routes.find((r) => r.label === b.route);
  const finish = (outcome: 'approve' | 'decline') => a.run(async () => {
    await api('/hubtel/mock/pay', { body: { bookingId: b.id, method, outcome, phone: wallet }, who: 'passenger' });
    nav(`/tickets?paid=${b.id}`, { replace: true });
  });
  const fare = b.amount + b.creditUsed;

  return (
    <>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 16px 16px' }}>
        <BackBtn label="Back" />
        <h1 className="disp" style={{ fontSize: 26 }}>Checkout</h1>
      </header>
      <main className="page" style={{ paddingTop: 0, gap: 12 }}>
        <section className="card row" aria-label="Trip" style={{ padding: '14px 16px', gap: 14, alignItems: 'stretch' }}>
          <div aria-hidden="true" className="stack" style={{ alignItems: 'center', padding: '6px 0', gap: 0 }}>
            <span className="ring" /><span style={{ flex: 1, borderLeft: '2px dotted var(--ln2)', margin: '4px 0' }} /><span style={{ color: 'var(--r7)' }}><Icon n="pin" size="s" /></span>
          </div>
          <div className="stack" style={{ flex: 1, gap: 14 }}>
            <div className="stack" style={{ gap: 0 }}><b style={{ fontSize: 16 }}>{placeName(route?.from) || b.route.split(' to ')[0]}</b><span className="lbl">Board any VIP bus</span></div>
            <div className="stack" style={{ gap: 0 }}><b style={{ fontSize: 16 }}>{placeName(route?.to) || b.route.split(' to ')[1]}</b><span className="lbl">{route ? `About ${hrs(route.hours)} · ${route.km} km` : ''}</span></div>
          </div>
          <div className="stack" style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <span className="chip dim" style={{ fontSize: 12 }}>{niceDate(b.date).split(',')[0]}</span>
            <span className="lbl">{b.qty} ticket{b.qty > 1 ? 's' : ''}</span>
          </div>
        </section>

        <section className="card" aria-labelledby="payhow" style={{ padding: '8px 16px 16px' }}>
          <h2 id="payhow" style={{ margin: 0, padding: '10px 0 6px', fontSize: 15, fontWeight: 700 }}>Pay with</h2>
          <div role="radiogroup" aria-labelledby="payhow">
            {PAY_METHODS.map((x) => (
              <button key={x.id} type="button" role="radio" aria-checked={method === x.id} onClick={() => setMethod(x.id)} className="pay-opt">
                <x.Logo size={44} />
                <span className="stack" style={{ flex: 1, gap: 0, textAlign: 'left' }}><span style={{ fontSize: 16, fontWeight: 600 }}>{x.label}</span><span style={{ fontSize: 12, color: 'var(--mut)' }}>{x.sub}</span></span>
                <span className={`radio${method === x.id ? ' on' : ''}`}><i /></span>
              </button>
            ))}
          </div>
          {m.momo && (
            <label className="stack" style={{ gap: 6, paddingTop: 12 }}>
              <span className="lbl">Wallet number</span>
              <span className="input-wrap"><Icon n="phone" size="s" /><input inputMode="tel" value={wallet} onChange={(e) => setWallet(e.target.value)} aria-label="Wallet number" /></span>
            </label>
          )}
        </section>

        <section aria-label="Price" className="stack" style={{ padding: '0 4px', gap: 8, fontSize: 14 }}>
          <div className="between" style={{ color: 'var(--ink2)' }}><span>Fare, {b.qty} adult{b.qty > 1 ? 's' : ''}</span><span>{cedis(fare)}</span></div>
          {b.creditUsed > 0 && <div className="between" style={{ color: 'var(--oki)' }}><span>Travel credit</span><span>−{cedis(b.creditUsed)}</span></div>}
          <div className="between" style={{ color: 'var(--ink2)' }}><span>Booking fee</span><span>GH₵0</span></div>
          <div className="between" style={{ fontWeight: 700, fontSize: 16, paddingTop: 8, borderTop: '1px dashed var(--ln2)' }}><span>Total</span><span>{cedis(b.amount)}</span></div>
        </section>
        <div className="note" style={{ fontSize: 13 }}><b>Test mode.</b> No money moves until VIP's Hubtel account is connected.</div>
        <Err e={a.error} />
      </main>

      <footer className="paybar" style={{ flexDirection: 'column', gap: 10, alignItems: 'stretch' }}>
        <button className="btn btn-g" onClick={() => setPending(true)}><Icon n="lock" size="s" />Pay {cedis(b.amount)}</button>
        <span style={{ textAlign: 'center', fontSize: 12, color: 'var(--mut)' }}>Secure payment by Hubtel. Price locked when you pay.</span>
      </footer>

      {pending && (
        <Sheet onClose={() => setPending(false)} label={m.momo ? 'Approve on your phone' : 'Confirm card payment'}>
          <div className="stack" style={{ alignItems: 'center', textAlign: 'center', gap: 16 }}>
            <span className="spinner"><svg width="88" height="88" viewBox="0 0 88 88" aria-hidden="true"><circle cx="44" cy="44" r="40" fill="none" stroke="#FCEBEE" strokeWidth="6" /><path d="M44 4a40 40 0 0 1 40 40" fill="none" stroke="#B3122E" strokeWidth="6" strokeLinecap="round" /></svg><span className="spinner-logo"><m.Logo size={44} /></span></span>
            <h2 className="h2" style={{ fontSize: 24 }}>{m.momo ? 'Approve on your phone' : 'Confirm with your bank'}</h2>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: 'var(--ink2)', maxWidth: 300 }}>{m.momo
              ? <>A {m.label} prompt for {cedis(b.amount)} is on {wallet}. Enter your PIN to finish.</>
              : <>Hubtel's secure card page asks your bank to confirm {cedis(b.amount)}.</>}</p>
            <Err e={a.error} />
            <button className="btn btn-g" disabled={a.busy} onClick={() => finish('approve')}>I've approved it</button>
            <button className="btn btn-t" onClick={() => setPending(false)}>Use another method</button>
            {testMode && <button className="btn btn-t" style={{ color: 'var(--mut)', fontSize: 13, minHeight: 36 }} disabled={a.busy} onClick={() => finish('decline')}>Test mode: simulate a declined payment</button>}
          </div>
        </Sheet>
      )}
    </>
  );
}

// ------------------------------------------------------------ tickets
const statusChip: Record<string, [string, string]> = {
  paid: ['ok', 'Paid'], checked_in: ['ok', 'Checked in'], boarded: ['warn', 'On the bus'],
  completed: ['dim', 'Trip done'], cancelled: ['dim', 'Cancelled'], credited: ['dim', 'Turned into credit'],
};

export function Tickets() {
  const [sp] = useSearchParams();
  const [list, setList] = useState<any[] | null>(null);
  useEffect(() => { api('/tickets', { who: 'passenger' }).then(setList).catch(() => setList([])); }, []);
  const active = (list || []).filter((t) => ['paid', 'checked_in', 'boarded'].includes(t.status));
  const past = (list || []).filter((t) => !['paid', 'checked_in', 'boarded'].includes(t.status));
  return (
    <>
      <header style={{ padding: '20px 20px 4px' }}><h1 className="disp" style={{ fontSize: 30 }}>My tickets</h1></header>
      <main className="page">
        {sp.get('paid') && <div className="okbox row" role="status"><Icon n="check" size="s" />Payment confirmed. Your ticket is below and a copy is on its way by SMS.</div>}
        {list && !list.length && (
          <div className="card empty">
            <span className="tile" style={{ background: 'var(--r0)', color: 'var(--r7)' }}><Icon n="ticket" /></span>
            <b style={{ fontSize: 17 }}>No tickets yet</b>
            <span className="mut" style={{ fontSize: 14, maxWidth: 280 }}>Book an open ticket and it appears here, with a QR code that works without data.</span>
            <Link className="btn btn-g" to="/" style={{ maxWidth: 280, marginTop: 6 }}>Book a trip</Link>
          </div>
        )}
        {[['Upcoming', active], ['Past', past]].map(([h, ts]: any) => ts.length > 0 && (
          <section key={h} className="stack">
            <h2 className="h2">{h}</h2>
            {ts.map((t: any) => (
              <Link key={t.id} to={`/tickets/${t.id}`} className="card tk-row" aria-label={`${t.route.from.city} to ${t.route.to.city}, ${t.name}, ${niceDate(t.date)}, ${statusChip[t.status][1]}`}>
                <span className="stack" style={{ gap: 0 }}><span className="disp" style={{ fontSize: 22 }}>{townCode(t.route.from.city)}</span><span className="lbl">{t.route.from.city}</span></span>
                <span className="tk-line" aria-hidden="true"><i /><Icon n="bus" size="xs" /><i /></span>
                <span className="stack" style={{ gap: 0, alignItems: 'flex-end' }}><span className="disp" style={{ fontSize: 22 }}>{townCode(t.route.to.city)}</span><span className="lbl">{t.route.to.city}</span></span>
                <span className="between" style={{ gridColumn: '1 / -1', borderTop: '1px dashed var(--ln2)', paddingTop: 10 }}>
                  <span style={{ fontSize: 14 }}><b>{t.name}</b> · {niceDate(t.date)}</span>
                  <span className={`chip ${statusChip[t.status][0]}`}>{statusChip[t.status][1]}</span>
                </span>
              </Link>
            ))}
          </section>
        ))}
      </main>
      <Tabs />
    </>
  );
}

export function TicketDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [t, setT] = useState<any>(null);
  const [qr, setQr] = useState('');
  const [bus, setBus] = useState<any>(null);
  const [sheet, setSheet] = useState<'' | 'change' | 'cancel' | 'share'>('');
  const [newDate, setNewDate] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [msg, setMsg] = useState('');
  const testMode = useTestMode();
  const a = useAction();
  const load = useCallback(() => api(`/tickets/${id}`, { who: 'passenger' }).then((x) => {
    setT(x); store.set(`hopon.ticket.${x.id}`, JSON.stringify(x));
  }).catch((e) => {
    const cached = store.get(`hopon.ticket.${id}`);
    if (cached) setT(JSON.parse(cached)); else a.setError(e);
  }), [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (t?.qr) QRCode.toDataURL(t.qr, { margin: 0, width: 520, errorCorrectionLevel: 'H', color: { dark: '#1F1416', light: '#FFFFFF' } }).then(setQr); }, [t?.qr]);
  useEffect(() => { if (t?.trip?.id) return live(`trip:${t.trip.id}`, 'trip:update', () => load()); }, [t?.trip?.id]);
  // Which bus is loading for this route right now (shown above "I'm at the terminal").
  useEffect(() => {
    if (!t || !['paid', 'checked_in'].includes(t.status) || t.date !== todayIso()) return;
    const f = () => api(`/board?route=${t.route.id}`).then((b) => setBus(b.trips.find((x: any) => x.status === 'loading') || null)).catch(() => {});
    f(); return live('board', 'board:update', f);
  }, [t?.id, t?.status]);
  if (!t) return <main className="page"><Err e={a.error} /></main>;
  const usable = ['paid', 'checked_in'].includes(t.status);
  const today = t.date === todayIso();
  const checkin = (demo = false) => a.run(async () => {
    let body: any = { demo };
    if (!demo) {
      const pos = await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation
        ? navigator.geolocation.getCurrentPosition(res, () => rej(new Error('Location is off. Turn it on, or ask the conductor to scan you at the gate.')), { enableHighAccuracy: true, timeout: 10000 })
        : rej(new Error('This browser cannot share location.')));
      body = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    }
    setT(await api(`/tickets/${t.id}/checkin`, { body, who: 'passenger' }));
  });
  const share = () => a.run(async () => {
    if (!t.trip) {
      const text = `My VIP ticket ${t.code}: ${t.route.from.city} to ${t.route.to.city}, ${niceDate(t.date)}.`;
      if (navigator.share) await navigator.share({ title: 'VIP HopOn ticket', text }).catch(() => {});
      else { await navigator.clipboard?.writeText(text); setMsg('Ticket details copied.'); }
      return;
    }
    const r = await api(`/tickets/${t.id}/share`, { body: {}, who: 'passenger' }); setShareUrl(r.url); setSheet('share');
  });

  return (
    <div className="ticket-page">
      <header className="between" style={{ padding: '16px 16px 12px', color: '#fff' }}>
        <BackBtn to="/tickets" label="Back to tickets" light />
        <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Your ticket</h1>
        <button className="icb" aria-label={t.trip ? 'Share my trip' : 'Share ticket'} onClick={share} style={{ background: 'rgba(255,255,255,.14)', color: '#fff' }}><Icon n="share" size="s" /></button>
      </header>

      <article aria-label={`Ticket, ${t.route.from.city} to ${t.route.to.city}`} className="ticket">
        <div className="stack" style={{ padding: '20px 22px 18px', gap: 16 }}>
          <div className="between">
            <span className="row" style={{ gap: 8, fontSize: 13, fontWeight: 700, color: 'var(--r7)' }}><Logo size={22} />VIP HopOn</span>
            <span className={`chip ${statusChip[t.status][0]}`} style={{ minHeight: 26, fontSize: 12 }}>{t.status === 'paid' && <Icon n="check" size="xs" />}{statusChip[t.status][1]}</span>
          </div>
          <div className="between" style={{ alignItems: 'flex-end', gap: 8 }}>
            <div className="stack" style={{ gap: 2 }}><span className="disp" style={{ fontSize: 32 }}>{townCode(t.route.from.city)}</span><span className="lbl">{placeName(t.route.from)}</span></div>
            <div aria-hidden="true" className="row" style={{ flex: 1, gap: 6, paddingBottom: 24, color: 'var(--r7)' }}><span style={{ flex: 1, borderTop: '2px dotted var(--ln2)' }} /><Icon n="bus" size="s" /><span style={{ flex: 1, borderTop: '2px dotted var(--ln2)' }} /></div>
            <div className="stack" style={{ gap: 2, alignItems: 'flex-end' }}><span className="disp" style={{ fontSize: 32 }}>{townCode(t.route.to.city)}</span><span className="lbl" style={{ textAlign: 'right' }}>{placeName(t.route.to)}</span></div>
          </div>
          <div className="tk-facts">
            <div><span>Date</span><b>{niceDate(t.date).replace('Today, ', '').replace('Tomorrow, ', '')}</b></div>
            <div><span>Passenger</span><b>{t.name}</b></div>
            <div><span>Bus</span><b>{t.trip ? `Bus ${t.trip.bus.number}` : 'Any VIP'}</b></div>
          </div>
        </div>
        <div aria-hidden="true" className="perf"><i /><i /></div>
        <div className="stack" style={{ padding: 20, alignItems: 'center', gap: 10 }}>
          {usable ? (
            <>
              <div className="qr-wrap">{qr && <img src={qr} alt={`QR code for ticket ${t.code}`} />}<span className="qr-logo"><Logo size={26} /></span></div>
              <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: 2 }}>{t.code}</span>
              <span className="row" style={{ gap: 6, fontSize: 13, color: 'var(--oki)', fontWeight: 600 }}><Icon n="shield" size="xs" />Signed for {t.name}</span>
              <span className="row" style={{ gap: 6, fontSize: 13, color: 'var(--mut)' }}><Icon n="wifioff" size="xs" />Works offline. Scans once at the door.</span>
            </>
          ) : t.trip ? (
            <div className="stack" style={{ alignItems: 'center', gap: 6, padding: '8px 0' }}>
              <span className="tile" style={{ width: 56, height: 56, borderRadius: 28, background: 'var(--ok)', color: '#fff' }}><Icon n="check" size="l" /></span>
              <b>{t.status === 'completed' ? 'Trip completed' : `Boarded Bus ${t.trip.bus.number}`}</b>
              <span className="lbl">Scanned at {timeOf(t.trip.boardedAt)} · {t.code}</span>
            </div>
          ) : <span className="mut">{statusChip[t.status][1]} · {t.code}</span>}
        </div>
      </article>

      <div className="stack" style={{ padding: '16px 20px 32px', gap: 10, flex: 1, justifyContent: 'flex-end' }}>
        <Err e={a.error} />
        {msg && <div className="okbox" role="status">{msg}</div>}
        {t.status === 'paid' && today && <>
          {bus && <Link to={`/board/${t.route.id}`} className="glass-row"><span className="dot-pulse gold" /><span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>Bus {bus.bus.number} is loading, {bus.bus.seats - bus.filled} seats left</span><Icon n="chev" size="s" /></Link>}
          <button className="btn btn-g" disabled={a.busy} onClick={() => checkin(false)}><Icon n="pin" size="s" />I'm at the terminal</button>
          {testMode && <button className="btn btn-t" style={{ color: '#fff', minHeight: 40, fontSize: 14 }} disabled={a.busy} onClick={() => checkin(true)}>Test mode: check in without location</button>}
        </>}
        {t.status === 'checked_in' && (
          <div className="row card" style={{ padding: '14px 16px', borderRadius: 18 }}>
            <span className="tile" style={{ background: 'var(--ok)', color: '#fff', borderRadius: 22 }}><Icon n="check" /></span>
            <div className="stack" style={{ gap: 2 }}><b style={{ fontSize: 16 }}>You're checked in</b><span style={{ fontSize: 14, color: 'var(--ink2)' }}>{bus ? `Board Bus ${bus.bus.number} ahead of the queue.` : 'Board the next loading bus ahead of the queue.'}</span></div>
          </div>
        )}
        {t.trip && t.trip.status !== 'arrived' && <button className="btn btn-g" onClick={() => nav(`/trip/${t.id}`)}>Follow my trip live<Icon n="arrow" size="s" /></button>}
        {usable && (
          <div className="row" style={{ justifyContent: 'center', gap: 4 }}>
            <button className="btn btn-t" style={{ color: '#fff', width: 'auto', fontSize: 15 }} onClick={() => { setNewDate(addDays(t.date < todayIso() ? todayIso() : t.date, 1)); setSheet('change'); }}><Icon n="cal" size="xs" />Change date</button>
            <span aria-hidden="true" style={{ color: 'rgba(255,255,255,.4)' }}>·</span>
            <button className="btn btn-t" style={{ color: '#fff', width: 'auto', fontSize: 15 }} onClick={() => setSheet('cancel')}><Icon n="x" size="xs" />Cancel ticket</button>
          </div>
        )}
      </div>

      {sheet === 'change' && (
        <Sheet onClose={() => setSheet('')} label="Change date">
          <h2 className="h2">Change travel date</h2>
          <label className="field"><span>New date</span><input className="input" type="date" min={todayIso()} max={addDays(todayIso(), 30)} value={newDate} onChange={(e) => setNewDate(e.target.value)} /></label>
          <p className="mut" style={{ margin: 0 }}>{t.dateChanges === 0 ? 'Your first change is free.' : 'This change costs GH₵5 (test mode: recorded, not charged).'} Your QR code updates.</p>
          <Err e={a.error} />
          <button className="btn btn-g" disabled={a.busy || !newDate} onClick={() => a.run(async () => { const r = await api(`/tickets/${t.id}/change-date`, { body: { date: newDate }, who: 'passenger' }); setT(r.ticket); setSheet(''); setMsg(`Moved to ${niceDate(newDate)}.`); })}>Move to {newDate ? niceDate(newDate) : '…'}</button>
        </Sheet>
      )}
      {sheet === 'cancel' && (
        <Sheet onClose={() => setSheet('')} label="Cancel ticket">
          <h2 className="h2">Cancel this ticket?</h2>
          <p className="mut" style={{ margin: 0 }}>{t.date > todayIso()
            ? `You get ${cedis(Math.round(t.price * 0.9))} back to the wallet or card you paid with (10% covers payment fees).`
            : `It's your travel date, so the full ${cedis(t.price)} becomes travel credit for 30 days.`}</p>
          <Err e={a.error} />
          <button className="btn btn-r" disabled={a.busy} onClick={() => a.run(async () => { const r = await api(`/tickets/${t.id}/cancel`, { body: {}, who: 'passenger' }); setSheet(''); setMsg(r.kind === 'wallet' ? `${cedis(r.amount)} refund on its way.` : `${cedis(r.amount)} added as travel credit.`); load(); })}>Yes, cancel</button>
          <button className="btn btn-o" onClick={() => setSheet('')}>Keep my ticket</button>
        </Sheet>
      )}
      {sheet === 'share' && <ShareSheet url={shareUrl} name={t.name} onClose={() => setSheet('')} />}
    </div>
  );
}

function ShareSheet({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `Follow ${firstName(name)}'s VIP bus live: ${url}`;
  return (
    <Sheet onClose={onClose} label="Share my trip">
      <h2 className="h2">Share my trip</h2>
      <p className="mut" style={{ margin: 0 }}>Anyone with this link sees your bus on a map, with no app needed. It stops working when the trip ends.</p>
      <input className="input" readOnly value={url} aria-label="Tracking link" onFocus={(e) => e.target.select()} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <a className="btn btn-r" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">WhatsApp</a>
        <a className="btn btn-o" href={`sms:?&body=${encodeURIComponent(text)}`}>SMS</a>
      </div>
      <button className="btn btn-t" onClick={() => { navigator.clipboard?.writeText(url).then(() => setCopied(true)); }}>{copied ? 'Copied' : 'Copy link'}</button>
    </Sheet>
  );
}

// ------------------------------------------------------------ live trip
export function LiveTripIndex() {
  const [list, setList] = useState<any[] | null>(null);
  useEffect(() => { api('/tickets', { who: 'passenger' }).then(setList).catch(() => setList([])); }, []);
  const onTrip = (list || []).find((t) => t.status === 'boarded' && t.trip);
  if (onTrip) return <Navigate to={`/trip/${onTrip.id}`} replace />;
  return (
    <>
      <header style={{ padding: '20px 20px 4px' }}><h1 className="disp" style={{ fontSize: 30 }}>Live trip</h1></header>
      <main className="page">{list && (
        <div className="card empty">
          <span className="tile" style={{ background: 'var(--r0)', color: 'var(--r7)' }}><Icon n="nav" /></span>
          <b style={{ fontSize: 17 }}>No trip in progress</b>
          <span className="mut" style={{ fontSize: 14 }}>Your live map appears here once the conductor scans your ticket on the bus.</span>
        </div>)}
      </main>
      <Tabs />
    </>
  );
}

export function LiveTrip() {
  const { id } = useParams();
  const { me } = useMe();
  const [t, setT] = useState<any>(null);
  const [trip, setTrip] = useState<any>(null);
  const [shareUrl, setShareUrl] = useState('');
  const [showShare, setShowShare] = useState(false);
  const a = useAction();
  useEffect(() => { api(`/tickets/${id}`, { who: 'passenger' }).then(setT).catch(a.setError); }, [id]);
  useEffect(() => {
    if (!t?.trip?.id) return;
    api(`/tickets/${t.id}/share`, { body: {}, who: 'passenger' }).then((r) => { setShareUrl(r.url); api(`/track/${r.token}`).then(setTrip); });
    return live(`trip:${t.trip.id}`, 'trip:update', setTrip);
  }, [t?.trip?.id]);
  if (!trip) return <main className="page"><Err e={a.error} /></main>;
  const watchers = me?.contacts || [];
  return (
    <>
      <TripView trip={trip} back={`/tickets/${id}`}>
        {trip.status !== 'arrived' && (watchers.length
          ? <div className="row" style={{ gap: 12, marginTop: 'auto' }}>
              <span className="row" style={{ gap: 0 }}>{watchers.slice(0, 3).map((c, i) => <span key={c.id} className="ava" style={{ marginLeft: i ? -8 : 0, background: ['#F2B227', 'var(--r1)', 'var(--ok0)'][i] }}>{initials(c.name)}</span>)}</span>
              <span style={{ flex: 1, fontSize: 14, lineHeight: 1.4, color: 'var(--ink2)' }}><b>{watchers.map((c) => firstName(c.name)).join(' and ')}</b> {watchers.length > 1 ? 'get' : 'gets'} a text when you arrive.</span>
            </div>
          : null)}
        {trip.status !== 'arrived' && <button className="btn btn-g" onClick={() => setShowShare(true)} disabled={!shareUrl}><Icon n="share" size="s" />Share my trip</button>}
      </TripView>
      {showShare && shareUrl && <ShareSheet url={shareUrl} name={t?.name} onClose={() => setShowShare(false)} />}
    </>
  );
}

/** Full-screen live trip, as in the "5 Live trip" design: map on top, details sheet below. */
export function TripView({ trip, traveller, back, children }: { trip: any; traveller?: string; back?: string; children?: ReactNode }) {
  const [now, setNow] = useState(Date.now());
  const [centre, setCentre] = useState(0);
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);

  if (trip.status === 'arrived') {
    return (
      <main className="page" style={{ justifyContent: 'center' }}>
        <div className="card pad stack" style={{ alignItems: 'center', textAlign: 'center', padding: 32 }}>
          <span className="tile" style={{ width: 72, height: 72, borderRadius: 36, background: 'var(--ok)', color: '#fff' }}><Icon n="check" size="l" /></span>
          <h1 className="disp" style={{ fontSize: 32 }}>{traveller ? `${traveller} arrived safely` : 'Arrived safely'}</h1>
          <p className="mut" style={{ margin: 0 }}>{trip.route?.to ? placeName(trip.route.to) : ''}{trip.arrivedAt ? ` at ${timeOf(trip.arrivedAt)}` : ''}</p>
          {back && <Link to={back} className="btn btn-o" style={{ marginTop: 8 }}>Back to ticket</Link>}
        </div>
      </main>
    );
  }
  const departed = trip.status === 'departed';
  const path = trip.route.path as [number, number][];
  const etaAt = trip.etaMin != null ? new Date(now + trip.etaMin * 60000) : null;
  const ago = trip.position?.at ? Math.max(0, Math.round((now - trip.position.at) / 1000)) : null;
  const depMs = trip.departedAt ? new Date(trip.departedAt.replace(' ', 'T') + 'Z').getTime() : null;
  const totalMs = (trip.route.hours || trip.route.km / 70) * 3600000;
  const stops: { city: string; at: number }[] = trip.route.stops || [];
  const passed = stops.filter((s) => s.at <= trip.progress);
  const shown = [...passed.slice(-2), ...stops.filter((s) => s.at > trip.progress)].slice(0, 4);
  const clock = (f: number) => (depMs ? new Date(depMs + f * totalMs).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
  const pct = Math.round(trip.progress * 100);

  return (
    <div className="trip-screen">
      <TripMap className="trip-map" paths={[path]} progress={departed ? trip.progress : undefined} recenter={centre} label={`Map of the ${trip.route.label} road`}
        points={[{ lat: path[0][0], lng: path[0][1], label: trip.route.from.city }, { lat: path[path.length - 1][0], lng: path[path.length - 1][1], label: trip.route.to.city, end: true }]}
        buses={trip.position ? [{ id: trip.id, lat: trip.position.lat, lng: trip.position.lng, label: trip.bus.number }] : []} />
      <div className="trip-top">
        {back ? <BackBtn to={back} label="Back to ticket" /> : <span className="brand-chip"><Logo size={26} />VIP HopOn</span>}
        <span className="chip" style={{ background: '#fff', boxShadow: 'var(--sh2)', color: departed ? 'var(--oki)' : 'var(--gi)', minHeight: 36, padding: '0 14px' }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: departed ? 'var(--ok)' : '#E09A00' }} />
          {departed ? (ago == null ? 'Live' : ago < 60 ? `Live, updated ${ago}s ago` : `Updated ${Math.round(ago / 60)} min ago`) : 'Boarding, not left yet'}
        </span>
      </div>
      {trip.position && <button className="icb trip-centre" aria-label="Centre on bus" onClick={() => setCentre((c) => c + 1)}><Icon n="target" size="s" /></button>}

      <section className="trip-sheet" aria-labelledby="trip-now">
        <span className="grab" aria-hidden="true" />
        <div className="between" style={{ alignItems: 'flex-end' }}>
          <div className="stack" style={{ gap: 4 }}>
            <span style={{ fontSize: 14, color: 'var(--mut)' }}>{traveller ? `${traveller} is arriving at ` : 'Arriving at '}{placeName(trip.route.to)}</span>
            <h1 id="trip-now" className="disp" style={{ fontSize: 40 }}>{departed && etaAt ? etaAt.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }) : 'Soon'}</h1>
          </div>
          <div className="stack" style={{ gap: 4, alignItems: 'flex-end' }}>
            <span style={{ fontSize: 20, fontWeight: 800 }}>{trip.distLeftKm} km</span>
            <span style={{ fontSize: 13, color: 'var(--mut)' }}>{passed.length ? `past ${passed[passed.length - 1].city}` : departed ? `left ${trip.route.from.city}` : 'to go'}</span>
          </div>
        </div>
        <div aria-label={`Trip progress, ${pct} percent`} className="stack" style={{ gap: 6 }}>
          <div className="prog"><div style={{ width: pct + '%' }} /><span style={{ left: pct + '%' }} /></div>
          <div className="between" style={{ fontSize: 12, color: 'var(--mut)' }}><span>{depMs ? `Left ${trip.route.from.city} ${clock(0)}` : trip.route.from.city}</span><span>{trip.route.to.city}</span></div>
        </div>
        {shown.length > 0 && (
          <ol aria-label="Stops" className="stops">
            {shown.map((s) => {
              const done = s.at <= trip.progress;
              return <li key={s.city}><span style={{ fontSize: 13, fontWeight: 700, color: done ? 'var(--ink)' : 'var(--r7)' }}>{done && <Icon n="check" size="xs" />}{s.city}</span><span style={{ fontSize: 12, color: 'var(--mut)' }}>{depMs ? (done ? clock(s.at) : `about ${clock(s.at)}`) : ''}</span></li>;
            })}
          </ol>
        )}
        <div className="row" style={{ padding: 12, borderRadius: 16, background: 'var(--bg)' }}>
          <span className="tile" style={{ background: 'var(--r7)', color: '#fff' }}><Icon n="bus" size="s" /></span>
          <div className="stack" style={{ flex: 1, gap: 0 }}><b style={{ fontSize: 15 }}>VIP Bus {trip.bus.number}</b><span style={{ fontSize: 13, color: 'var(--mut)' }}>{trip.bus.plate}{trip.position?.speed ? ` · ${Math.round(trip.position.speed)} km/h` : ''}</span></div>
        </div>
        {children}
      </section>
    </div>
  );
}

// ------------------------------------------------------------ public tracking page (no sign-in)
export function Track() {
  const { token } = useParams();
  const [trip, setTrip] = useState<any>(null);
  const a = useAction();
  useEffect(() => { api(`/track/${token}`).then(setTrip).catch(a.setError); }, [token]);
  useEffect(() => { if (trip?.id) return live(`trip:${trip.id}`, 'trip:update', (v) => setTrip((old: any) => ({ ...v, traveller: old?.traveller }))); }, [trip?.id]);
  return (
    <div className="app">
      {a.error ? <main className="page"><Err e={a.error} /></main> : null}
      {trip && <TripView trip={trip} traveller={trip.traveller}>
        <p className="lbl" style={{ margin: 0, textAlign: 'center' }}>Shared by a VIP passenger. This link stops working when the trip ends.</p>
      </TripView>}
    </div>
  );
}
