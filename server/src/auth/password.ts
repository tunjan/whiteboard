import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Password hashes: scrypt with a random salt, stored as
 * `scrypt$<salt base64>$<hash base64>`. Node's defaults (N=16384, r=8, p=1)
 * are what OWASP lists as the minimum for scrypt.
 */

const KEY_BYTES = 32;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, KEY_BYTES, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await derive(password, Buffer.from(salt, 'base64'));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** The shortest password an account may have. */
export const MIN_PASSWORD_LENGTH = 8;
