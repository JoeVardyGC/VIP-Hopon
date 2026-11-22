import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, auth, live, cedis, timeOf, prettyPhone } from './api';
import { Icon, Logo, Err, useAction, TripMap } from './ui';

export function Ops() {
  const [data, setData] = useState<any>(null);
  const [authed, setAuthed] = useState(!!auth.token('crew'));
  const [q, setQ] = useState('');
  const a = useAction();
  const load = useCallback(() => api('/ops/overview', { who: 'crew' }).then(setData).catch((e) => { if (e.status === 401 || e.status === 403) setAuthed(false); a.setError(e); }), []);
  useEffect(() => { if (!authed) return; load(); const off = live('ops', 'ops:update', load); const iv = setInterval(load, 30000); return () => { off(); clearInterval(iv); }; }, [authed, load]);
  if (!authed) return <OpsLogin onIn={() => { a.setError(null); setAuthed(true); }} error={a.error} />;

  return (
    <div className="ops">
      <header className="ops-top">
        <span className="brand"><Logo />VIP HopOn Operations</span>
        <span className="live" style={{ color: '#9EE2BC' }}><i style={{ background: '#9EE2BC' }} />Live</span>
        <span style={{ marginLeft: 'auto', fontSize: 14, color: 'var(--r1)' }}>{data?.today} · payments {data?.hubtelMode === 'mock' ? 'in test mode' : 'live'}</span>
        <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,.12)', color: '#fff' }} onClick={() => { auth.set('crew', null); setAuthed(false); }}><Icon n="logout" size="s" />Sign out</button>
      </header>
      {!data ? <main className="ops-main"><div className="span12"><Err e={a.error} /></div></main> : (
        <main className="ops-main">
          {[
            ['Online tickets today', data.kpis.ticketsOnline, cedis(data.kpis.onlineAmount) + ' via Hubtel'],
            ['Walk-in seats', data.kpis.walkins, `${cedis(data.kpis.walkinCash)} cash · ${cedis(data.kpis.walkinMomo)} MoMo`],
            ['Buses loading', data.kpis.loading, `${data.kpis.onRoad} on the road`],
            ['Refunds today', cedis(data.kpis.refunds), 'wallet refunds and credit'],
          ].map(([l, v, s]) => (
            <div key={l as string} className="card kpi span3"><span className="lbl">{l}</span><b>{v}</b><span className="lbl">{s}</span></div>
          ))}

          <section className="card span8" style={{ padding: 12 }}>
            <div className="between" style={{ padding: '4px 4px 12px' }}><h2 className="h2">Every bus, live</h2><span className="lbl">{data.trips.filter((t: any) => t.status === 'departed').length} moving</span></div>
            <TripMap tall paths={data.routes.length ? data.trips.filter((t: any) => t.status === 'departed').map((t: any) => t.route.path) : []}
              points={data.terminals.map((t: any) => ({ lat: t.lat, lng: t.lng, label: `${t.city} ${t.name}` }))}
              buses={data.trips.filter((t: any) => t.position && t.status !== 'arrived').map((t: any) => ({ id: t.id, lat: t.position.lat, lng: t.position.lng, label: t.bus.number, title: `Bus ${t.bus.number}, ${t.route.label}` }))} />
          </section>

          <section className="card span4 stack pad">
            <h2 className="h2">Trips today</h2>
            <div className="list scroll" style={{ maxHeight: 420 }}>
              {data.trips.map((t: any) => (
                <div key={t.id} className="stack" style={{ padding: '12px 0', gap: 6 }}>
                  <div className="between"><b>Bus {t.bus.number} · {t.route.label}</b>
                    <span className={`chip ${t.status === 'departed' ? 'ok' : t.status === 'arrived' ? 'dim' : 'warn'}`}>{t.status === 'loading' ? 'Loading' : t.status === 'closed' ? 'Leaving' : t.status === 'departed' ? `ETA ${Math.floor(t.etaMin / 60)}h ${t.etaMin % 60}m` : 'Arrived'}</span></div>
                  <span className={`bar${t.filled / t.bus.seats > .85 ? ' gold' : ''}`}><span style={{ width: Math.round((t.filled / t.bus.seats) * 100) + '%' }} /></span>
                  <span className="lbl">{t.filled}/{t.bus.seats} seats · app {t.appFilled} · {t.conductor} &amp; {t.driver}{t.position?.at && t.status === 'departed' && Date.now() - t.position.at > 120000 ? ' · ⚠ no location for 2+ min' : ''}</span>
                </div>
              ))}
              {!data.trips.length && <p className="mut">No trips yet today.</p>}
            </div>
          </section>

          <section className="card span7 pad stack">
            <div className="between" style={{ flexWrap: 'wrap' }}>
              <h2 className="h2">Routes, fares and online limits</h2>
              <span className="input-wrap" style={{ height: 44, flex: '0 1 240px' }}><Icon n="search" size="s" /><input aria-label="Filter routes" placeholder="Filter, e.g. Tamale" value={q} onChange={(e) => setQ(e.target.value)} /></span>
            </div>
            <div className="tbl-wrap scroll" style={{ maxHeight: 420 }}><table className="tbl">
              <thead><tr><th>Route</th><th>Fare (GH₵)</th><th>App seats / bus</th><th>Daily online cap</th><th>Sold today</th><th>Checked in</th><th /></tr></thead>
              <tbody>{data.routes.filter((r: any) => !q || r.label.toLowerCase().includes(q.toLowerCase())).map((r: any) => <RouteRow key={r.id} r={r} onSaved={load} />)}</tbody>
            </table></div>
            <span className="lbl">{data.routes.filter((r: any) => r.fareSource === 'unconfirmed').length} fares are unconfirmed (marked) · others from VIP's 8 April 2026 fare notice. Confirm all with VIP.</span>
          </section>

          <section className="card span5 pad stack">
            <h2 className="h2">Walk-in cash by conductor</h2>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Conductor</th><th>Seats</th><th>Cash</th><th>MoMo</th></tr></thead>
              <tbody>{data.byConductor.map((c: any) => <tr key={c.name}><td>{c.name}</td><td>{c.sales}</td><td><b>{cedis(c.cash)}</b></td><td>{cedis(c.momo)}</td></tr>)}</tbody>
            </table></div>
            <span className="lbl">Cash to collect at end of day. Every walk-in seat is recorded at the bus door.</span>
          </section>

          <CrewPanel />
          <FleetPanel />

          <section className="card span6 pad stack">
            <h2 className="h2">Alerts</h2>
            {data.flags.length ? data.flags.map((f: any, i: number) => {
              const d = JSON.parse(f.detail);
              return <div key={i} className="err row"><Icon n="warn" size="s" /><span>Ticket {d.ticket} scanned on two buses while offline (trips {d.firstTrip} and {d.secondTrip}) · {timeOf(f.created_at)}</span></div>;
            }) : <p className="mut" style={{ margin: 0 }}>No alerts. Double scans and silent buses show here.</p>}
          </section>

          <section className="card span6 pad stack">
            <div className="between"><h2 className="h2">Messages sent</h2><span className="chip warn">Test mode: not really sent</span></div>
            <div className="list scroll">
              {data.sms.map((s: any, i: number) => <div key={i} style={{ padding: '10px 0', fontSize: 14 }}><span className="lbl">{prettyPhone(s.to_phone)} · {timeOf(s.created_at)}</span><br />{s.body}</div>)}
            </div>
          </section>
        </main>
      )}
    </div>
  );
}

