import { useEffect, useRef, useState, type ReactNode } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getConfig } from './api';

const P: Record<string, ReactNode> = {
  home: <><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>,
  ticket: <><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" /><path d="M13 5v2" /><path d="M13 17v2" /><path d="M13 11v2" /></>,
  nav: <polygon points="3 11 22 2 13 21 11 13 3 11" />,
  back: <><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></>,
  arrow: <><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>,
  chev: <path d="m9 18 6-6-6-6" />,
  pin: <><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" /><circle cx="12" cy="10" r="3" /></>,
  swap: <><path d="m21 16-4 4-4-4" /><path d="M17 20V4" /><path d="m3 8 4-4 4 4" /><path d="M7 4v16" /></>,
  cal: <><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  x: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  warn: <><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
  shield: <><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="m9 12 2 2 4-4" /></>,
  share: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.59 13.51 6.83 3.98" /><path d="m15.41 6.51-6.82 3.98" /></>,
  scan: <><path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" /><path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" /><path d="M7 12h10" /></>,
  bus: <><path d="M8 6v6" /><path d="M15 6v6" /><path d="M2 12h19.6" /><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3" /><circle cx="7" cy="18" r="2" /><path d="M9 18h5" /><circle cx="16" cy="18" r="2" /></>,
  cash: <><rect width="20" height="12" x="2" y="6" rx="2" /><circle cx="12" cy="12" r="2" /><path d="M6 12h.01M18 12h.01" /></>,
  phone: <><rect width="14" height="20" x="5" y="2" rx="2" ry="2" /><path d="M12 18h.01" /></>,
  plus: <><path d="M5 12h14" /><path d="M12 5v14" /></>,
  trash: <><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>,
  user: <><circle cx="12" cy="8" r="5" /><path d="M20 21a8 8 0 0 0-16 0" /></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" x2="9" y1="12" y2="12" /></>,
  play: <polygon points="6 3 20 12 6 21 6 3" />,
  stop: <rect width="14" height="14" x="5" y="5" rx="2" />,
  flag: <><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" x2="4" y1="22" y2="15" /></>,
  wifioff: <><path d="M12 20h.01" /><path d="M8.5 16.43a5 5 0 0 1 7 0" /><path d="M2 8.82a15 15 0 0 1 4.17-2.65" /><path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76" /><path d="M16.85 11.25a10 10 0 0 1 2.22 1.68" /><path d="M5 12.86a10 10 0 0 1 5.17-2.69" /><path d="m2 2 20 20" /></>,
  refresh: <><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" /></>,
  clock: <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
  badge: <><rect width="18" height="14" x="3" y="6" rx="2" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><circle cx="9" cy="13" r="2" /><path d="M14 12h4" /><path d="M14 15h3" /></>,
  search: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>,
  lock: <><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
  snow: <><path d="m10 20-1.25-2.5L6 18" /><path d="M10 4 8.75 6.5 6 6" /><path d="m14 20 1.25-2.5L18 18" /><path d="m14 4 1.25 2.5L18 6" /><path d="m17 21-3-6h-4" /><path d="m17 3-3 6 1.5 3" /><path d="M2 12h6.5L10 9" /><path d="m20 10-1.5 2 1.5 2" /><path d="M22 12h-6.5L14 15" /><path d="m4 10 1.5 2L4 14" /><path d="m7 21 3-6-1.5-3" /><path d="m7 3 3 6h4" /></>,
  wifi: <><path d="M12 20h.01" /><path d="M2 8.82a15 15 0 0 1 20 0" /><path d="M5 12.859a10 10 0 0 1 14 0" /><path d="M8.5 16.429a5 5 0 0 1 7 0" /></>,
  target: <><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></>,
  call: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />,
};

export function Icon({ n, size = '', label }: { n: keyof typeof P | string; size?: '' | 's' | 'xs' | 'l'; label?: string }) {
  return (
    <svg className={`ic ${size}`} viewBox="0 0 24 24" aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label}>
      {P[n]}
    </svg>
  );
}

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#F2B227" />
      <path d="M8.5 9.5l6.5 6.5-6.5 6.5" stroke="#B3122E" strokeWidth="3.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 9.5l6.5 6.5-6.5 6.5" stroke="#B3122E" strokeWidth="3.4" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity=".55" />
    </svg>
  );
}

