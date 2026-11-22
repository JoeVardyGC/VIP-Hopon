// Demo data for the MVP. Crew phone numbers and PINs here are test logins only.
//
// Towns and fares: VIP Jeoun's fare notice effective 8 April 2026 (Graphic Online, executive coach
// where listed, otherwise standard), plus troski.me (Oct 2026) for towns that notice did not list.
// Locations: OpenStreetMap. Road paths and distances: OSRM, built into routes-data.json.
// Confirm every fare and station with VIP before launch.
import { one, insert, run } from './db.ts';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPin } from './pin.ts';

type Src = 'vip-exec-2026' | 'vip-std-2026' | 'unconfirmed';
// town, fare from Accra (GH₵), source of fare, other names people type
const FROM_ACCRA: [string, number, Src, string[]][] = [
  ['Kumasi', 150, 'vip-exec-2026', ['Asafo', 'Kumasi Asafo', 'Adum', 'Garden City']],
  ['Tamale', 360, 'vip-exec-2026', []],
  ['Bolgatanga', 410, 'vip-exec-2026', ['Bolga']],
  ['Wa', 275, 'unconfirmed', []],
  ['Navrongo', 420, 'vip-exec-2026', []],
  ['Paga', 420, 'vip-exec-2026', []],
  ['Bawku', 430, 'vip-exec-2026', []],
  ['Kulungugu', 460, 'vip-exec-2026', []],
  ['Garu', 350, 'vip-std-2026', []],
  ['Hamile', 450, 'vip-exec-2026', []],
  ['Sunyani', 200, 'vip-exec-2026', []],
  ['Techiman', 200, 'vip-exec-2026', ['Takyiman']],
  ['Kintampo', 220, 'vip-exec-2026', []],
  ['Nkoranza', 210, 'vip-exec-2026', []],
  ['Wenchi', 180, 'vip-std-2026', []],
  ['Sampa', 230, 'vip-exec-2026', []],
  ['Dormaa Ahenkro', 220, 'vip-exec-2026', ['Dormaa']],
  ['Drobo', 220, 'vip-exec-2026', []],
  ['Goaso', 200, 'vip-exec-2026', ['Ahafo Goaso']],
  ['Sefwi Juaboso', 220, 'vip-exec-2026', ['Juaboso', 'Sefwi']],
  ['Mampong', 170, 'vip-exec-2026', ['Asante Mampong', 'Ashanti Mampong']],
  ['Obuasi', 180, 'vip-exec-2026', []],
  ['Asante Bekwai', 170, 'unconfirmed', ['Bekwai']],
  ['Dunkwa-on-Offin', 190, 'vip-exec-2026', ['Dunkwa']],
  ['Diaso', 180, 'vip-std-2026', []],
  ['Takoradi', 120, 'vip-std-2026', ['Tadi', 'Sekondi-Takoradi', 'Sekondi']],
  ['Cape Coast', 110, 'vip-std-2026', ['Cape', 'Oguaa']],
  ['Tarkwa', 150, 'vip-std-2026', []],
  ['Wassa Akropong', 200, 'vip-exec-2026', ['Akropong Wassa']],
  ['Enchi', 190, 'vip-std-2026', []],
  ['Asankragua', 180, 'vip-std-2026', ['Asankragwa']],
  ['Samreboi', 190, 'vip-std-2026', []],
  ['Ho', 75, 'unconfirmed', []],
];
const FROM_KUMASI: [string, number, Src][] = [
  ['Tamale', 210, 'vip-exec-2026'], ['Wa', 240, 'vip-exec-2026'], ['Kulungugu', 300, 'vip-exec-2026'],
];

// Demo staff. Each has a VIP Staff ID like the number on a staff ID card. The first five are already
// activated with the PIN shown; Abena has a Staff ID but has not activated yet, to demo first sign-in.
export const DEMO_CREW = [
  { staffId: 'VIP-C1001', name: 'Kwame Asante', phone: '0244000001', pin: '1111', role: 'conductor' },
  { staffId: 'VIP-C1002', name: 'Efua Owusu', phone: '0244000002', pin: '2222', role: 'conductor' },
  { staffId: 'VIP-D2001', name: 'Kofi Boateng', phone: '0244000003', pin: '3333', role: 'driver' },
  { staffId: 'VIP-D2002', name: 'Yaw Darko', phone: '0244000004', pin: '4444', role: 'driver' },
  { staffId: 'VIP-M9001', name: 'Akosua Mensah', phone: '0244000009', pin: '9999', role: 'manager' },
  { staffId: 'VIP-C1003', name: 'Abena Osei', phone: '0244000005', pin: null, role: 'conductor', activationCode: '482915' },
];