function RouteRow({ r, onSaved }: { r: any; onSaved: () => void }) {
  const [f, setF] = useState({ fare: String(r.fare / 100), appShare: String(r.appShare), dailyCap: String(r.dailyCap) });
  const a = useAction();
  const dirty = f.fare !== String(r.fare / 100) || f.appShare !== String(r.appShare) || f.dailyCap !== String(r.dailyCap);
  return (
    <tr>
      <td><b>{r.label}</b> <span className="lbl">{r.km} km</span>{r.fareSource === 'unconfirmed' && <span className="chip warn" style={{ marginLeft: 6, minHeight: 20, fontSize: 11 }}>Fare unconfirmed</span>}{a.error ? <div className="lbl" style={{ color: 'var(--r8)' }}>{(a.error as Error).message}</div> : null}</td>
      <td><input className="input" inputMode="decimal" aria-label={`Fare for ${r.label}`} value={f.fare} onChange={(e) => setF({ ...f, fare: e.target.value })} /></td>
      <td><input className="input" inputMode="numeric" aria-label={`App seats for ${r.label}`} value={f.appShare} onChange={(e) => setF({ ...f, appShare: e.target.value })} /></td>
      <td><input className="input" inputMode="numeric" aria-label={`Daily cap for ${r.label}`} value={f.dailyCap} onChange={(e) => setF({ ...f, dailyCap: e.target.value })} /></td>
      <td>{r.soldToday}</td><td>{r.queue}</td>
      <td><button className="btn btn-o btn-sm" disabled={!dirty || a.busy} onClick={() => a.run(async () => { await api(`/ops/routes/${r.id}`, { method: 'PUT', body: f, who: 'crew' }); onSaved(); })}>Save</button></td>
    </tr>
  );
}

