# Scelta

**Scelta** is a web voting system for churches — starting with the workflows of the **Igreja Presbiteriana do Brasil (IPB)** — that moves paper ballots into a guided, auditable digital room.

## What it does

An **admin** creates a **voting room** for a specific election (e.g. Elder, Deacon, UPA board). In that room they set the **minimum presence (quorum)**, open and restart votes when needed, and let eligible people **join via QR code**. The system:

- Validates quorum before counting a result as valid
- Enforces **one vote per person** per round
- Keeps ballots **anonymous** (presence is known; choice is not linked to the voter)
- Tallies automatically and applies **majority / multi-round** rules
- Suggests **candidates from the communicant (or society) member list**, filtered by room type
- Optionally allows **controlled reactions** (emojis) during the meeting

## Stack

| Layer | Choice |
| --- | --- |
| API | Fastify + TypeBox + Socket.io |
| Web | React + Vite |
| Domain | `@scelta/domain` (quorum, majority, rounds) |
| Persistence | PostgreSQL + Drizzle (`@scelta/db`) |
| Monorepo | pnpm workspaces |
| Deploy | Docker Compose |

## Repository layout

```text
apps/
  api/       # Fastify HTTP + Socket.io
  web/       # React client
packages/
  domain/    # Pure IPB-oriented voting rules
  db/        # Drizzle schema + client
agents/      # Mandatory agent instructions
docs/        # Architecture, data model, backlog, voting rules
```

## Documentation

| Document | Path |
| --- | --- |
| Voting rules (IPB) | [`docs/voting-rules.md`](docs/voting-rules.md) |
| Architecture | [`docs/architecture.md`](docs/architecture.md) |
| Data model | [`docs/data-model.md`](docs/data-model.md) |
| Backlog | [`docs/backlog.md`](docs/backlog.md) |

## Getting started

```bash
cp .env.example .env
pnpm install
pnpm --filter @scelta/domain build
pnpm --filter @scelta/db build

# optional database. Host port 5433, so it can run beside another Postgres on 5432.
docker compose up -d postgres

# API + web. This compiles @scelta/domain and @scelta/db first.
pnpm dev
```

`pnpm dev` compiles those two packages because the API imports their built JavaScript, not the TypeScript source. Run the same two `build` commands yourself only when you change them without restarting `pnpm dev`. The dev server and the Compose web server proxy `/v1` to the API, so the browser stays on one origin and the session cookie is first-party.

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`. On startup the API creates that user as an admin when the email is not registered yet. The example password is for local development only: production refuses to start with it, or with a password shorter than 12 characters. An existing account is not promoted or given a new password on restart. Room administration requires role `admin`. Home, invite, and future voting pages stay usable without a login. The API creates the database tables on startup when `DATABASE_URL` is set. Without Postgres, `SCELTA_DB=pglite` starts an in-process database for local smoke tests.

- Web: http://localhost:5173  
- API health: http://localhost:3333/health  
