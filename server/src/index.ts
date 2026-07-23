import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { env } from './env';
import { authRoutes } from './auth/routes';
import { blobRoutes } from './blobs/routes';
import { boardRoutes } from './boards/routes';
import { documentRoutes } from './documents/routes';
import { hocuspocus } from './collab/hocuspocus';
import { musicRoutes } from './music/routes';
import { recordingRoutes } from './recordings/routes';

const app = new Hono();

app.get('/health', (c) => c.json({ status: 'ok' }));
app.route('/api/auth', authRoutes);
app.route('/api/boards', boardRoutes);
app.route('/api/blobs', blobRoutes);
app.route('/api/docs', documentRoutes);
app.route('/api/music', musicRoutes);
app.route('/api/recordings', recordingRoutes);

const clientDist = fileURLToPath(new URL('../../client/dist', import.meta.url));
const clientIndex = fileURLToPath(
  new URL('../../client/dist/index.html', import.meta.url),
);

app.use('/*', serveStatic({ root: clientDist }));
app.get('*', async (c) => {
  const index = await readFile(clientIndex, 'utf8');
  return c.html(index);
});

const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`[server] HTTP + collab listening on http://localhost:${info.port}`);
});

// Route WebSocket upgrades to Hocuspocus (board collaboration). Rooms are open;
// the board id (capability URL) is the secret. In Hocuspocus v4 the
// ClientConnection returned by handleConnection must be fed socket messages
// explicitly.
const wss = new WebSocketServer({
  noServer: true,
  // Collaboration updates are compact and binary assets use HTTP endpoints.
  // Bound raw frames before Hocuspocus decodes stateless payloads into strings.
  maxPayload: 5 * 1024 * 1024,
});
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
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
