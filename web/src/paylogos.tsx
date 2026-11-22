import { useState, type ReactNode } from 'react';

// Payment method logos at checkout.
// MTN uses the real MTN logo (public/paylogos/mtn.svg, from Wikimedia Commons, public domain text logo).
// Telecel Cash, AT Money and cards show a drawn mark in brand colours until official files are dropped into
// public/paylogos/ as telecel.png|svg, at.png|svg, card.png|svg (see the README there).

/** Shows /paylogos/<name>.png or .svg if it exists, otherwise the drawn fallback. */
function Official({ name, size, label, fallback }: { name: string; size: number; label: string; fallback: ReactNode }) {
  const [i, setI] = useState(0);
  const srcs = [`/paylogos/${name}.png`, `/paylogos/${name}.svg`];
  if (i >= srcs.length) return <>{fallback}</>;
  return <img src={srcs[i]} width={size} height={size} alt={label} onError={() => setI(i + 1)} style={{ borderRadius: 12, objectFit: 'contain', background: '#fff', flex: 'none' }} />;
}

export function MtnMomo({ size = 44 }: { size?: number }) {
  return (
    <span role="img" aria-label="MTN MoMo" style={{ width: size, height: size, borderRadius: 12, background: '#FFCB05', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: size * 0.02, flex: 'none' }}>
      <img src="/paylogos/mtn.svg" alt="" width={size * 0.78} height={size * 0.39} />
      <span style={{ font: `800 ${Math.round(size * 0.2)}px/1 Arial, sans-serif`, color: '#000', letterSpacing: '-.02em' }}>MoMo</span>
    </span>
  );
}

function DrawnTelecel({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Telecel Cash">
      <rect width="48" height="48" rx="12" fill="#E30613" />
      <text x="24" y="24" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="800" fontSize="11" fill="#fff" letterSpacing="-.3">telecel</text>
      <rect x="12" y="29" width="24" height="11" rx="5.5" fill="#fff" />
      <text x="24" y="37.4" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="800" fontSize="8" fill="#E30613">cash</text>
    </svg>
  );
}
export const TelecelCash = ({ size = 44 }: { size?: number }) => <Official name="telecel" size={size} label="Telecel Cash" fallback={<DrawnTelecel size={size} />} />;

function DrawnAt({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="AT Money, formerly AirtelTigo Money">
      <defs><linearGradient id="atg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#0B4EA2" /><stop offset="1" stopColor="#E4002B" /></linearGradient></defs>
      <rect width="48" height="48" rx="12" fill="url(#atg)" />
      <text x="24" y="27" textAnchor="middle" fontFamily="Arial Black, Arial, sans-serif" fontWeight="900" fontSize="17" fill="#fff" letterSpacing="-.5">at</text>
      <text x="24" y="39" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="700" fontSize="8" fill="#fff">money</text>
    </svg>
  );
}
export const AtMoney = ({ size = 44 }: { size?: number }) => <Official name="at" size={size} label="AT Money" fallback={<DrawnAt size={size} />} />;

function DrawnCards({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Visa or Mastercard">
      <rect width="48" height="48" rx="12" fill="#fff" stroke="#E0D4D6" strokeWidth="1.5" />
      <text x="24" y="20" textAnchor="middle" fontFamily="Arial Black, Arial, sans-serif" fontStyle="italic" fontWeight="900" fontSize="12" fill="#1A1F71" letterSpacing=".5">VISA</text>
      <circle cx="19.5" cy="33" r="7" fill="#EB001B" />
      <circle cx="28.5" cy="33" r="7" fill="#F79E1B" />
      <path d="M24 27.6a7 7 0 0 1 0 10.8 7 7 0 0 1 0-10.8z" fill="#FF5F00" />
    </svg>
  );
}
export const Cards = ({ size = 44 }: { size?: number }) => <Official name="card" size={size} label="Visa or Mastercard" fallback={<DrawnCards size={size} />} />;

export const PAY_METHODS = [
  { id: 'mtn', label: 'MTN MoMo', sub: 'Approve with your MoMo PIN', Logo: MtnMomo, momo: true },
  { id: 'telecel', label: 'Telecel Cash', sub: 'Approve with your PIN', Logo: TelecelCash, momo: true },
  { id: 'airteltigo', label: 'AT Money', sub: 'Formerly AirtelTigo Money', Logo: AtMoney, momo: true },
  { id: 'card', label: 'Visa or Mastercard', sub: 'On the secure Hubtel page', Logo: Cards, momo: false },
] as const;
