# Architecture

> **Status:** stack decided (Fastify + React + PostgreSQL). Implementation is scaffolding-first.

## Product context

Scelta digitizes church voting rooms: admin-configured quorum and rounds, QR join, anonymous single ballots, automatic tally, candidate lists from member rolls, optional moderated reactions.

## Chosen stack

| Concern | Choice | Why |
| --- | --- | --- |
| Language | TypeScript | Shared types across API, web, and domain |
| API | Fastify + TypeBox | Schema validation on every route; lean Node runtime |
| Realtime UX | Socket.io | Presence, round state, reactions (not ballots) |
| Web | React + Vite | Admin + voter UI; simple Docker/static hosting |
| Domain rules | `@scelta/domain` | Pure functions for quorum/majority/rounds — unit-tested |
| Database | PostgreSQL + Drizzle | ACID tallies; explicit SQL-friendly schema |
| Monorepo | pnpm workspaces | Clear package boundaries |
| Deploy | Docker Compose | Self-hostable for church data control |

## Context (C4 — Level 1)

```mermaid
C4Context
    title Scelta — System Context

    Person(admin, "Room admin", "Creates rooms, sets quorum, starts/restarts votes")
    Person(voter, "Eligible member", "Joins room, votes once per round, may react")
    System(scelta, "Scelta", "Web voting rooms with IPB-aware rules")
    System_Ext(members, "Member roll source", "Communicant / society lists — import TBD")

    Rel(admin, scelta, "Manages rooms and elections")
    Rel(voter, scelta, "Joins via QR / link, votes")
    Rel(scelta, members, "Imports eligible members and candidates")
```

## Containers (C4 — Level 2)

```mermaid
C4Container
    title Scelta — Containers

    Person(admin, "Admin")
    Person(voter, "Voter")

    Container_Boundary(scelta, "Scelta") {
        Container(web, "Web Client", "React + Vite", "Admin console + voter UI + QR join")
        Container(api, "Application API", "Fastify + Socket.io", "HTTP for ballots; WS for presence/reactions")
        ContainerDb(db, "Database", "PostgreSQL", "Rooms, members, anonymous ballots, receipts, audit")
    }

    Rel(admin, web, "HTTPS")
    Rel(voter, web, "HTTPS + QR")
    Rel(web, api, "HTTPS / JSON")
    Rel(web, api, "WebSocket")
    Rel(api, db, "SQL via Drizzle")
```

## Ballot vs realtime

```mermaid
flowchart LR
  subgraph http [HTTP_transactional]
    CastVote[POST_cast_vote]
    Tally[Close_and_tally]
  end
  subgraph ws [WebSocket_UX]
    Presence[Presence]
    RoundState[Round_state]
    Reactions[Reactions]
  end
  CastVote --> Postgres[(PostgreSQL)]
  Tally --> Postgres
  Presence --> SocketIO[Socket.io]
  RoundState --> SocketIO
  Reactions --> SocketIO
  Tally --> SocketIO
```

**Invariant:** `ballots` never store `participant_id`. `vote_receipts` store that someone voted, not for whom.

## Core flow

```mermaid
sequenceDiagram
    actor Admin
    actor Voter
    participant Web
    participant API
    participant RT as SocketIO
    participant DB as Postgres

    Admin->>Web: Create room
    Web->>API: Persist room
    API->>DB: Store room + invite token
    Admin->>Web: Show QR / link

    Voter->>Web: Open QR join
    Web->>API: Claim seat / presence
    API->>DB: Register participant
    API->>RT: Presence updated

    Admin->>Web: Start round
    Web->>API: Open ballot
    API->>RT: Round open

    Voter->>Web: Cast anonymous vote
    Web->>API: Submit ballot
    API->>DB: Ballot + VoteReceipt

    Admin->>Web: Close round
    API->>DB: Tally via domain rules
    API->>RT: Publish result
```

## Decisions log

| Date | Decision | Rationale | Status |
| --- | --- | --- | --- |
| 2026-03-26 | Product = church voting rooms (IPB-first) | Stakeholder description | Accepted |
| 2026-03-26 | Fastify + React + PostgreSQL + Socket.io + Docker | Serious schema-validated API, TS end-to-end, self-host | Accepted |

## Open questions

- Admin auth provider details (session cookies vs OIDC)
- Exact voter identity claim UX at QR join
- Multi-tenant SaaS vs single-church deploy defaults
