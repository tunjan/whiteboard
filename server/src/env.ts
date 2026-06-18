import 'dotenv/config';

function warnDefault(name: string): void {
  console.warn(
    `[server] ${name} is not set — using an insecure dev default. Set it in server/.env for real use.`,
  );
}

const tutorPassword = process.env.TUTOR_PASSWORD;
if (!tutorPassword) warnDefault('TUTOR_PASSWORD');

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) warnDefault('SESSION_SECRET');

export const env = {
  port: Number(process.env.PORT ?? 3001),
  /** Plaintext tutor password, compared in constant time. */
  tutorPassword: tutorPassword ?? 'tutor',
  /** Secret used to sign the session JWT. Random per-boot if unset. */
  sessionSecret: sessionSecret ?? crypto.randomUUID(),
  tutorName: process.env.TUTOR_NAME ?? 'Tutor',
  databaseUrl:
    process.env.DATABASE_URL ??
    'postgres://whiteboard:whiteboard@localhost:5433/whiteboard',
  /** Directory where uploaded image blobs are stored (content-addressed). */
  blobDir: process.env.BLOB_DIR ?? 'data/blobs',
  /** Directory containing local audio files grouped by playlist folders. */
  musicDir: process.env.MUSIC_DIR ?? 'data/music',
} as const;
