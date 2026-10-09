import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { Context } from 'hono';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { env } from './env';
import { absolutePreviewUrls, requestOrigin } from './app-shell';
import { aiRoutes } from './ai/routes';
import { analyticsRoutes } from './analytics/routes';
import { authRoutes } from './auth/routes';
import { blobRoutes } from './blobs/routes';
import { boardRoutes } from './boards/routes';
import { documentRoutes } from './documents/routes';
import { hocuspocus } from './collab/hocuspocus';
import { linkRoutes } from './links/routes';
import { musicRoutes } from './music/routes';
import { pageRoutes } from './collab/page-routes';
import { clientErrorRoutes } from './client-errors';

const app = new Hono();

app.use(
  '*',
  secureHeaders({
    // YouTube refuses to play an embed that arrives with no referrer at all
    // (its "error 153"), which the default `no-referrer` would guarantee.
    referrerPolicy: 'strict-origin-when-cross-origin',
    // Browsers ignore this over plain HTTP, so it costs local use nothing.
    strictTransportSecurity: 'max-age=31536000',
    xFrameOptions: 'DENY',
  }),
);

/**
 * What the app shell may load. Only on HTML: it governs documents, and on an
 * inline PDF it would get in the way of the browser's own viewer.
 *
 * - `wasm-unsafe-eval`: pdf.js decodes scanned worksheets (JBIG2/JPEG2000) in
 *   WebAssembly. It permits compiling wasm, not `eval`.
 * - `style-src 'unsafe-inline'`: React `style={}` props, the canvas layout and
 *   MathJax's injected stylesheet all depend on it.
 * - YouTube: the video shape's thumbnail, the PNG export inlining it, and the
 *   player iframe.
 * - The collab socket's own origin is named outright in `connect-src`: Safari
 *   before 15.4 does not count `ws:`/`wss:` as `'self'`, and old iPads are
 *   exactly where this board runs.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://img.youtube.com",
  "font-src 'self' data:",
  "media-src 'self' blob: data:",
  "connect-src 'self' blob: data: https://img.youtube.com __SOCKET__",
  "worker-src 'self' blob:",
  'frame-src https://www.youtube.com https://www.youtube-nocookie.com',
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

app.use('*', async (c, next) => {
  await next();
  if (c.res.headers.get('content-type')?.startsWith('text/html')) {
    // `requestOrigin` only lets a well-formed host through, so a forwarded
    // header can't smuggle a directive in here.
    const socket = requestOrigin(
      c.req.url,
      c.req.header('x-forwarded-proto'),
      c.req.header('x-forwarded-host'),
    ).replace(/^http/, 'ws');
    c.res.headers.set(
      'Content-Security-Policy',
      CONTENT_SECURITY_POLICY.replace('__SOCKET__', socket),
    );
  }
});

app.get('/health', (c) => c.json({ status: 'ok' }));
app.route('/api/ai', aiRoutes);
app.route('/api/analytics', analyticsRoutes);
app.route('/api/auth', authRoutes);
app.route('/api/boards', boardRoutes);
app.route('/api/client-errors', clientErrorRoutes);
app.route('/api/blobs', blobRoutes);
app.route('/api/docs', documentRoutes);
app.route('/api/links', linkRoutes);
app.route('/api/music', musicRoutes);
app.route('/api/pages', pageRoutes);

const clientDist = fileURLToPath(new URL('../../client/dist', import.meta.url));
const clientIndex = fileURLToPath(
  new URL('../../client/dist/index.html', import.meta.url),
);

/** The SPA shell, with its link-preview image pointed at this deployment. */
const serveIndexHtml = async (c: Context) => {
  const index = await readFile(clientIndex, 'utf8');
  const origin = requestOrigin(
    c.req.url,
    c.req.header('x-forwarded-proto'),
    c.req.header('x-forwarded-host'),
  );
  // The shell names this build's hashed asset files, so a cached copy pins the
  // whole app to an old release. `no-cache` still allows a conditional request
  // — it means revalidate, not refetch. This matters most where there is no
  // address bar to force a reload from: the board added to an iPad's Home
  // Screen is a standalone app whose only route to a new build is this header.
  c.header('Cache-Control', 'no-cache');
  return c.html(absolutePreviewUrls(index, origin));
};

// Ahead of the static handler: it would otherwise answer '/' with the file on
// disk, whose preview tags are still relative.
app.get('/', serveIndexHtml);
// Vite fingerprints everything under /assets, so those files are immutable and
// can be held for as long as the browser likes — which is what makes the
// shell's `no-cache` cheap rather than a full re-download on every launch.
app.use('/assets/*', async (c, next) => {
  await next();
  if (c.res.ok) {
    c.res.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  }
});
app.use('/*', serveStatic({ root: clientDist }));
app.get('*', serveIndexHtml);

const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`[server] HTTP + collab listening on http://localhost:${info.port}`);
});

// Route WebSocket upgrades to Hocuspocus (board collaboration). Each document
// is gated in its `onAuthenticate` (boards/access.ts). In Hocuspocus v4 the
// ClientConnection returned by handleConnection must be fed socket messages
// explicitly.
const wss = new WebSocketServer({
  noServer: true,
  // Full Yjs sync updates include retained CRDT history and can exceed the
  // current live document size. Binary assets still use HTTP endpoints, so
  // keep a bounded ceiling while leaving room for established boards to sync.
  maxPayload: 32 * 1024 * 1024,
  // Off by default in `ws`. Stored snapshots already shrink to 37% (V1) and
  // 52% (V2) under Postgres's weaker pglz, and the initial sync is V1, so a
  // board's first load is mostly compressible. The default 1 KB threshold
  // leaves the small per-frame ink and cursor messages uncompressed.
  perMessageDeflate: true,
});
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    // `ws` emits receiver errors (including payload-limit violations) on the
    // individual socket. Always handle them so one bad peer cannot terminate
    // the HTTP and collaboration server.
    ws.on('error', (error) => {
      console.warn(`[server] Collaboration WebSocket closed: ${error.message}`);
    });
    const connection = hocuspocus.handleConnection(ws, request);
    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      const buf = Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.from(data as Buffer);
      connection.handleMessage(new Uint8Array(buf));
    });
    ws.on('close', (code: number, reason: Buffer) => {
      connection.handleClose({ code, reason: reason?.toString() });
    });
  });
});
