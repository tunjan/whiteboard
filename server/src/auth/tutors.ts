import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { genId } from '@whiteboard/shared';
import { db } from '../db/client';
import { appSettings, boards, tutors } from '../db/schema';
import { env } from '../env';
import { hashPassword } from './password';

export type Tutor = typeof tutors.$inferSelect;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export async function getTutor(id: string): Promise<Tutor | undefined> {
  const [row] = await db.select().from(tutors).where(eq(tutors.id, id));
  return row;
}

export async function tutorByEmail(email: string): Promise<Tutor | undefined> {
  const [row] = await db.select().from(tutors).where(eq(tutors.email, normalizeEmail(email)));
  return row;
}

export async function countTutors(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(tutors);
  return row?.n ?? 0;
}

/** A new account; undefined when the email is taken. */
export async function createTutor(input: {
  email: string;
  name: string;
  password: string;
  isAdmin?: boolean;
}): Promise<Tutor | undefined> {
  const [row] = await db
    .insert(tutors)
    .values({
      id: genId(),
      email: normalizeEmail(input.email),
      name: input.name.trim() || 'Tutor',
      passwordHash: await hashPassword(input.password),
      isAdmin: input.isAdmin ?? false,
    })
    .onConflictDoNothing({ target: tutors.email })
    .returning();
  return row;
}

/** A new password, which also signs out every existing session. */
export async function setPassword(tutorId: string, password: string): Promise<Tutor | undefined> {
  const [row] = await db
    .update(tutors)
    .set({
      passwordHash: await hashPassword(password),
      sessionVersion: sql`${tutors.sessionVersion} + 1`,
      resetTokenHash: null,
      resetExpiresAt: null,
    })
    .where(eq(tutors.id, tutorId))
    .returning();
  return row;
}

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

/** A one-hour reset token for this tutor. Only its hash is stored. */
export async function issueResetToken(tutorId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db
    .update(tutors)
    .set({ resetTokenHash: tokenHash(token), resetExpiresAt: new Date(Date.now() + 3_600_000) })
    .where(eq(tutors.id, tutorId));
  return token;
}

/** The tutor a reset token belongs to, while it is unused and unexpired. */
export async function tutorByResetToken(token: string): Promise<Tutor | undefined> {
  const [row] = await db
    .select()
    .from(tutors)
    .where(and(eq(tutors.resetTokenHash, tokenHash(token)), gt(tutors.resetExpiresAt, new Date())));
  return row;
}

/**
 * First boot of a server with no accounts: the operator's account, from
 * `TUTOR_PASSWORD` / `TUTOR_EMAIL` / `TUTOR_NAME`. It takes over every board
 * made before accounts existed (all but the demo) and the instance-wide
 * feature defaults those boards followed. Runs once; later changes to the env
 * password do nothing — `npm run tutor:password` resets it.
 */
export async function bootstrapAdmin(): Promise<void> {
  if ((await countTutors()) > 0) return;
  const admin = await createTutor({
    email: env.tutorEmail,
    name: env.tutorName,
    password: env.tutorPassword,
    isAdmin: true,
  });
  if (!admin) return;
  const [demo] = await db.select().from(appSettings).where(eq(appSettings.key, 'demo'));
  const demoId = (demo?.value as { id?: string } | undefined)?.id ?? '';
  await db
    .update(boards)
    .set({ tutorId: admin.id })
    .where(and(isNull(boards.tutorId), ne(boards.id, demoId)));
  const [features] = await db.select().from(appSettings).where(eq(appSettings.key, 'features'));
  if (features) {
    await db.update(tutors).set({ features: features.value }).where(eq(tutors.id, admin.id));
    await db.delete(appSettings).where(eq(appSettings.key, 'features'));
  }
  console.log(`[server] Created the admin account "${admin.email}" from TUTOR_PASSWORD.`);
}
