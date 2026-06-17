import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '../env';

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

// Compare against the configured tutor password in constant time. Hashing both
// sides first gives equal-length buffers (no length leak) without storing a
// hash at rest.
const expected = sha256(env.tutorPassword);

export function checkPassword(input: string): boolean {
  return timingSafeEqual(sha256(input), expected);
}