/** Buses in the fleet. Each bus usually carries one VIP phone that the conductor and driver share. */
function FleetPanel() {
  const [list, setList] = useState<any[]>([]);
  const [f, setF] = useState({ number: '', plate: '', seats: '42' });
  const [added, setAdded] = useState('');
  const a = useAction();
  const load = useCallback(() => api('/ops/buses', { who: 'crew' }).then(setList).catch(a.setError), []);
  useEffect(() => { load(); return live('ops', 'ops:update', load); }, [load]);
  const label: Record<string, [string, string]> = { loading: ['warn', 'Loading'], closed: ['warn', 'Leaving'], departed: ['ok', 'On the road'] };
  return (
    <section className="card span12 pad stack" aria-labelledby="fleet-h">
      <h2 id="fleet-h" className="h2">Fleet</h2>
      <form className="crew-form" onSubmit={(e) => { e.preventDefault(); a.run(async () => { const r = await api('/ops/buses', { body: f, who: 'crew' }); setAdded(`Bus ${r.number} (${r.plate}) added. Conductors can pick it when they open boarding.`); setF({ number: '', plate: '', seats: f.seats }); load(); }); }}>
        <label className="field"><span>Fleet number</span><input className="input" inputMode="numeric" placeholder="31" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} required /></label>
        <label className="field"><span>Plate</span><input className="input" placeholder="GT 4412-21" autoCapitalize="characters" value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value.toUpperCase() })} required /></label>
        <label className="field"><span>Seats</span><input className="input" inputMode="numeric" value={f.seats} onChange={(e) => setF({ ...f, seats: e.target.value })} required /></label>
        <button className="btn btn-g" disabled={a.busy} style={{ alignSelf: 'end' }}><Icon n="bus" size="s" />Add bus</button>
      </form>
      <Err e={a.error} />
      {added && <div className="okbox" role="status">{added}</div>}
      <div className="fleet">
        {list.map((b) => {
          const [tone, text] = label[b.status] || ['dim', 'At terminal'];
          return <div key={b.id} className="fleet-bus"><Icon n="bus" size="s" /><b>Bus {b.number}</b><span className="lbl">{b.plate} · {b.seats} seats</span><span className={`chip ${tone}`}>{text}</span></div>;
        })}
      </div>
    </section>
  );
}

const ROLE: Record<string, string> = { conductor: 'Conductor', driver: 'Driver', manager: 'Manager', admin: 'Admin' };

