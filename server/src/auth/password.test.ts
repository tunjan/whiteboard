import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashes', () => {
  it('verifies the password it was made from, and nothing else', async () => {
    const stored = await hashPassword('correct horse');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse', stored)).toBe(true);
    expect(await verifyPassword('correct horsf', stored)).toBe(false);
  });

  it('salts, so one password never hashes the same twice', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('refuses a stored value it cannot read', async () => {
    expect(await verifyPassword('x', 'plain-text')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$only-salt')).toBe(false);
  });
});
