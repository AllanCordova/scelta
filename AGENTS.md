# Antigravity Rules — Scelta (`AGENTS.md` / `antigravity.md`)

**Mandatory:** These rules govern how Antigravity (and any coordinated agents) must execute tasks in the Scelta repository. Before starting any task, also respect all rules in [`agents/`](agents/README.md) (`code-standards.md`, `security.md`, `testing.md`, `git.md`, `writing-guide.md`).

---

## 1. Model Orchestration & Delegation Matrix

**STRICT RULE:** **Gemini 4 Argon** is used **EXCLUSIVELY as the Orchestrator / Coordinator** (`coordinator`). **NEVER** spawn another `Argon` worker to implement tasks. Always plan, break down, and distribute implementation tasks across **Gemini 4 Hydrogen** and **Gemini 3.8 Flash**:

| Tier / Role | Target Model(s) | When to Use | Mapping from `plano-v2.md` |
| --- | --- | --- | --- |
| **Orchestrator ONLY (Planning & Coordination)** | **Gemini 4 Argon** (`gemini-4-argon-medium` / `gemini-4-argon-high`) | **Coordinator only.** Planning stages, decomposing tasks, assigning work to Hydrogen/Flash workers, verifying board status, and coordinating Kanban updates. **Never run a second Argon instance as a worker.** | Orchestration & Planning only |
| **Implementation & Specialist Reviews (Medium & Complex Tasks)** | **Gemini 4 Hydrogen** (`gemini-4-hydrogen-medium` / `gemini-4-hydrogen-high`) | All code implementation tasks (database migrations, domain rules, API routes, state machine guards, UI components, rate limiting) and **clean-context specialist reviews** (Code Review, Security Review, Test Coverage Review). Use `gemini-4-hydrogen-high` for complex (`opus`-level) tasks and reviews, and `gemini-4-hydrogen-medium` for medium (`sonnet`-level) tasks. | All `opus` and `sonnet` implementation tasks (`T0.1`–`T0.9`, `T1.x`–`T7.x`) + Review Rounds |
| **Fast Lookups, Simple Edits, Browser & Kanban** | **Gemini 3.8 Flash** (`gemini-3.8-flash-medium` / `gemini-3.8-flash-low`) | Quick codebase searches, CI config tweaks, dead-code removal, documentation alignment, Kanban/Backlog status updates (including GitHub Project board updates), and browser subagent tasks. | `haiku` tasks (`T0.10`, `T0.11`), simple edits, queries & browser/Kanban updates |

### Tool-Specific Routing Rules
- **`swarm` workers**:
  - **NEVER** pass `gemini-4-argon-*` or leave `model` blank (since blank inherits the coordinator's Argon model!).
  - **ALWAYS** pin `model` explicitly to `gemini-4-hydrogen-medium` / `gemini-4-hydrogen-high` (for implementation and reviews) or `gemini-3.8-flash-medium` / `gemini-3.8-flash-low` (for simple tasks, lookups, docs, and Kanban).
- **`invoke_subagent`**: Pass `Model: "flash"` (or `"flash_lite"`) for simple research, file lookups, trivial edits, and browser tasks (including updating the GitHub Project Kanban board).

---

## 2. Implementation Workflow (Per Stage / Task)

For every stage (`Etapa 0` through `Etapa 7`) in [`docs/plano-v2.md`](docs/plano-v2.md):

1. **Check Current Stage & Kanban Board**:
   - Inspect [`docs/plano-v2.md`](docs/plano-v2.md), [`docs/backlog.md`](docs/backlog.md), and the GitHub Project Kanban board (`https://github.com/users/AllanCordova/projects/8/views/1`).
   - Mark the tasks being worked on as `In Progress` in both the local backlog and the GitHub Project Kanban board.
2. **Plan & Distribute Tasks (Argon Orchestrator → Hydrogen / Flash Workers)**:
   - Break the stage into non-overlapping tasks and assign them to `gemini-4-hydrogen-medium` / `gemini-4-hydrogen-high` (implementation) and `gemini-3.8-flash-medium` (simple edits/docs).
3. **Follow Mandatory Engineering Standards**:
   - **Code (`agents/code-standards.md`)**: English identifiers and comments, atomic single-purpose functions, SOLID principles, pure domain logic in `@scelta/domain`, side effects at boundaries.
   - **Security (`agents/security.md`)**: Strict ballot anonymity (never link voter identity or timestamp to ballot choice), server-side authz, input validation, rate limiting, immutable audit trail.
   - **Testing (`agents/testing.md`)**: Every task must include Unit tests (`packages/domain`, `apps/api`, `apps/web`), Feature/Integration tests (`*.feature.test.ts`), and Browser E2E tests (`apps/web/e2e`) when user-visible.
4. **Mandatory Review Round (Clean Context)**:
   - After implementing a stage, run a dedicated **Review Round** using a clean-context `gemini-4-hydrogen-high` / `gemini-4-hydrogen-medium` reviewer covering:
     1. **Code & Architecture Review** against acceptance criteria and `agents/code-standards.md`.
     2. **Security Audit** against `agents/security.md` and voting anonymity invariants.
     3. **Test & Verification Audit** against `agents/testing.md` and local CI execution (`build`, `typecheck`, `lint`, `test`, `test:feature`, `test:e2e`).
   - Address all blockers and regressions found during the review round before marking any task complete.
5. **Update the Kanban Board (GitHub Project + Repo Docs)**:
   - Once implementation and the review round pass, update the GitHub Project Kanban (`https://github.com/users/AllanCordova/projects/8/views/1`) as well as [`docs/backlog.md`](docs/backlog.md) and [`docs/plano-v2.md`](docs/plano-v2.md) with what was implemented in the stage.
