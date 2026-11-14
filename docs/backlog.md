# Backlog

> Status: `todo` · `in-progress` · `done` · `blocked`  
> Domain rules: [`voting-rules.md`](voting-rules.md)

## Epic 0 — Foundation

### B0.1 — Repository scaffolding

**Status:** `done`  
**Description:** README, docs, and agent instruction set.

**Acceptance criteria:**

- [x] Root README with product name and description
- [x] `docs/` with architecture, data model, backlog, voting rules
- [x] `agents/` with git, security, testing, code standards, writing guide (English)

### B0.2 — Architecture decision

**Status:** `done`  
**Description:** Choose and document the technical architecture for Scelta.

**Acceptance criteria:**

- [x] Options discussed with stakeholders
- [x] Chosen stack recorded in `docs/architecture.md` (Mermaid updated)
- [x] Local install / run steps added to `README.md`
- [x] CI commands mirrored in `agents/git.md`

### B0.3 — Monorepo scaffolding

**Status:** `done`  
**Description:** Bootstrap pnpm workspaces with API, web, domain, db, Docker, and baseline tests.

**Acceptance criteria:**

- [x] `apps/api`, `apps/web`, `packages/domain`, `packages/db` exist
- [x] Domain unit tests for quorum / majority / rounds
- [x] API health + rules feature tests
- [x] Web unit test + Playwright home smoke
- [x] `docker-compose.yml` for postgres/api/web
- [x] Full room voting persistence wired end-to-end (Epic 1)

---

## Epic 1 — Voting room (MVP core)

### B1.1 — Create and configure a room

**Status:** `done`  
**Description:** Admin creates a voting room with title, type, quorum, and a rules preset (IPB local officers / society board / custom).

**Acceptance criteria:**

- [x] Admin can create a room with title and `room_type`
- [x] Admin can set quorum as absolute number or percentage of eligible list
- [x] Admin can pick a rules preset that pre-fills majority and round behavior
- [x] Room receives a unique invite token suitable for QR / link
- [x] Room appears in admin list with status `draft` / `open`
- [x] Unit + feature tests cover validation (invalid quorum rejected)
- [x] Browser test: admin creates a room and sees invite QR/link

### B1.2 — Join room via QR / link

**Status:** `done`  
**Description:** Eligible people enter the room through QR code or short link; presence is counted toward quorum.

**Acceptance criteria:**

- [x] Opening a valid invite joins (or prompts identity) and registers presence
- [x] Invalid / expired / closed room invite is rejected with a clear message
- [x] Presence count updates for admin in near real time
- [x] Duplicate join by the same eligible person does not double-count presence
- [x] Feature + browser tests for happy path and invalid token

### B1.3 — Quorum gate

**Status:** `done`  
**Description:** Voting results respect the configured minimum presence. Opening a round does not require quorum. Closing below the required presence sets outcome `failed_quorum` and does not elect a winner. Publishing is rejected until a later closed round has outcome `elected` (or the room is reconfigured and a new round meets quorum). Percent quorum with `eligible_count` 0 cannot be met. Absolute quorum uses `quorum_value` only.

**Acceptance criteria:**

- [x] System shows current presence vs required quorum
- [x] Closing a round below quorum marks outcome as `failed_quorum` (or blocks close — policy documented)
- [x] Admin cannot publish a “winner” when quorum was not met
- [x] Unit tests for quorum math (absolute and percent)
- [x] Feature tests for below/above quorum outcomes

### B1.4 — Anonymous single ballot + automatic tally

**Status:** `done`  
**Description:** Each eligible participant votes once per round; choice is anonymous; system tallies and applies majority rules.

**Acceptance criteria:**

- [x] Eligible participant can cast exactly one vote per open round
- [x] Second vote attempt is rejected
- [x] Stored ballots are not linkable to the participant (anonymity invariant)
- [x] System records a vote receipt (voted yes/no) without storing the choice on the participant
- [x] Tally computes vote counts and whether someone reached **> 50%** / absolute majority per room rules
- [x] Unit + feature tests for double-vote prevention and majority calculation
- [x] Browser test: two voters cast distinct votes; results match; neither UI exposes who voted for whom

