# Whiteboard

A self-hostable, real-time collaborative whiteboard for 1-on-1 and small-group
tutoring. The tutor signs in with a password and shares each board with
students through a link. Students need no account.

## Features

- **Infinite canvas** with pages, frames, groups and a minimap
- **Ink** for pen and finger, plus a highlighter, eraser, lasso selection, compass and laser pointer
- **Shapes**: rectangles, ellipses, polygons, lines, arrows and connectors, text, and stickers
- **Maths**: typeset equations (MathLive/MathJax) and function graphs. Optional
  AI turns handwriting or a description into LaTeX.
- **Media**: images, PDFs and worksheets, YouTube videos, link previews
- **Live session**: cursors, follow mode, comments, voice, camera and screen
  share, and a shared music player
- **For the tutor**: share links that can be edit, view-only or off; removing a
  student; attendance and per-session notes; PNG and board export
- **Offline**: boards cache locally and sync when the connection comes back

## Quick start

Requirements: Node.js 22+ (see `.nvmrc`), npm 10+, and PostgreSQL 16+.

```bash
npm install
cp server/.env.example server/.env   # set TUTOR_PASSWORD and SESSION_SECRET
```

Start Postgres, using **either** Homebrew:

```bash
brew install postgresql@16 && brew services start postgresql@16
createdb whiteboard
# server/.env: DATABASE_URL=postgres://localhost:5432/whiteboard
```

**or** Docker, which runs on port 5433 and matches the default `DATABASE_URL`:

```bash
npm run db:up
```

Then create the schema and start developing:

```bash
npm run db:migrate
npm run dev
```

- Client (Vite, hot reload): http://localhost:5173
- Server (API + collaboration socket): http://localhost:3001. Vite proxies
  `/api` and `/collab` to it.

The server boots without Postgres, so sign-in works, but boards only load and
save once the database is up.

## Teaching from your laptop

`npm run dev` is for working on the app. For a lesson, serve a built copy:

```bash
npm run build
npm start                 # http://localhost:3001
cloudflared tunnel run    # or: cloudflared tunnel --url http://localhost:3001
caffeinate -dis           # keep the Mac awake for the lesson
```

Students open a board's share link (`/board/:id?k=…`). The Share popover makes
it view-only, turns it off, replaces it, or removes a student.

Rules that keep a lesson safe while you keep changing the code:

- **Students only see changes after you rebuild and restart.** The client is
  served from `client/dist`, and the server loads its code once at startup.
  Do both between lessons, with code you have tried in `npm run dev`.
- **Don't run `npm run dev` during a lesson** on the same port and database.
  Both default to port 3001 and the `server/.env` database, so test edits
  would land on real boards.
- **Ctrl-C is safe.** The server saves every open board before it exits.
- Behind Cloudflare, set `CLIENT_IP_HEADER=cf-connecting-ip` so login rate
  limits apply per student rather than to everyone at once.

## Configuration

Everything lives in `server/.env`. See `server/.env.example` for the full
list with comments.

| Variable | Required | Purpose |
|---|---|---|
| `TUTOR_PASSWORD` | yes | The only login: the tutor's |
| `SESSION_SECRET` | yes | Signs the session cookie. Use a long random string |
| `DATABASE_URL` | yes | Postgres connection |
| `TUTOR_NAME` | | Name on the tutor's cursor |
| `PORT` | | Server port (default 3001) |
| `CLIENT_IP_HEADER` | | Real client IP header behind a proxy (`cf-connecting-ip` for Cloudflare) |
| `UPLOAD_QUOTA_GB` | | Disk cap for uploads (default 20) |
| `OPENROUTER_API_KEY` | | Turns on the AI equation buttons. They are hidden when unset |
| `BLOB_DIR`, `DOC_DIR`, `MUSIC_DIR` | | Where images, documents and music live (default `server/data/…`) |
| `SOURCE_URL` | | Where the in-app "Source code" link points (see License) |
| `DEMO`, `DEMO_RESET_MINUTES`, `DEMO_SEED` | | Public demo board at `/demo` (see below) |

With `NODE_ENV=production` (the Docker image sets it), the server refuses to
start if the three required variables are missing, instead of falling back to
insecure defaults.

### Features per board