/** Fills an empty database: towns, routes, buses, and crew. Safe to call on every start. */
export async function seedIfEmpty() {
  const has = await one<{ n: number }>('SELECT COUNT(*) AS n FROM terminals');
  if (has && has.n > 0) return false;
  const data = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'routes-data.json'), 'utf8'));
  const T = 'INSERT INTO terminals (name, city, region, aliases, lat, lng, radius_m) VALUES (?, ?, ?, ?, ?, ?, ?)';
  const ids: Record<string, number> = {};
  ids.Accra = await insert(T, 'Circle', 'Accra', 'Greater Accra', JSON.stringify(['Circle', 'Kwame Nkrumah Circle', 'Kaneshie', 'Achimota']), 5.5700, -0.2155, 400);
  for (const [town, , , aliases] of FROM_ACCRA) {
    const c = data.coords[town];
    ids[town] = await insert(T, town === 'Kumasi' ? 'Asafo' : 'VIP station', town, c.region + ' Region', JSON.stringify(aliases), c.lat, c.lng, 500);
  }

  const R = 'INSERT INTO routes (from_terminal, to_terminal, fare, fare_source, km, hours, app_share, daily_cap, path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
  const add = async (from: string, to: string, fare: number, src: Src) => {
    const p = data.paths[`${from}|${to}`];
    const cap = p.km > 500 ? 120 : 300;
    await run(R, ids[from], ids[to], fare * 100, src, p.km, p.hours, 25, cap, JSON.stringify(p.path));
    await run(R, ids[to], ids[from], fare * 100, src, p.km, p.hours, 25, cap, JSON.stringify([...p.path].reverse()));
  };
  for (const [town, fare, src] of FROM_ACCRA) await add('Accra', town, fare, src);
  for (const [town, fare, src] of FROM_KUMASI) await add('Kumasi', town, fare, src);

  // VIP runs 42-seat executive coaches. Demo fleet; managers add real buses on the dashboard.
  for (const [n, p] of [['7', 'GT 4412-21'], ['9', 'GT 7781-22'], ['11', 'GN 3302-22'], ['14', 'GR 2290-23'], ['18', 'GE 6610-23'], ['21', 'GW 1055-24'], ['25', 'GT 9087-24'], ['30', 'GR 5521-25']])
    await run('INSERT INTO buses (number, plate, seats) VALUES (?, ?, ?)', n, p, 42);

  const C = `INSERT INTO crew (staff_id, name, phone, role, terminal_id, pin_hash, activation_code, activation_expires, activated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  // Demo crew with known PINs only on your laptop (or if DEMO_CREW=true). Never on a public server by default.
  const demo = process.env.DEMO_CREW === 'true' || (process.env.NODE_ENV !== 'production' && process.env.DEMO_CREW !== 'false');
  if (demo) {
    for (const m of DEMO_CREW) {
      await run(C, m.staffId, m.name, m.phone, m.role, ids.Accra, m.pin ? hashPin(m.pin) : null,
        m.activationCode || null, m.activationCode ? Date.now() + 365 * 86400000 : null, m.pin ? new Date().toISOString() : null);
    }
  } else {
    // Online: one first manager from settings you choose on Render. They then issue everyone else's Staff IDs.
    const phone = String(process.env.FIRST_MANAGER_PHONE || '').replace(/\D/g, '').replace(/^233/, '0');
    const pin = String(process.env.FIRST_MANAGER_PIN || '');
    if (/^0\d{9}$/.test(phone) && /^\d{4,6}$/.test(pin)) {
      await run(C, 'VIP-M9001', process.env.FIRST_MANAGER_NAME || 'Terminal Manager', phone, 'manager', ids.Accra, hashPin(pin), null, null, new Date().toISOString());
      console.log(`First manager created: Staff ID VIP-M9001 (${phone}).`);
    } else {
      console.warn('No crew created. Set FIRST_MANAGER_PHONE and FIRST_MANAGER_PIN (4-6 digits), then reset the database.');
    }
  }
  return true;
}