### B1.5 — Multi-round / runoff

**Status:** `done`  
**Description:** Support 2nd ballot and 3rd/runoff (e.g. top-2 for society board; limit to most voted for local officers).

**Acceptance criteria:**

- [x] If no winner under preset rules, admin (or auto-flow) can open next round with the correct candidate subset
- [x] Preset `ipb_society_board`: after 2 failed absolute-majority rounds → 3rd with top 2
- [x] Preset `ipb_local_officers`: after 2nd round without majority, further rounds may be limited to most voted
- [x] Prior round ballots do not carry into the new round
- [x] Each round resets one-vote-per-person
- [x] Feature tests for both presets; browser test for a full runoff path

### B1.6 — Start, pause, and restart voting

**Status:** `done`  
**Description:** Admin controls the lifecycle of rounds; restart is allowed when something goes wrong, with audit trail.

**Acceptance criteria:**

- [x] Admin can start, pause/close, and restart the current round
- [x] Restart clears ballots/receipts for that round and writes an audit event
- [x] Participants are notified of state changes (open / closed / restarted)
- [x] Feature tests for restart clearing votes; browser test for admin restart flow

---

## Epic 2 — Members & candidates

### B2.1 — Import communicant / society members

**Status:** `done`  
**Description:** Load the member roll used for eligibility and candidate suggestions.

**Acceptance criteria:**

- [x] Admin can import members (format TBD: CSV at minimum)
- [x] Communicant flag and basic attributes needed for filters are stored
- [x] Import report shows created / updated / rejected rows
- [x] Feature tests for valid and invalid import rows

### B2.2 — Candidate suggestions by room type

**Status:** `done`  
**Description:** Depending on room type, suggest eligible candidates (e.g. communicant men ≥ 18 for elder/deacon; UPA members meeting seniority rules).

**Acceptance criteria:**

- [x] Elder/deacon room suggests candidates matching CI/IPB office filters (configurable)
- [x] UPA-style room applies society eligibility (e.g. active + 6 months) when data is available
- [x] Admin can include/exclude suggested names before opening the ballot
- [x] Ineligible people cannot appear as selectable candidates once filters are applied
- [x] Unit tests for filter rules; browser test for suggestion list on create-room flow

---

## Epic 3 — Live assembly experience

### B3.1 — Controlled reactions (emojis)

**Status:** `todo`  
**Description:** Participants can send moderated emoji reactions during the meeting for a lighter atmosphere, without affecting or leaking votes.

**Acceptance criteria:**

- [ ] Participant can send an emoji from an allowlist while in the room
- [ ] Reactions are rate-limited and can be disabled by admin
- [ ] Reactions never appear tied to ballot choices
- [ ] Feature + browser tests for send / rate-limit / admin disable

---

## Epic 4 — Trust & compliance

### B4.1 — Admin audit log

**Status:** `done`  
**Description:** Sensitive admin actions are append-only logged for the room.

**Acceptance criteria:**

- [x] Create room, change quorum, start/restart/close, publish result are audited
- [x] Audit entries are visible to admin and immutable via API
- [x] Feature tests assert audit rows on restart and quorum change

### B4.2 — Security baseline for voting

**Status:** `todo`  
**Description:** Apply `agents/security.md` to voting surfaces (invite tokens, anonymity, authz).

**Acceptance criteria:**

- [ ] Invite tokens are unguessable and rotatable
- [ ] Voters cannot access admin controls
- [ ] Anonymity invariant verified by tests (no API returns voter→choice)
- [ ] Clean-context security agent review completed for Epic 1

---

## How to add items

1. ID `B{epic}.{n}` + short title  
2. Outcome-focused description  
3. Testable acceptance criteria  
4. Link `voting-rules.md` / model when rules change  
5. No implementation until criteria are clear  
