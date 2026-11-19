import { appendFile, mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { currentTutor, requireTutor } from './auth/middleware';
import { env } from './env';

/**
 * The tutor's toolbar and tool use (`client/src/lib/usage-log.ts`), appended
 * as CSV rows to `env.usageFile` for later analysis. Tutor-only, so students
 * never write here.
 *
 * ponytail: one ever-growing file; rotate by date if it gets unwieldy.
 */
export const usageRoutes = new Hono();

export const USAGE_COLUMNS = [
  'ts', 'session', 'board', 'event', 'tool', 'target', 'value', 'ms', 'count', 'pointer',
];

export function csvRow(fields: unknown[]): string {
  return (
    fields
      .map((f) => {
        const s = String(f ?? '').slice(0, 200);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      })
      .join(',') + '\n'
  );
}

usageRoutes.use('*', requireTutor);
// Only the operator's own use is kept: on a hosted server, other tutors'
// clicks are theirs, not something to log. Accepted and dropped, so their
// clients have nothing to retry.
usageRoutes.use('*', async (c, next) => (currentTutor(c).isAdmin ? next() : c.body(null, 204)));

usageRoutes.post('/', bodyLimit({ maxSize: 256 * 1024 }), async (c) => {
  const body = (await c.req.json().catch(() => null)) as { rows?: unknown } | null;
  if (!Array.isArray(body?.rows)) return c.body(null, 400);
  const rows = body.rows
    .filter(Array.isArray)
    .slice(0, 2000)
    .map((r: unknown[]) => csvRow(r.slice(0, USAGE_COLUMNS.length)));
  const file = env.usageFile;
  const exists = await stat(file).then(() => true, () => false);
  if (!exists) await mkdir(dirname(file), { recursive: true });
  await appendFile(file, (exists ? '' : csvRow(USAGE_COLUMNS)) + rows.join(''));
  return c.body(null, 204);
});
