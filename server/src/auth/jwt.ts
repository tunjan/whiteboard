import { SignJWT, jwtVerify } from 'jose';
import { env } from '../env';

const secret = new TextEncoder().encode(env.sessionSecret);
const ALG = 'HS256';

export interface Session {
  role: 'tutor';
  name: string;
}

export async function signSession(session: Session): Promise<string> {
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret);
}

export async function verifySession(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (payload.role !== 'tutor' || typeof payload.name !== 'string') return null;
    return { role: 'tutor', name: payload.name };
  } catch {
    return null;
  }
}
