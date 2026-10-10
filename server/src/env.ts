import 'dotenv/config';

const production = process.env.NODE_ENV === 'production';

function warnDefault(name: string): void {
  // A dev default in production is a known password or a secret that logs
  // everyone out on each restart — refuse to boot rather than run like that.
  if (production) throw new Error(`[server] ${name} must be set in production.`);
  console.warn(
    `[server] ${name} is not set — using an insecure dev default. Set it in server/.env for real use.`,
  );
}

const tutorPassword = process.env.TUTOR_PASSWORD;
if (!tutorPassword) warnDefault('TUTOR_PASSWORD');

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) warnDefault('SESSION_SECRET');

if (production && !process.env.DATABASE_URL) warnDefault('DATABASE_URL');

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
  /** Directory where board repository documents are stored (content-addressed). */
  docDir: process.env.DOC_DIR ?? 'data/docs',
  /**
   * Total bytes the open upload endpoints may hold across `blobDir` and
   * `docDir`. Uploads need no login, so this is what stops them filling the
   * disk Postgres shares.
   */
  uploadQuotaBytes: Number(process.env.UPLOAD_QUOTA_GB ?? 20) * 1024 ** 3,
  /** Request header carrying the real client IP behind a proxy (see rate-limit.ts). */
  clientIpHeader: process.env.CLIENT_IP_HEADER?.toLowerCase() || undefined,
  /**
   * OpenRouter credentials for the AI LaTeX endpoints. Unset is a supported
   * configuration rather than a broken one: the routes answer 503 and the
   * canvas hides the two buttons that would call them.
   */
  openRouterApiKey: process.env.OPENROUTER_API_KEY,
  /**
   * The model that reads ink. Kept on DeepSeek's vision listing rather than
   * the earlier `stealth/ox-alpha` preview slug: same family as the text
   * model below, so `REASONING` in `openrouter.ts` can turn reasoning off
   * outright instead of only down to `effort: 'low'`.
   */
  openRouterVisionModel:
    process.env.OPENROUTER_VISION_MODEL ?? 'deepseek/deepseek-v4-flash-vision-exp',
  /**
   * Text-only sibling, for writing a formula from its name. Kept on DeepSeek
   * rather than the same stealth slug: that one is a vision listing, and this
   * job never sends an image.
   */
  openRouterTextModel:
    process.env.OPENROUTER_TEXT_MODEL ?? 'deepseek/deepseek-v4-flash',
  /** Speech-to-text for dictating a description. Accepts webm and mp4 as-is. */
  openRouterSttModel:
    process.env.OPENROUTER_STT_MODEL ?? 'openai/whisper-large-v3',
} as const;
