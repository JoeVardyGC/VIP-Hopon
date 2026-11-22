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

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
