# Phase 2 + 3: tutor accounts and paid hosting

Goal: anyone can self-host for free, while the easy option is the hosted
server — sign up, the free plan (everything except AI), and Pro (adds AI)
through Stripe. The public demo and per-board features (Phase 1) are already
done.

## Decisions (2026-11-19)

- Sign-in: email + password. Password-reset emails go through Resend when
  `RESEND_API_KEY` is set; otherwise an admin command resets passwords.
- Plans: Free has everything except AI; Pro adds AI. The price lives in
  Stripe (`STRIPE_PRICE_ID`), not in code.
- Built in the private repo, then replayed onto `tunjan/whiteboard`.

## Phase 2: tutor accounts

**Data** (one migration)
- `tutors`: id, email (unique, lowercased), name, password_hash (scrypt),
  is_admin, features jsonb, plan (`free` | `pro`), stripe_customer_id,
  session_version, reset_token_hash, reset_expires_at, created_at.
- `boards.tutor_id` (null for the demo board).
- The `features` row in `app_settings` moves to `tutors.features`.

**Bootstrap (self-host stays a single password)**
- On first boot with no tutors, create the admin from `TUTOR_PASSWORD`,
  `TUTOR_NAME` and `TUTOR_EMAIL` (default `tutor`). Give it every board with
  no owner (except the demo), plus the old `app_settings.features`.
- `npm run tutor:password -w server -- <email>` resets a password from stdin.
- With one tutor and sign-ups closed, the login screen stays password-only.

**Ownership: one choke point**
- The JWT carries `tutorId` and `session_version`. `verifySession` checks
  both against `tutors`, so a password reset logs out every other session.
- `boardAccess` returns `'tutor'` only when the session's tutor owns the
  board. That covers the collab socket, `requireBoardEdit`, AI, uploads and
  attendance, which all route through it.
- `requireTutor` puts the tutor on the context. The board management routes
  check ownership in one middleware (404 for a board that isn't yours).
- The client-minted board upsert won't overwrite another tutor's board.
- Scoped to the tutor's own boards: the library, live boards, analytics
  (AI cost, agent asks, sessions) and the feature defaults.
- Admin only: AI models (the operator's bill), and the toolbar usage log.

**Accounts API**
- `GET /api/auth/config` returns `{ signups, passwordOnly, billing, demo, resetByEmail }`.
- `POST /api/auth/signup`: only with `SIGNUPS=open`. Rate-limited, 8+ character
  password, emails are not verified.
- `POST /api/auth/login`: `{ email?, password }`.
- `POST /api/auth/forgot` always answers 200; with Resend configured, it emails
  a one-hour link.
- `POST /api/auth/reset` takes `{ token, password }`.
- `GET /api/auth/me` returns name, email, plan, isAdmin.

**Client**
- The login screen gets sign-in, create account and forgot password, plus a
  "Try the demo" link.
- A `/reset?token=` screen.

## Phase 3: billing

- Billing is on only when `STRIPE_SECRET_KEY` is set. Self-hosts never see it,
  and AI is on for everyone there.
- AI on a board = server has an OpenRouter key AND (no billing OR the owner is
  Pro OR the owner is an admin).
- `POST /api/billing/checkout` returns a Stripe Checkout URL (subscription to
  `STRIPE_PRICE_ID`).
- `POST /api/billing/portal` returns a Stripe customer-portal URL.
- `POST /api/billing/webhook` checks the signature (HMAC-SHA256,
  `STRIPE_WEBHOOK_SECRET`, 5-minute tolerance) and sets `tutors.plan` from the
  subscription status. Plain `fetch`, no Stripe SDK.
- In the account menu: "Upgrade to Pro" or "Manage billing". The Features
  dialog marks AI as Pro.

## Hosting kit

- In `docker-compose.yml`, a `cloudflared` service under the `app` profile
  (`TUNNEL_TOKEN`), so a VPS needs no open ports.
- `server/scripts/backup.sh`: a `pg_dump` plus the uploads volume.
- A "Hosting it for others" section in the README: VPS, env, Stripe webhook,
  Resend, backups.

## Verification

- Unit tests:
  - scrypt hash and verify
  - ownership: tutor B is refused on tutor A's board, by both HTTP and access
  - signup off and on
  - reset-token expiry
  - webhook signature (good, bad, stale)
  - plan → AI
- End to end on a throwaway Postgres: two tutors, isolation, the demo, the
  features push, and the bootstrap of an old single-tutor database.
- `npm run check`.

## Out of scope (needs you)

- Renting the VPS.
- Creating the Stripe and Resend accounts and keys.
- DNS.
- Choosing the price.
