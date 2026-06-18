# Whiteboard

A self-hostable, real-time collaborative whiteboard for 1-on-1 and small-group
tutoring. Infinite canvas, freehand drawing, shapes, and multiplayer cursors —
built from the ground up.

> **Status:** under active construction, phase by phase.

## Requirements

- Node.js 22+ (see `.nvmrc`)
- npm 10+ (workspaces)
- Docker (for Postgres) — only needed for server-backed persistence

## Setup

```bash
npm install
cp server/.env.example server/.env   # set TUTOR_PASSWORD and SESSION_SECRET
```

For server-backed board content (collaboration) you also need Postgres:

```bash
npm run db:up      # start Postgres via docker-compose
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