The tutor picks which optional features boards offer: AI, stickers, voice and
video, music, comments, files, YouTube and links, graphs, equations, compass
and ruler, templates and the laser. Set the defaults from the account menu on
the home screen (**Features…**). Change a single board from its ⋯ menu
(**Features**), and **Use my defaults** sets it back. Turning a feature off
removes the ways to add it, but whatever is already on the board stays. AI,
files and link previews are also refused by the server, because they cost
money or disk.

### Public demo

`DEMO=1` serves a board at `/demo` that anyone can draw on without signing in.
Every `DEMO_RESET_MINUTES` (default 60) it is replaced by a fresh board, empty
or copied from the `.board` file in `DEMO_SEED`. AI, files and music are off
on it, and it does not show in the tutor's library.

Music player: put audio files in `server/data/music/<playlist>/`. Each folder
is a playlist (mp3, m4a, wav, ogg, aac, flac, webm).

## Database changes

The schema is in `server/src/db/schema.ts`, and migrations in `server/drizzle/`
are committed to git.

```bash
# after editing schema.ts
npm run db:generate   # writes a new migration file, review and commit it
npm run db:migrate    # applies pending migrations to the database in server/.env
```

`db:migrate` is safe to run any time: it only applies what is missing. A
database created earlier with `db:push` takes over the migration history on
its first run, with no data changes.

## Backups and moving machines

A board's state lives in two places, and a backup needs both:

1. **Postgres**: board content, metadata, attendance.
2. **`server/data/`**: uploaded images (`blobs/`) and documents (`docs/`).
   Boards refer to these files by hash, so a database without them shows
   broken images.

```bash
# Postgres (use the Docker container's pg_dump if Postgres runs in Docker)
pg_dump -Fc "$DATABASE_URL" > whiteboard.dump
tar czf whiteboard-data.tgz -C server data

# restore elsewhere
pg_restore -d "<TARGET_DATABASE_URL>" --clean --if-exists whiteboard.dump
tar xzf whiteboard-data.tgz -C server
```

## Running with Docker

The production image builds the client, applies migrations, then starts the
server:

```bash
docker compose --profile app up -d --build   # app on :3001, plus Postgres
```

It reads `server/.env` and keeps uploads in the `whiteboard_data` volume.
On a stop, it gets 30s to save open boards. Without `--profile app`,
`npm run db:up` starts Postgres alone.

This setup runs as-is on any VPS. The server needs a persistent Node process
(WebSockets, local file storage), so serverless and static hosts won't work.
Behind the Cloudflare proxy, make sure WebSockets are enabled.

## Scripts

```bash
npm run dev           # client + server with hot reload
npm run build         # production build of the client
npm start             # serve the build + API + collaboration on :3001
npm run check         # typecheck + all tests
npm run lint          # oxlint
npm run db:up         # start Postgres in Docker (db:down to stop)
npm run db:migrate    # apply pending migrations
npm run db:generate   # write a migration after a schema change
```

## Repository layout

```
shared/   @whiteboard/shared: types, contracts and geometry used by both sides
client/   React 19 + Vite: canvas engine, tools, UI
server/   Hono API + Hocuspocus (Yjs) collaboration + Drizzle/Postgres
```

How it fits together, in brief:

- Each board is a **Yjs** document, plus one document per page, synced through
  **Hocuspocus** over a WebSocket. The server stores a snapshot plus an
  append log of updates in Postgres. The browser keeps a copy in IndexedDB for
  offline use.
- All canvas edits go through one `Editor` interface. Undo is per page and
  covers only your own edits.
- Shapes and tools are registries (`client/src/canvas/shapes`, `tools`), so
  adding one doesn't touch the core.

[REPO_MAP.md](REPO_MAP.md) has the full file map, invariants and extension
patterns.

## Known limitations

- **One account.** There is a single tutor and no student accounts.
- **Voice and video are peer-to-peer with STUN only.** They can fail on strict
  school or corporate networks until a TURN server is configured
  (`client/src/collab/voice/peer-connection.ts`).
- **Uploads need no login** (students upload through share links). The upload
  quota is the only cap.

## Self-hosting or hosted

You can run this yourself, for free, with everything in this README. You
bring your own server, Postgres and, if you want AI, your own OpenRouter key.

If you'd rather not set anything up, use the hosted service instead.

## License

[GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`).

You may use, modify and self-host this freely. If you let other people use a
modified copy over a network, you must offer them its source under the same
license. Set `SOURCE_URL` to where your changes are published: the app's ⋯ →
**Source code** link points there.
