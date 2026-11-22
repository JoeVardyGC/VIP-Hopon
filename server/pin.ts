// Crew PINs are stored as scrypt hashes with a per-PIN salt, never as plain text.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  return `s1$${salt.toString('base64url')}$${scryptSync(pin, salt, 32).toString('base64url')}`;
}

export function checkPin(pin: string, stored: string | null): boolean {
  if (!stored) return false;
  const [, salt, hash] = stored.split('$');
  const a = scryptSync(String(pin), Buffer.from(salt, 'base64url'), 32), b = Buffer.from(hash, 'base64url');
  return a.length === b.length && timingSafeEqual(a, b);
}
