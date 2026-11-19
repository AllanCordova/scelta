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

**Status:** `done`  
**Description:** Participants can send moderated emoji reactions during the meeting for a lighter atmosphere, without affecting or leaking votes.

**Acceptance criteria:**

- [x] Participant can send an emoji from an allowlist while in the room
- [x] Reactions are rate-limited and can be disabled by admin
- [x] Reactions never appear tied to ballot choices
- [x] Feature + browser tests for send / rate-limit / admin disable

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

**Status:** `done`  
**Description:** Apply `agents/security.md` to voting surfaces (invite tokens, anonymity, authz).

**Acceptance criteria:**

- [x] Invite tokens are unguessable and rotatable
- [x] Voters cannot access admin controls
- [x] Anonymity invariant verified by tests (no API returns voter→choice)
- [x] Clean-context security agent review completed for Epic 1

---

## Plano v2 — Quadro Kanban (Etapas 0 a 7)

> Referência detalhada: [`docs/plano-v2.md`](plano-v2.md) · Regras de orquestração: [`antigravity.md`](../antigravity.md) / [`AGENTS.md`](../AGENTS.md)

### Etapa 0 — Fundação e correções críticas (`done`)

| ID | Task | Size | Prioridade | Modelo | Depende de | Status |
| --- | --- | --- | --- | --- | --- | --- |
| **T0.1** | Migrações versionadas do banco (Drizzle Kit `0000_initial.sql` + `0000_snapshot.json`, `runMigrations` em Postgres e PGlite, removido `SCHEMA_SQL`, docs em `data-model.md`) | L | P0 | `hydrogen` | — | `done` |
| **T0.2** | Guardas na mudança de status da sala (`canTransitionRoomStatus`, `canUpdateRoomQuorum` em `@scelta/domain`, removido `voting`/`cancelled`, `409 Conflict` na API, `quorumValue >= 1`) | M | P0 | `hydrogen` | T0.1 | `done` |
| **T0.3** | Reiniciar escrutínio sem apagar histórico (`outcome = 'annulled'`, abre próxima rodada, preserva rodadas encerradas, ignora anulados na contagem de 3 escrutínios, grava `annulledTotals` no log) | L | P0 | `hydrogen` | T0.1 | `done` |
| **T0.4** | Encerrar escrutínio com pendentes (`confirmPending`, `didNotVoteCount` / `"Não votaram: N"` persistido em `rounds`, `FOR UPDATE` em `castBallot` e `closeRound`, votos de quem saiu continuam válidos) | M | P0 | `hydrogen` | T0.1 | `done` |
| **T0.5** | Sigilo: removido `created_at` e `ballot_token` de `ballots`, removido fingerprints de `ballot_cast`, documentado em `docs/data-model.md` e testado | S | P0 | `hydrogen` | T0.1 | `done` |
| **T0.6** | Limite de tentativas na entrada, no voto e no chat (cientes de NAT/assembleia com limite por sessão + teto burst); erro unificado `403 invalid_access_code`; bloqueio de login admin por `IP + email` | M | P0 | `hydrogen` | — | `done` |
| **T0.7** | Autenticar o canal em tempo real (`room:join` valida cookie admin ou `joinKey` de participante; `room:denied` para anônimos) e exigir `x-scelta-join-key` ou cookie admin no `GET` do chat | M | P1 | `hydrogen` | — | `done` |
| **T0.8** | Log de auditoria realmente imutável (`prev_hash` e `integrity_hash` SHA-256 encadeados com lock por sala, trigger `audit_events_immutable_trg` bloqueando `UPDATE`/`DELETE`, endpoint `GET /v1/admin/rooms/:id/audit/verify`) | M | P1 | `hydrogen` | T0.1 | `done` |
| **T0.9** | Aliviar o polling (rotas `/v1/rooms/:roomId/candidates/:candidateId/photo` e `/v1/rooms/:roomId/banners/:officeKey` com `ETag`, `Cache-Control` e `304`, removendo base64 do polling de 1s e 2s) | M | P1 | `hydrogen` | — | `done` |
| **T0.10** | Typecheck no CI (`pnpm typecheck` adicionado em `.github/workflows/ci.yml` e `agents/git.md`) | XS | P1 | `flash` | — | `done` |
| **T0.11** | Limpeza de código morto (removida tabela `reactions` e `sendReaction` do repositório) e alinhamento de `docs/voting-rules.md` (quórum de 34% e votos em branco na base da maioria) | XS | P2 | `flash` | T0.1 | `done` |

### Etapa 1 — Acesso confiável (QR, cartão e sessão) (`done`)

