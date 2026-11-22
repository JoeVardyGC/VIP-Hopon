import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from './ui';

export type PickItem = { id: number | string; title: string; sub?: string; keywords?: string[]; badge?: ReactNode; disabled?: boolean; note?: string };

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Rank: title starts with query > a word starts with it > alias match > contains. */
function score(item: PickItem, q: string): number {
  if (!q) return 1;
  const t = norm(item.title);
  if (t.startsWith(q)) return 100 - t.length / 100;
  if (t.split(' ').some((w) => w.startsWith(q))) return 80;
  const keys = (item.keywords || []).map(norm);
  if (keys.some((k) => k.startsWith(q))) return 60;
  if (t.includes(q)) return 40;
  if (keys.some((k) => k.includes(q))) return 30;
  if (item.sub && norm(item.sub).includes(q)) return 20;
  return 0;
}

/**
 * Full-screen, type-to-search picker. People type part of a town ("bolga", "tadi", "upper east")
 * and must tap or press Enter on a result: free text is never accepted.
 */
export function PickerSheet({ title, placeholder, items, value, onPick, onClose, empty, popular }: {
  title: string; placeholder: string; items: PickItem[]; value?: number | string | null;
  onPick: (item: PickItem) => void; onClose: () => void; empty?: (q: string) => ReactNode; popular?: (number | string)[];
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const nq = norm(q);
  const results = useMemo(() => items
    .map((it) => ({ it, s: score(it, nq) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.it.title.localeCompare(b.it.title))
    .map((x) => x.it), [items, nq]);
  const pop = !nq && popular?.length ? popular.map((id) => items.find((i) => i.id === id)).filter(Boolean) as PickItem[] : [];

  useEffect(() => { setActive(0); }, [nq]);
  useEffect(() => { setTimeout(() => input.current?.focus(), 50); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [onClose]);
  useEffect(() => { list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const choose = (it?: PickItem) => { if (it && !it.disabled) { onPick(it); onClose(); } };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    if (e.key === 'Enter') { e.preventDefault(); choose(results[active]); }
  };
  const listId = 'pick-list';

  return (
    <div className="picker" role="dialog" aria-modal="true" aria-label={title}>
      <header className="picker-top">
        <button className="icb" aria-label="Close" onClick={onClose} style={{ background: '#fff', boxShadow: 'var(--sh1)' }}><Icon n="back" size="s" /></button>
        <h1 className="disp" style={{ fontSize: 24 }}>{title}</h1>
      </header>
      <div className="picker-search">
        <Icon n="search" size="s" />
        <input ref={input} role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={results[active] ? `pick-${results[active].id}` : undefined}
          placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
          autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="go" />
        {q && <button className="icb" aria-label="Clear search" onClick={() => { setQ(''); input.current?.focus(); }} style={{ width: 36, height: 36 }}><Icon n="x" size="xs" /></button>}
      </div>
      {pop.length > 0 && (
        <div className="picker-pop" aria-label="Popular">
          {pop.map((it) => <button key={it.id} className="chip dim" style={{ minHeight: 36, cursor: 'pointer', border: 'none' }} onClick={() => choose(it)}>{it.title}</button>)}
        </div>
      )}
      <ul ref={list} id={listId} role="listbox" aria-label={title} className="picker-list">
        {results.map((it, i) => (
          <li key={it.id} id={`pick-${it.id}`} data-i={i} role="option" aria-selected={i === active} aria-disabled={it.disabled || undefined}
            className={`picker-item${i === active ? ' on' : ''}${it.disabled ? ' off' : ''}`}
            onMouseEnter={() => setActive(i)} onClick={() => choose(it)}>
            <span className="tile" style={{ background: value === it.id ? 'var(--r7)' : 'var(--r0)', color: value === it.id ? '#fff' : 'var(--r7)' }}>{it.badge ?? <Icon n="pin" size="s" />}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b style={{ fontSize: 17 }}><Mark text={it.title} q={q} /></b>
              <span className="lbl" style={{ display: 'block' }}>{it.note || it.sub}</span>
            </span>
            {value === it.id ? <Icon n="check" size="s" /> : <Icon n="chev" size="s" />}
          </li>
        ))}
      </ul>
      {!results.length && <div style={{ padding: '8px 20px' }}>{empty ? empty(q) : <p className="mut">No VIP town matches "{q}".</p>}</div>}
    </div>
  );
}

function Mark({ text, q }: { text: string; q: string }) {
  const nq = q.trim().toLowerCase();
  const i = nq ? text.toLowerCase().indexOf(nq) : -1;
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + nq.length)}</mark>{text.slice(i + nq.length)}</>;
}
