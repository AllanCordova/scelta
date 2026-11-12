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
- Every pull request must use [`.github/PULL_REQUEST_TEMPLATE.md`](../.github/PULL_REQUEST_TEMPLATE.md). GitHub inserts that file into the description automatically. When opening a PR from the CLI or API, copy the template into the body.
- Fill every section. Do not delete headings.
  - **Summary** — why the change exists, plus the backlog item ID when one applies (e.g. `B1.1`).
  - **Test plan** — check the layers you ran. If a layer does not apply, say why (see `testing.md`).
  - **Security** — auth, ballot anonymity, secrets, or data exposure. Write `None` when there is no security impact.

## Local CI before push (mandatory)

Before pushing or opening a PR, run the **same checks** [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs, and fix failures first.

1. Install dependencies with the lockfile.
2. Build `@scelta/domain` (the API imports its compiled output).
3. Lint the API and the client.
4. API unit tests and API feature tests.
5. Client unit tests and client browser tests.

### Commands

```bash
pnpm install --frozen-lockfile
pnpm --filter @scelta/domain build
pnpm --filter @scelta/api lint
pnpm --filter @scelta/api test
pnpm --filter @scelta/api test:feature
pnpm --filter @scelta/web lint
pnpm --filter @scelta/web test
pnpm --filter @scelta/web exec playwright install chromium   # first machine only
pnpm --filter @scelta/web test:e2e
```

CI installs Playwright’s system libraries with `playwright install --with-deps chromium` on Ubuntu. Locally, `playwright install chromium` is enough when those libraries are already present.

## What not to do

- Do not force-push to `main` / `master`.
- Do not rewrite shared history without an explicit user request.
- Do not push with failing tests “to fix in CI”.
- Do not commit generated noise or local IDE settings unless the repo intentionally tracks them.