| ID | Task | Size | Prioridade | Modelo | Depende de | Status |
| --- | --- | --- | --- | --- | --- | --- |
| **T1.1** | Endereço público configurável (`PUBLIC_URL` no `.env.example`, validação `normalizePublicUrl` na API, endpoint público `GET /v1/config`, helpers `resolvePublicOrigin`/`hasOriginMismatch`, aviso `public-url-mismatch-warning` no painel admin, links e QRs apontando para `publicOrigin`) | S | P0 | `hydrogen` | — | `done` |
| **T1.2** | Código curto da sala e página "Entrar com código" (`ROOM_SHORT_CODE_ALPHABET` com 6 chars não ambíguos em `@scelta/domain`, migração `0001` com `rooms.short_code` e backfill determinístico, rotas públicas `GET`/`POST /v1/join/s/:shortCode`, rota web `/s/:shortCode`, `EnterCodePage` na home `/`, rotação de convite preservando `shortCode`) | M | P0 | `hydrogen` | T0.1, T1.1 | `done` |
| **T1.3** | QR legível no cartão (`QRCode.toString` em SVG, `errorCorrectionLevel: "Q"`, margem 4 módulos, tamanho 34mm x 34mm no CSS `@media print`, conteúdo curto `/s/:shortCode?c=:code`) | S | P0 | `hydrogen` | T1.2 | `done` |
| **T1.4** | Impressão de cartões sem aviso por cima e sem QR cortado (`[data-sonner-toaster]` oculto em `@media print`, paginação `paginateCardsForPrint` com 8 cartões por `.print-sheet` A4 com `break-after: page`, layout do cartão com QR SVG, URL curta legível e código 20pt, ajuste de quebra e padding de 12mm em `ShareBoardPaper`) | S | P0 | `hydrogen` | T1.2 | `done` |
| **T1.5** | Uma sessão por código, com liberação pela mesa (`participants.join_key_hash` nullable via migração `0001`, `joinParticipantInTransaction` rejeitando mismatch com `409 access_code_in_use`, reentrada permitida no mesmo navegador, liberação de sessão via `POST /v1/admin/rooms/:id/participants/:id/release-session` com evento encadeado `session_released`, preservação de identidade em falhas transitórias com backoff `[1000, 2000, 4000]ms`, remoção de `?c=` via `history.replaceState`, e bloqueio persistente de voto duplo via `vote_receipts`) | M | P0 | `hydrogen` | T0.6 | `done` |
| **T1.6** | Aviso para abrir no navegador (`detectInAppBrowser` detectando WhatsApp, Instagram, Facebook, TikTok, Line, WeChat e WebViews Android/iOS, componente `InAppBrowserBanner` com cópia de URL e botão continuar, bloqueio de preview/join e consumo de `?c=` até confirmação) | S | P1 | `hydrogen` | T1.5 | `done` |

### Etapa 2 — Rol da sala (`done`)

| ID | Task | Size | Prioridade | Modelo | Depende de | Status |
| --- | --- | --- | --- | --- | --- | --- |
| **T2.1** | Rol próprio da sala (tabela `room_roster`, migração Drizzle `0002` com backfill, `eligibleCount` derivado do rol, fim do campo manual `Aptos` em `AdminRooms` e `EditRoomModal`) | L | P0 | `hydrogen` | T0.1 | `done` |
| **T2.2** | Adicionar e remover pessoas do rol com a sala criada (`GET/POST/DELETE /v1/admin/rooms/:roomId/roster`, adicionar do cadastro ou avulso com geração de código e impressão de cartão avulso, remover revoga código e presença mantendo votos já computados, auditoria encadeada) | M | P0 | `hydrogen` | T2.1 | `done` |
| **T2.3** | Cadastro geral não altera salas encerradas (soft delete `members.deleted_at`, revogação em salas abertas sem afetar encerradas, snapshots em `room_roster` e `candidates.birth_date`/`photo_url`, propagação de edição apenas para salas sem escrutínio aberto) | M | P1 | `hydrogen` | T2.1 | `done` |
| **T2.4** | Gerenciar candidatos antes do 1º escrutínio do cargo (`canManageRoomCandidates`, `POST/DELETE /v1/admin/rooms/:roomId/candidates`, `RoomCandidatesPanel` com bloqueio `409 candidates_locked_after_round` após abertura do 1º escrutínio) | S | P1 | `hydrogen` | T2.1 | `done` |

### Etapa 3 — Voto em papel (`done`)

| ID | Task | Size | Prioridade | Modelo | Depende de | Status |
| --- | --- | --- | --- | --- | --- | --- |
| **T3.1** | Marcar votante como "vota no papel" (`room_roster.votes_on_paper`, `PATCH /v1/admin/rooms/:roomId/roster/:entryId/paper-mode`, revoga código e sessão online, conta no quórum sem aparecer como pendente online, contador `"Papel: N"`, bloqueio `409 already_voted_online` / `409 paper_tally_already_recorded`, auditoria encadeada) | M | P0 | `hydrogen` / `sonnet` | T2.1, T0.4 | `done` |
| **T3.2** | Lançar os totais da urna de papel (`validatePaperTally` e soma `online + papel` em `@scelta/domain`, tabela `round_paper_tallies` na migração `0003`, `PUT /v1/admin/rooms/:roomId/rounds/:roundId/paper-tally`, trava `409 paper_tally_required` ou `confirmNoPaperBallots: true` no fechamento, `PaperTallyPanel`) | L | P0 | `hydrogen` / `sonnet` | T3.1 | `done` |
| **T3.3** | Resultado com origem dos votos (`voteOrigin` e `onlineVotes`/`paperVotes` por candidato em `AdminRoomDetail`, `ShareBoardPaper` e `/ballot`, autoria/horário em `round.paperTally` e `paper_tally_recorded` no log) | S | P1 | `sonnet` | T3.2 | `done` |

### Etapas 4 a 7 — Próximas Etapas

| Etapa | Tasks | Foco | Status |
| --- | --- | --- | --- |
| **Etapa 4** | `T4.1`–`T4.3` | Entrada por aprovação da mesa | `todo` |
| **Etapa 5** | `T5.1`–`T5.4` | Eleição de Oficiais (votar em até N nomes) | `todo` |
| **Etapa 6** | `T6.1`–`T6.3` | Tela da sala em abas (Preparar / Conduzir / Resultado) e Modo Telão | `todo` |
| **Etapa 7** | `T7.1`–`T7.4` | Qualidade, E2E de assembleia completa, carga, guia da mesa e hospedagem | `todo` |

---

## How to add items

1. ID `B{epic}.{n}` + short title  
2. Outcome-focused description  
3. Testable acceptance criteria  
4. Link `voting-rules.md` / model when rules change  
5. No implementation until criteria are clear  
