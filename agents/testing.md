# Testing requirements

**Rule:** Every new task must ship with tests. This applies to API work, UI components, and full user flows. Untested code is incomplete.

## Required layers

For each new feature or meaningful change, cover all applicable layers:

| Layer | Purpose | Tools in this repo |
| --- | --- | --- |
| **Unit** | Isolated functions, pure logic, edge cases | Vitest (`packages/domain`, `apps/api`, `apps/web`) |
| **Feature** (integration) | Use-cases across modules/API without full browser | Vitest + Fastify `inject` (`*.feature.test.ts` in `apps/api`) |
| **Browser** (e2e) | Real user paths in a browser | Playwright (`apps/web/e2e`) |

- **API tasks:** unit (handlers/domain) + feature/integration (HTTP + persistence as configured) + browser tests when the change is user-visible.
- **Component / UI tasks:** unit (logic/hooks) + feature (component integration) + browser tests for critical UX paths.
- Skip a layer only with an explicit reason in the pull request test plan (see [`.github/PULL_REQUEST_TEMPLATE.md`](../.github/PULL_REQUEST_TEMPLATE.md)), for example a pure docs change.

## What “feature tests” mean here

Feature tests assert a **user or system capability**, not an implementation detail:

- Good: “authenticated user can create X and see it listed”
- Bad: “function `mapFoo` was called with these mocks only”

Prefer testing public behavior at the boundary (HTTP contract, rendered outcomes, domain commands).

## Browser tests

- Cover the happy path of the feature and at least one important failure/permission path when relevant.
- Keep selectors resilient (roles, labels, test ids agreed by the team — avoid brittle CSS chains).
- Do not rely on production credentials; use test fixtures / seeded data.
- Run locally before push when CI runs browser tests (see `git.md`).

## Unit tests

- Keep them fast and deterministic.
- Test edge cases, validation, and error branches close to the logic.
- Prefer pure functions and injectable dependencies so units stay testable (see `code-standards.md`).

## Definition of done (testing)

A task is done only when:

1. Unit tests for new/changed logic pass.
2. Feature/integration tests for the capability pass.
3. Browser tests for user-visible flows pass (or justified N/A).
4. Local CI checklist in `git.md` passes.
5. A clean-context **test agent** has reviewed coverage gaps (see `writing-guide.md`).

## Flakes & quality

- Do not merge known flaky tests; fix or quarantine with a tracked follow-up.
- Avoid time-dependent assertions; control clocks when needed.
- Prefer deterministic seeds and fixtures over live network calls.

## Commands

```bash
pnpm test           # unit (domain, api, web)
pnpm test:feature   # API feature / integration
pnpm test:e2e       # Playwright browser
```

### Conventions

- Domain pure rules: `packages/domain/src/**/*.test.ts`
- API unit: `apps/api/src/**/*.test.ts`
- API feature: `apps/api/src/**/*.feature.test.ts`
- Web unit: `apps/web/src/**/*.test.tsx`
- Browser: `apps/web/e2e/**/*.spec.ts`
