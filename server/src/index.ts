import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { WebSocketServer } from 'ws';
import { env } from './env';
import { authRoutes } from './auth/routes';
import { blobRoutes } from './blobs/routes';
import { boardRoutes } from './boards/routes';
import { hocuspocus } from './collab/hocuspocus';

const app = new Hono();

app.get('/health', (c) => c.json({ status: 'ok' }));
app.route('/api/auth', authRoutes);
app.route('/api/boards', boardRoutes);
app.route('/api/blobs', blobRoutes);

const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`[server] HTTP + collab listening on http://localhost:${info.port}`);
});

// Route WebSocket upgrades to Hocuspocus (board collaboration). Rooms are open;
// the board id (capability URL) is the secret. In Hocuspocus v4 the
// ClientConnection returned by handleConnection must be fed socket messages
// explicitly.
const wss = new WebSocketServer({ noServer: true });
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
