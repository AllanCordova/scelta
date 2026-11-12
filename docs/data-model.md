# Data model

> Draft domain model for Scelta. Technology (SQL/NoSQL, IDs) TBD.  
> **Anonymity invariant:** a `Ballot` must not be joinable to a `Participant` in a way that reveals the chosen option.

## Domain overview

```mermaid
erDiagram
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
        string invite_token
        string status
    }
    PARTICIPANT {
        uuid id PK
        uuid room_id FK
        uuid member_id FK
        datetime joined_at
        boolean is_present
    }
    ROUND {
        uuid id PK
        uuid room_id FK
        int number
        string office_label
        string status
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

Tenant / congregation using Scelta.

### Member

Person on a church (or society) roll. Used for eligibility and candidate suggestions.

| Field | Notes |
| --- | --- |
| `is_communicant` | Required for local assembly voting (CI/IPB art. 112) |
| `is_male` / age | Relevant for elder/deacon candidacy (art. 25 §2) |
| `society_flags` | e.g. UPA active, membership start date for 6-month rule |

### Room

A single election session created by an admin (QR join target).

| Field | Notes |
| --- | --- |
| `room_type` | e.g. `elder`, `deacon`, `upa_board`, `custom` |
| `rules_preset` | e.g. `ipb_local_officers`, `ipb_society_board`, `custom` |
| `quorum_value` + `quorum_unit` | Absolute count or percent of eligible list |
| `invite_token` | Backing the QR / short link |
| `status` | `draft` · `open` · `voting` · `closed` · `cancelled` |

### Participant

Member who joined the room. Tracks **presence**, not ballot content.

### Round

One ballot open period (1st, 2nd, 3rd/runoff). Society elections may also be **office-by-office** (`office_label`).

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
3. **Quorum gate:** published results require presence count ≥ configured quorum at the agreed checkpoint.
4. **Eligibility:** only eligible participants may receive a receipt; only eligible candidates appear on the ballot for that room type.
5. **Restart:** clearing ballots/receipts for a round must write an `AuditEvent`.

## Open questions

- Soft delete vs hard delete for members and rooms
- How blank / null ballots are stored and whether they enter the majority denominator
- Multi-vacancy elections (N winners) vs single office-by-office
- Reaction rate limits and moderation roles
