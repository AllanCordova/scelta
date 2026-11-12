# Code standards

## Language

- All code identifiers, comments for non-trivial intent, commit messages, and agent docs are in **English**.
- User-facing copy may follow product locale rules (document separately when i18n is introduced).

## Naming

| Kind | Convention | Examples |
| --- | --- | --- |
| Variables / functions | `camelCase` | `createSession`, `isExpired` |
| Types / classes / components | `PascalCase` | `UserSession`, `SessionForm` |
| Constants | `UPPER_SNAKE_CASE` or `camelCase` for exported const objects — be consistent per stack | `MAX_LOGIN_ATTEMPTS` |
| Files | Match primary export; prefer kebab or match framework convention once chosen | `create-session.ts`, `SessionForm.tsx` |
| Booleans | Prefix with `is` / `has` / `can` / `should` | `isAuthenticated` |
| Handlers | Verb + noun; event handlers may use `handle` / `on` consistently | `handleSubmit`, `onSessionExpire` |

Names must describe **intent**, not implementation noise (`data2`, `temp`, `foo` are not acceptable in production code).

## Atomic functions & isolated problems

- Prefer **small, single-purpose functions** (one reason to change).
- Solve one problem per unit of code; compose larger behavior from atomic pieces.
- Extract shared logic only when duplication is real and the abstraction has a clear name.
- Keep side effects at the edges (I/O, DB, HTTP); keep core domain logic pure when practical.
- A function that validates, persists, and sends email is too big — split responsibilities.

## SOLID (when viable)

Apply when it clarifies design; do not force patterns that inflate simple code.

- **S**ingle responsibility: one module/function owns one concern.
- **O**pen/closed: extend via composition/new types rather than editing fragile condition ladders when variation grows.
- **L**iskov: subtypes must honor contracts; do not surprise callers.
- **I**nterface segregation: prefer narrow interfaces over “god” ports.
- **D**ependency inversion: depend on abstractions at boundaries (repos, gateways); inject them for testability.

## Structure & style

- Prefer clarity over cleverness.
- Avoid premature abstraction and deep inheritance trees.
- Keep modules cohesive; respect layer boundaries once architecture is defined (UI → application → domain → infrastructure, or the chosen equivalent).
- Handle errors explicitly; do not swallow exceptions silently.
- No dead code, commented-out blocks, or unused exports in merged code.
- Match existing project style once the codebase exists; do not reformat unrelated files.

## Comments & docs

- Comment **why**, not what the syntax already shows.
- Public APIs and non-obvious invariants deserve brief docs.
- Update `docs/` when behavior or model changes.

## Checklist before finishing a change

1. Names are English and intention-revealing.
2. Functions are atomic; problems are isolated.
3. SOLID applied where it reduces coupling without ceremony.
4. Tests cover the behavior (see `testing.md`).
5. Security boundaries respected (see `security.md`).
