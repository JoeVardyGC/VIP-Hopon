import { useEffect, useState } from 'react';
import { Icon } from './ui';

// Captures the browser's install prompt so we can offer an "Install app" button at the right moment.
type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
let deferred: BIP | null = null;
const subs = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BIP; subs.forEach((f) => f()); });
  window.addEventListener('appinstalled', () => { deferred = null; subs.forEach((f) => f()); });
}

export const isStandalone = () =>
  typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true);
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

export function useInstall() {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return {
    installed: isStandalone(),
    canPrompt: !!deferred,
    ios: isIos(),
    prompt: async () => { if (!deferred) return false; await deferred.prompt(); const r = await deferred.userChoice; deferred = null; return r.outcome === 'accepted'; },
  };
}

/** "Install app" card: one tap on Android/Chrome, step-by-step help on iPhone. Hidden once installed. */
export function InstallCard({ app, dark }: { app: string; dark?: boolean }) {
  const ins = useInstall();
  const [help, setHelp] = useState(false);
  const [hidden, setHidden] = useState(false);
  if (ins.installed || hidden) return null;
  if (!ins.canPrompt && !ins.ios) return null;
  return (
    <div className={`install-card${dark ? ' dark' : ''}`} role="region" aria-label={`Install ${app}`}>
      <span className="tile" style={{ background: 'var(--g)', color: 'var(--ink)' }}><Icon n="phone" size="s" /></span>
      <div className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
        <b style={{ fontSize: 15 }}>Install {app}</b>
        <span style={{ fontSize: 13, opacity: .85 }}>{help ? 'Tap the Share button, then "Add to Home Screen".' : 'Opens from your home screen, full screen, and works with weak signal.'}</span>
      </div>
      {ins.canPrompt
        ? <button className="btn btn-g btn-sm" onClick={() => ins.prompt()}>Install</button>
        : <button className="btn btn-g btn-sm" onClick={() => setHelp(true)}>How</button>}
      <button className="icb" aria-label="Not now" onClick={() => setHidden(true)} style={{ width: 36, height: 36, color: 'inherit' }}><Icon n="x" size="xs" /></button>
    </div>
  );
}

// Browsers inside other apps (Facebook, Instagram, TikTok...) can't install web apps.
const inAppBrowser = () => /FBAN|FBAV|Instagram|Line\/|TikTok|musical_ly|Snapchat/i.test(navigator.userAgent);
const isAndroid = () => /android/i.test(navigator.userAgent);
const isMobile = () => isIos() || isAndroid() || matchMedia('(pointer: coarse)').matches;
const SNOOZE_KEY = 'hopon.installSnooze';
const SNOOZE_MS = 24 * 3600 * 1000;
const snoozed = () => { try { return Date.now() - Number(localStorage.getItem(SNOOZE_KEY) || 0) < SNOOZE_MS; } catch { return false; } };
const snooze = () => { try { localStorage.setItem(SNOOZE_KEY, String(Date.now())); } catch { /* private mode */ } };

/**
 * Pop-up that asks visitors on a phone to install the app, shortly after the site opens.
 * Android/Chrome: one-tap Install. iPhone: Share → Add to Home Screen steps.
 * Other browsers: the menu steps. "Not now" hides it for a day. Never shown once installed.
 */
export function InstallPrompt({ app, path }: { app: string; path: string }) {
  const ins = useInstall();
  const [open, setOpen] = useState(false);
  const off = path.startsWith('/ops') || path.startsWith('/t/');
  const crew = path.startsWith('/crew');
  useEffect(() => {
    if (off || isStandalone() || snoozed() || !isMobile()) return;
    // Give Chrome a moment to offer its install prompt so we can show the one-tap button.
    const t = setTimeout(() => setOpen(true), 1800);
    return () => clearTimeout(t);
  }, [off]);
  if (!open || off || ins.installed) return null;
  const close = () => { snooze(); setOpen(false); };
  const install = async () => { const ok = await ins.prompt(); if (ok) setOpen(false); };
  const kind = ins.canPrompt ? 'prompt' : inAppBrowser() ? 'inapp' : ins.ios ? 'ios' : 'menu';
  return (
    <div className="sheet-bg" onClick={close}>
      <div className="sheet install-pop" role="dialog" aria-modal="true" aria-labelledby="install-title" onClick={(e) => e.stopPropagation()}>
        <span className="grab" aria-hidden="true" />
        <div className="install-pop-head">
          <img src={crew ? '/icons/crew-192.png' : '/icons/icon-192.png'} alt="" width={64} height={64} />
          <div className="stack" style={{ gap: 4 }}>
            <h2 id="install-title" className="disp" style={{ fontSize: 22, margin: 0 }}>Install {app}</h2>
            <span style={{ fontSize: 14, color: 'var(--mut)' }}>Free · No Play Store needed</span>
          </div>
        </div>
        <ul className="install-pop-perks">
          <li><Icon n="phone" size="xs" />Opens from your home screen like a normal app</li>
          {crew
            ? <li><Icon n="scan" size="xs" />Scanner and trip controls one tap away</li>
            : <li><Icon n="ticket" size="xs" />Your tickets are one tap away at the terminal</li>}
          <li><Icon n="wifi" size="xs" />Works better on weak signal</li>
        </ul>
        {kind === 'prompt' && <button className="btn btn-r" onClick={install}>Install app</button>}
        {kind === 'ios' && (
          <ol className="install-pop-steps">
            <li>Tap the <b>Share</b> button <span aria-hidden="true">(square with an arrow)</span> at the bottom of Safari.</li>
            <li>Scroll and tap <b>Add to Home Screen</b>.</li>
            <li>Tap <b>Add</b>.</li>
          </ol>
        )}
        {kind === 'menu' && (
          <ol className="install-pop-steps">
            <li>Tap the browser menu <b>⋮</b> (top right).</li>
            <li>Tap <b>Install app</b> or <b>Add to Home screen</b>.</li>
          </ol>
        )}
        {kind === 'inapp' && (
          <p className="install-pop-note">To install, open this page in <b>{ins.ios ? 'Safari' : 'Chrome'}</b>: tap the menu <b>⋯</b> and choose <b>Open in browser</b>.</p>
        )}
        <button className="btn btn-t" onClick={close}>{kind === 'prompt' ? 'Not now' : 'Got it'}</button>
      </div>
    </div>
  );
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