/** Only VIP managers create crew accounts: each gets a Staff ID and a one-time activation code by SMS. */
function CrewPanel() {
  const [list, setList] = useState<any[]>([]);
  const [f, setF] = useState({ name: '', phone: '', role: 'conductor' });
  const [slip, setSlip] = useState<any>(null);
  const [q, setQ] = useState('');
  const a = useAction();
  const load = useCallback(() => api('/ops/crew', { who: 'crew' }).then(setList).catch(a.setError), []);
  useEffect(() => { load(); }, [load]);
  const shown = list.filter((c) => !q || `${c.name} ${c.staffId} ${c.phone}`.toLowerCase().includes(q.toLowerCase()));
  const chip = (c: any) => !c.active ? ['bad', 'Switched off'] : c.state === 'active' ? ['ok', 'Active'] : c.state === 'expired' ? ['bad', 'Code expired'] : ['warn', 'Waiting to activate'];
  return (
    <section className="card span12 pad stack" aria-labelledby="crew-h">
      <div className="between" style={{ flexWrap: 'wrap' }}>
        <h2 id="crew-h" className="h2">Crew and Staff IDs</h2>
        <span className="input-wrap" style={{ height: 44, flex: '0 1 240px' }}><Icon n="search" size="s" /><input aria-label="Find crew" placeholder="Name, Staff ID or phone" value={q} onChange={(e) => setQ(e.target.value)} /></span>
      </div>
      <form className="crew-form" onSubmit={(e) => { e.preventDefault(); a.run(async () => { const r = await api('/ops/crew', { body: f, who: 'crew' }); setSlip(r); setF({ name: '', phone: '', role: f.role }); load(); }); }}>
        <label className="field"><span>Full name (as on VIP ID)</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
        <label className="field"><span>Phone</span><input className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} required /></label>
        <label className="field"><span>Role</span><select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="conductor">Conductor</option><option value="driver">Driver</option><option value="manager">Terminal manager</option></select></label>
        <button className="btn btn-g" disabled={a.busy} style={{ alignSelf: 'end' }}><Icon n="badge" size="s" />Issue Staff ID</button>
      </form>
      <Err e={a.error} />
      {slip && (
        <div className="issue-slip" role="status">
          <div className="stack" style={{ gap: 4, flex: 1 }}>
            <b style={{ fontSize: 16 }}>{slip.staffId ? `Staff ID issued to ${slip.name || 'crew member'}` : 'New code issued'}</b>
            <span style={{ fontSize: 14 }}>Staff ID <b className="mono">{slip.staffId}</b> · activation code <b className="mono">{slip.code}</b> (7 days). Sent by SMS to {slip.phone ? prettyPhone(slip.phone) : 'their phone'}. Print the Staff ID on their VIP ID card.</span>
          </div>
          <button className="btn btn-o btn-sm" onClick={() => window.print()}>Print slip</button>
          <button className="icb" aria-label="Dismiss" onClick={() => setSlip(null)}><Icon n="x" size="xs" /></button>
        </div>
      )}
      <div className="tbl-wrap scroll" style={{ maxHeight: 380 }}><table className="tbl">
        <thead><tr><th>Staff ID</th><th>Name</th><th>Role</th><th>Phone</th><th>Status</th><th /></tr></thead>
        <tbody>{shown.map((c) => {
          const [tone, label] = chip(c);
          return (
            <tr key={c.id}>
              <td className="mono"><b>{c.staffId}</b></td><td>{c.name}</td><td>{ROLE[c.role]}</td><td>{prettyPhone(c.phone)}</td>
              <td><span className={`chip ${tone}`}>{label}</span></td>
              <td><span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                <button className="btn btn-o btn-sm" disabled={a.busy} onClick={() => { if (confirm(`Send ${c.name} a new activation code? Their current PIN stops working.`)) a.run(async () => { const r = await api(`/ops/crew/${c.id}/reset`, { body: {}, who: 'crew' }); setSlip({ ...r, name: c.name, phone: c.phone }); load(); }); }}>New code</button>
                <button className="btn btn-sm" style={{ background: c.active ? 'var(--r0)' : 'var(--ok0)', color: c.active ? 'var(--r8)' : 'var(--oki)' }} disabled={a.busy}
                  onClick={() => { if (!c.active || confirm(`Switch off ${c.staffId}? ${c.name} is signed out at once.`)) a.run(async () => { await api(`/ops/crew/${c.id}/active`, { body: { active: !c.active }, who: 'crew' }); load(); }); }}>{c.active ? 'Switch off' : 'Switch on'}</button>
              </span></td>
            </tr>
          );
        })}</tbody>
      </table></div>
    </section>
  );
}

function OpsLogin({ onIn, error }: { onIn: () => void; error: unknown }) {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const a = useAction();
  return (
    <div className="ops" style={{ display: 'grid', placeItems: 'center', padding: 16 }}>
      <form className="card pad stack" style={{ width: '100%', maxWidth: 400 }} onSubmit={(e) => { e.preventDefault(); a.run(async () => { const r = await api('/crew/login', { body: { id: phone, pin } }); if (!['manager', 'admin'].includes(r.crew.role)) throw new Error('Only managers and admins can open the dashboard'); auth.set('crew', r.token); onIn(); }); }}>
        <div className="brand" style={{ color: 'var(--r7)' }}><Logo />Operations</div>
        <label className="field"><span>Manager Staff ID</span><span className="input-wrap"><Icon n="badge" size="s" /><input autoCapitalize="characters" autoComplete="username" placeholder="VIP-M9001" value={phone} onChange={(e) => setPhone(e.target.value.toUpperCase())} required /></span></label>
        <label className="field"><span>PIN</span><span className="input-wrap"><Icon n="lock" size="s" /><input type="password" inputMode="numeric" autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value)} required /></span></label>
        <Err e={a.error || error} />
        <button className="btn btn-g" disabled={a.busy}>Sign in</button>
        <Link to="/" className="lbl" style={{ textAlign: 'center' }}>Passenger app</Link>
      </form>
    </div>
  );
}
