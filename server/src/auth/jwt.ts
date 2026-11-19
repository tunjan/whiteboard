import { SignJWT, jwtVerify } from 'jose';
import { env } from '../env';
import { getTutor, type Tutor } from './tutors';

const secret = new TextEncoder().encode(env.sessionSecret);
const ALG = 'HS256';

/**
 * What the session cookie says: which tutor, and the `session_version` they
 * had when it was signed. A password change bumps the version, which logs out
 * every cookie signed before it.
 */
export async function signSession(tutor: Pick<Tutor, 'id' | 'sessionVersion'>): Promise<string> {
  return new SignJWT({ role: 'tutor', tutorId: tutor.id, v: tutor.sessionVersion })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret);
}

/** The tutor a session cookie belongs to, or null if it no longer counts. */
export async function verifySession(token: string): Promise<Tutor | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (payload.role !== 'tutor' || typeof payload.tutorId !== 'string') return null;
    const tutor = await getTutor(payload.tutorId);
    return tutor && tutor.sessionVersion === payload.v ? tutor : null;
  } catch {
    return null;
  }
}
