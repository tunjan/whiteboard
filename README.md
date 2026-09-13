# Whiteboard

A self-hostable, real-time collaborative whiteboard for 1-on-1 and small-group
tutoring. Infinite canvas, freehand drawing, shapes, and multiplayer cursors —
built from the ground up.

> **Status:** under active construction, phase by phase.

## Requirements

- Node.js 22+ (see `.nvmrc`)
- npm 10+ (workspaces)
- PostgreSQL 16+ — only needed for server-backed persistence and collaboration. Docker is **optional**; native Postgres (e.g. via Homebrew) or managed cloud Postgres (Neon, Supabase) are fully supported.

## Setup

```bash
npm install
cp server/.env.example server/.env   # set TUTOR_PASSWORD, SESSION_SECRET, and DATABASE_URL
```

For server-backed board content (collaboration), start Postgres and apply the schema:

**Option A: Native macOS Postgres (Lightweight, no Docker)**

```bash
brew install postgresql@16
brew services start postgresql@16
createdb whiteboard
# in server/.env: DATABASE_URL=postgres://localhost:5432/whiteboard
npm run db:push
```

**Option B: Docker Compose**

```bash
npm run db:up      # start Postgres via docker-compose on port 5433
# in server/.env: DATABASE_URL=postgres://whiteboard:whiteboard@localhost:5433/whiteboard
npm run db:push    # create the schema (boards, board_documents)
```

## Develop

```bash
npm run dev
```

This starts both workspaces concurrently:

- **client** — Vite dev server at http://localhost:5173
- **server** — Hono HTTP API (tutor auth) + Hocuspocus collaboration server at
  http://localhost:3001

Local music files can be placed under `server/data/music`. First-level folders
become playlists, and supported audio files (`.mp3`, `.m4a`, `.wav`, `.ogg`,
`.oga`, `.aac`, `.flac`, `.webm`) appear in the whiteboard music player.

The server boots without Postgres (auth works on its own); Postgres is only
needed once boards sync through the server. The boards home screen is gated
behind the single tutor password (`/api/auth/login`); board links
(`/board/:id`) are open by capability URL.

## Repository layout

```
/shared   @whiteboard/shared — cross-cutting TypeScript types & contracts
/client   React 19 + Vite app (canvas engine + UI)
/server   Node collaboration server (Hocuspocus + Postgres, later phases)
```

## Other scripts

```bash
npm run typecheck   # strict TS check across all workspaces
npm run build       # production build of the client
npm start           # serve the built client + API/collab server
npm run db:up       # start Postgres (docker-compose)
npm run db:down     # stop Postgres
npm run db:push     # apply the Drizzle schema
```

## Tech stack

- **Client:** React 19 + Vite + TypeScript (strict)
- **Styling:** Tailwind CSS v4 (CSS-first `@theme` in `client/src/index.css`)
- **Components:** shadcn/ui on **Base UI** primitives; icons via **Lucide**
- **Theme:** near-monochrome oklch palette + one restrained accent
  (`--accent-brand`) reserved for selection, the active tool, and primary actions

## Architecture

- **Shape/tool registries** (`client/src/canvas/shapes`, `tools`) — the core
  canvas iterates registries; adding a shape or tool is additive.
- **`Editor` seam** — all content mutations flow through one interface, now
  backed by a **Yjs** doc (per-board) with `Y.UndoManager` (local-origin undo).
- **Persistence** — local content via `y-indexeddb`; the server persists each
  board's opaque Yjs state as Postgres `bytea` via Drizzle (Hocuspocus
  Database extension). Relational columns hold board metadata only.
- **`BoardRepository`** seam — the home screen talks only to this interface
  (IndexedDB now, server REST in a later phase).
- **Auth** — a single tutor credential (`TUTOR_PASSWORD`, constant-time
  compare) signs a `jose` JWT session cookie; gates the boards home only.

## Database Migration & Backups

To move an existing database (e.g. from Docker to native Postgres, or to a cloud provider):

1. **Export dump from Docker container:**

   ```bash
   docker exec bestwhiteboard-postgres-1 pg_dump -U whiteboard -d whiteboard -Fc > whiteboard_backup.dump
   ```

2. **Restore to target database:**
   ```bash
   # Native local Postgres:
   pg_restore -h localhost -p 5432 -d whiteboard --clean --if-exists whiteboard_backup.dump

   # Or remote cloud database:
   pg_restore -d "<REMOTE_DATABASE_URL>" --clean --if-exists whiteboard_backup.dump
   ```

> **Note on images:** Uploaded image assets live on the filesystem under `server/data/blobs`. When migrating or deploying to a new host, remember to copy this folder alongside your database.

## Deployment & Cloudflare

- **Cloudflare Tunnel (`cloudflared`):** Expose your local or VPS server (`localhost:3001`) to the internet. WebSockets and HTTP routes work out-of-the-box.
- **Cloudflare CDN / DNS Proxy:** If using a VPS behind Cloudflare, ensure **WebSockets** are enabled under Cloudflare Dashboard -> _Network_.
- **Cloudflare Pages:** You can host the static client (`client/dist` from `npm run build -w client`) on Cloudflare Pages, but the collaboration server (`server/`) requires a persistent Node.js runtime (e.g. Railway, Render, Fly.io, or a VPS) to maintain WebSocket connections and local blob storage.