export function Sheet({ onClose, children, label }: { onClose: () => void; children: ReactNode; label: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        <span className="grab" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}

export function Err({ e }: { e: unknown }) {
  if (!e) return null;
  return <div className="err" role="alert">{e instanceof Error ? e.message : String(e)}</div>;
}

/** True when the server allows the trial "Test mode" buttons (check in without location, demo drive, simulate decline). */
export function useTestMode() {
  const [on, setOn] = useState(false);
  useEffect(() => { getConfig().then((c) => setOn(!!c.testMode)); }, []);
  return on;
}

/** Run an async action with busy + error state. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true); setError(null);
    try { return await fn(); } catch (e) { setError(e); return undefined; } finally { setBusy(false); }
  };
  return { busy, error, setError, run };
}

type LatLng = [number, number];
export type MapBus = { id: number; lat: number; lng: number; label: string; title?: string };

const BUS_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#1F1416" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/></svg>';

/**
 * Live map (OpenStreetMap data, CARTO light tiles) styled like the HopOn designs:
 * red route line with the travelled part solid, gold bus marker, dark destination pin.
 * `recenter` changing pans to the first bus.
 */
export function TripMap({ paths = [], buses = [], points = [], tall, className = '', progress, recenter, label = 'Map' }: {
  paths?: LatLng[][]; buses?: MapBus[]; points?: { lat: number; lng: number; label: string; end?: boolean }[];
  tall?: boolean; className?: string; progress?: number; recenter?: number; label?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef<any>(null);

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { zoomControl: false, attributionControl: true }).setView([7.9, -1.0], 6);
    fitted.current = null; // a new map has not been fitted yet
    L.control.zoom({ position: 'bottomright' }).addTo(map.current);
    // OpenStreetMap's public tiles: fine for an MVP demo. For launch, switch to Google Maps
    // (the architecture's choice) or a paid tile plan; OSM's servers are not for production traffic.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors', className: 'osm-tiles',
    }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    const ro = new ResizeObserver(() => map.current?.invalidateSize());
    ro.observe(el.current);
    return () => { ro.disconnect(); map.current?.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    for (const p of paths) {
      L.polyline(p, { color: '#FFFFFF', weight: 11, opacity: .95 }).addTo(g);
      if (progress != null && progress > 0) {
        const cut = Math.max(1, Math.round(progress * (p.length - 1)));
        L.polyline(p.slice(cut), { color: '#B3122E', weight: 5, opacity: .35, dashArray: '1 10', lineCap: 'round' }).addTo(g);
        L.polyline(p.slice(0, cut + 1), { color: '#B3122E', weight: 6, lineCap: 'round' }).addTo(g);
      } else {
        L.polyline(p, { color: '#B3122E', weight: 5, lineCap: 'round' }).addTo(g);
      }
    }
    for (const p of points) {
      const icon = p.end
        ? L.divIcon({ className: '', html: '<div class="pin-end"><i></i></div>', iconSize: [28, 36], iconAnchor: [14, 34] })
        : L.divIcon({ className: '', html: '<div class="pin-start"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
      L.marker([p.lat, p.lng], { icon, title: p.label, keyboard: false }).bindTooltip(p.label, { direction: 'top', offset: [0, p.end ? -30 : -8] }).addTo(g);
    }
    for (const b of buses) {
      L.marker([b.lat, b.lng], {
        icon: L.divIcon({ className: '', html: `<div class="bus-dot"><span class="bus-pulse"></span>${BUS_SVG}<b>${b.label}</b></div>`, iconSize: [44, 44], iconAnchor: [22, 22] }),
        title: b.title || `Bus ${b.label}`, zIndexOffset: 1000,
      }).addTo(g);
    }
    // Fit once per path: re-fit when a trip's path changes (e.g. re-routed from the bus phone's location).
    const key = paths.map((p) => `${p[0]?.join()}|${p.length}`).join(';');
    if (fitted.current !== key) {
      const pts: LatLng[] = [...paths.flat(), ...points.map((p) => [p.lat, p.lng] as LatLng), ...buses.map((b) => [b.lat, b.lng] as LatLng)];
      if (pts.length) {
        const bounds = L.latLngBounds(pts);
        fitted.current = key;
        // Wait a frame so the map knows its real size on screen, or it zooms out too far.
        requestAnimationFrame(() => { m.invalidateSize(); m.fitBounds(bounds, { padding: [36, 36], maxZoom: 14 }); });
      }
    }
  }, [JSON.stringify(paths), JSON.stringify(buses), JSON.stringify(points), progress]);

  useEffect(() => {
    if (recenter && buses[0] && map.current) map.current.setView([buses[0].lat, buses[0].lng], Math.max(map.current.getZoom(), 10), { animate: true });
  }, [recenter]);

  return <div ref={el} className={`map${tall ? ' tall' : ''} ${className}`} role="region" aria-label={label} />;
}

/** Three-letter town codes for the ticket, like the design's ACC → KSI. */
const CODES: Record<string, string> = {
  Accra: 'ACC', Kumasi: 'KSI', Tamale: 'TML', Bolgatanga: 'BLG', Wa: 'WA', Navrongo: 'NAV', Paga: 'PGA', Bawku: 'BWK',
  Kulungugu: 'KLG', Garu: 'GRU', Hamile: 'HML', Sunyani: 'SYN', Techiman: 'TCH', Kintampo: 'KTP', Nkoranza: 'NKZ', Wenchi: 'WCH',
  Sampa: 'SMP', 'Dormaa Ahenkro': 'DMA', Drobo: 'DRB', Goaso: 'GSO', 'Sefwi Juaboso': 'JBS', Mampong: 'MPG', Obuasi: 'OBU',
  'Asante Bekwai': 'BKW', 'Dunkwa-on-Offin': 'DKW', Diaso: 'DSO', Takoradi: 'TKD', 'Cape Coast': 'CCT', Tarkwa: 'TKW',
  'Wassa Akropong': 'WAK', Enchi: 'ENC', Asankragua: 'ASK', Samreboi: 'SMR', Ho: 'HO',
};
export const townCode = (city: string) => CODES[city] || city.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
export const hrs = (h?: number | null) => (h == null ? '' : `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}`);
