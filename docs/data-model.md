# Data model

> Draft domain model for Scelta. Technology (SQL/NoSQL, IDs) TBD.  
> **Anonymity invariant:** a `Ballot` must not be joinable to a `Participant` in a way that reveals the chosen option.

## Domain overview

```mermaid
erDiagram
    CHURCH ||--o{ USER : accounts
    USER ||--o{ SESSION : authenticates
    CHURCH ||--o{ MEMBER : enrolls
    CHURCH ||--o{ ROOM : hosts
    MEMBER ||--o{ ROOM_ELIGIBILITY : may_join
    ROOM ||--o{ PARTICIPANT : has
    ROOM ||--o{ ROUND : runs
    ROOM ||--o{ CANDIDATE : offers
    MEMBER ||--o{ CANDIDATE : nominated_as
    ROUND ||--o{ BALLOT : collects
    ROUND ||--o{ VOTE_RECEIPT : records
    PARTICIPANT ||--o{ VOTE_RECEIPT : marked
    PARTICIPANT ||--o{ REACTION : sends
    ROOM ||--o{ AUDIT_EVENT : logs

    CHURCH {
        uuid id PK
        string name
    }
    USER {
        uuid id PK
        uuid church_id FK
        string name
        string email
        string password_hash
        string role
    }
    SESSION {
        uuid id PK
        uuid user_id FK
        string token_hash
        datetime expires_at
    }
    MEMBER {
        uuid id PK
        uuid church_id FK
        string full_name
        boolean is_communicant
        boolean is_male
        date birth_date
        string society_flags
        datetime enrolled_at
    }
    ROOM {
        uuid id PK
        uuid church_id FK
        string title
        string room_type
        string rules_preset
        int quorum_value
        string quorum_unit
        int eligible_count
        string invite_token
        string status
    }
    PARTICIPANT {
        uuid id PK
        uuid room_id FK
        uuid member_id FK
        string display_name
        string join_key_hash
        datetime joined_at
        boolean is_present
    }
    ROUND {
        uuid id PK
        uuid room_id FK
        int number
        string office_label
        string status
        string outcome
        datetime opened_at
        datetime closed_at
    }
    CANDIDATE {
        uuid id PK
        uuid room_id FK
        uuid member_id FK
        string display_name
        boolean is_eligible
    }
    BALLOT {
        uuid id PK
        uuid round_id FK
        uuid candidate_id FK
        string ballot_token
    }
    VOTE_RECEIPT {
        uuid id PK
        uuid round_id FK
        uuid participant_id FK
        datetime cast_at
    }
    REACTION {
        uuid id PK
        uuid room_id FK
        uuid participant_id FK
        string emoji
        datetime created_at
    }
    AUDIT_EVENT {
        uuid id PK
        uuid room_id FK
        string actor_role
        string action
        json payload
        datetime created_at
    }
```

## Entities

### Church

Tenant / congregation using Scelta. `name` is unique: one row per church name, so concurrent room creation cannot split the admin list.

### User

Login account for the console. This is not the member roll and is never stored on a ballot.

| Field | Notes |
| --- | --- |
| `email` | Unique, stored lowercase |
| `password_hash` | scrypt hash. The raw password is never stored or returned |
| `role` | `admin` manages rooms. `member` can sign in and still cannot open the admin console. Self-registration always creates `member` |

### Session

Server-side login session. The cookie holds a random token; the database stores only its hash. Logout deletes the row. Expired rows are rejected.

### Member

Person on a church (or society) roll. Used for eligibility and candidate suggestions. Not the same as a `User`.

| Field | Notes |
| --- | --- |
| `is_communicant` | Required for local assembly voting (CI/IPB art. 112) |
| `is_male` / age | Relevant for elder/deacon candidacy (art. 25 §2) |
| `society_flags` | e.g. UPA active, membership start date for 6-month rule |

### Room

A single election session created by an admin (QR join target).

| Field | Notes |
| --- | --- |
| `room_type` | `pastor`, `elder`, `deacon`, `upa_board`, or `custom` |
| `rules_preset` | `ipb_local_officers`, `ipb_society_board`, or `custom`. Majority and round behavior are derived from the preset, not stored as separate columns |
| `quorum_value` + `quorum_unit` | Absolute count, or percent of `eligible_count` |
| `eligible_count` | Denominator for a percent quorum. Stays 0 until the admin sets it. Absolute quorum ignores it. A percent quorum with 0 cannot be met |
| `invite_token` | Unguessable, unique capability behind the QR / short link (`/join/{token}`) |
| `status` | `draft` · `open` · `voting` · `closed` · `cancelled` |

### Participant

Person present in the room. Tracks **presence**, not ballot content.

Until the member roll exists (B2.1), identity is a display name plus a random join key kept in the browser. The server stores only `join_key_hash` (SHA-256). The same key joins again without a second presence row. `member_id` stays empty until import.

| Field | Notes |
| --- | --- |
| `display_name` | Name typed at the door. Not an eligibility check |
| `join_key_hash` | SHA-256 of the client join key. Unique together with `room_id` |
| `is_present` | Counts toward quorum while true. A repeat join sets this back to true without inserting another row |

Invites do not expire by time yet. An unknown token is rejected. Draft, closed, and cancelled rooms cannot be joined; `open` and `voting` can.

### Round

One ballot open period (1st, 2nd, 3rd/runoff). Society elections may also be **office-by-office** (`office_label`).

`outcome` is null while the round is open, and null after a close that met quorum but has not been tallied yet. Otherwise it is `failed_quorum`, `no_majority`, or `elected`. Closing below the required presence writes `failed_quorum`. At most one round per room is `open`.

### Candidate

Someone selectable on the ballot for this room/round (from member roll + filters, or admin override).

### Ballot

Anonymous vote record: stores **choice** (+ round) without `participant_id`.

### VoteReceipt

Proves the participant already voted in that round (prevents double voting) without revealing the choice.

### Reaction

Moderated emoji / light interaction; must not encode ballot preference.

### AuditEvent

Admin actions: create room, change quorum, start/restart round, force close, etc.

## Critical invariants

1. **Unlinkability:** no foreign key from `Ballot` → `Participant` (or equivalent cryptographic unlinkability).
2. **Uniqueness:** at most one `VoteReceipt` per `(participant, round)`.
3. **Quorum gate:** closing a round compares current presence with the required quorum. Below quorum, `rounds.outcome` is `failed_quorum` and no winner is stored. Publishing a winner requires the latest closed round outcome to be `elected`. A percent quorum with `eligible_count = 0` is never met.
4. **Eligibility:** only eligible participants may receive a receipt; only eligible candidates appear on the ballot for that room type.
5. **Restart:** clearing ballots/receipts for a round must write an `AuditEvent`.
6. **Presence identity:** at most one participant per `(room, join_key_hash)`. The raw join key is never stored.

## Open questions

- Soft delete vs hard delete for members and rooms
- How blank / null ballots are stored and whether they enter the majority denominator
- Multi-vacancy elections (N winners) vs single office-by-office
- Reaction rate limits and moderation roles
