# Git & versioning

## Branching

- `main` is always releasable. Do not commit broken builds to `main`.
- Create a short-lived branch per task: `feat/…`, `fix/…`, `chore/…`, `docs/…`, `refactor/…`, `test/…`.
- Prefer one concern per branch and per pull request.
- Rebase or merge from `main` before opening/updating a PR; resolve conflicts locally.

## Commits

- Commit only when the user explicitly asks, unless repository rules say otherwise.
- Use concise, imperative commit messages focused on **why**, not a file dump.
  - Good: `add session expiry check to prevent stale auth`
  - Bad: `update files`
- Never commit secrets (`.env`, credentials, private keys, tokens). Use env examples instead (e.g. `.env.example`).
- Do not amend commits that were already pushed unless the user explicitly requests it and it is safe.
- Do not use `--no-verify` or skip hooks unless the user explicitly requests it.

## Pull requests

- Keep PRs small and reviewable.
- PR description must include: summary, test plan, and any security-relevant notes.
- Link the backlog item ID when applicable (e.g. `B0.2`).

## Local CI before push (mandatory)

Before pushing or opening a PR, run the **same checks CI will run**, locally, and fix failures first.

Until the project’s CI config exists, treat this checklist as the contract and update this file when CI is defined:

1. Install dependencies with the project’s lockfile (do not invent versions).
2. Lint (and format check if configured).
3. Typecheck (if the stack has a type system).
4. Unit tests.
5. Feature / integration tests that do not require a full browser matrix (as configured).
6. Browser / e2e tests that CI runs on PRs (as configured).
7. Build the app (production build if CI builds).

### Expected commands (current stack)

```bash
pnpm install --frozen-lockfile
pnpm --filter @scelta/domain build
pnpm --filter @scelta/db build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:feature
pnpm --filter @scelta/web exec playwright install chromium   # first machine / CI image only
pnpm test:e2e
pnpm build
```

When GitHub Actions (or equivalent) workflows are added under `.github/workflows/`, mirror those steps here exactly so agents and humans run the same pipeline locally.

## What not to do

- Do not force-push to `main` / `master`.
- Do not rewrite shared history without an explicit user request.
- Do not push with failing tests “to fix in CI”.
- Do not commit generated noise or local IDE settings unless the repo intentionally tracks them.
