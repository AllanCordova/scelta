# Writing guide — multi-agent workflow

## Purpose

Large, mixed-context sessions degrade quality. For Scelta work, agents **must** split work across **multiple agents with clean context**, instead of doing implement + review + security + tests in one polluted thread.

## Mandatory split

For every non-trivial feature or task, use **separate agents** (or clearly separated runs with fresh context) for at least:

1. **Implementation** — write the code against acceptance criteria.
2. **Review** — independent review of correctness, design, and standards (`code-standards.md`).
3. **Security** — dedicated pass against `security.md` (authz, injection, secrets, abuse cases).
4. **Tests** — dedicated pass against `testing.md` (unit + feature + browser gaps, flake risk, CI parity).

Do **not** skip review, security, or test agents because “the implementer already thought about it.” Clean context is the point.

## How to run with clean context

- Each specialist agent gets: backlog item + acceptance criteria, relevant file paths/diffs, and the single instruction file it owns (`security.md` or `testing.md` or `code-standards.md`).
- Do **not** dump the full chat history into the specialist. Give artifacts (diff, AC list, open questions), not narrative residue.
- Specialists should return structured findings: blockers, risks, and concrete fix suggestions.
- The implementing agent (or human) applies fixes; re-run specialists if the change set grew meaningfully.

## Suggested prompt shapes

### Review agent

- Input: PR diff or patch, acceptance criteria, `code-standards.md`.
- Output: findings by severity; naming/SOLID/isolation issues; missing docs updates.

### Security agent

- Input: PR diff, threat-relevant surfaces (routes, auth, uploads), `security.md`.
- Output: vulnerabilities / smells, missing checks, logging/PII risks; no exploit fluff — remediation-focused.

### Test agent

- Input: PR diff, acceptance criteria, `testing.md`, existing test layout.
- Output: missing unit/feature/browser cases; weak assertions; local CI commands still failing.

## Trivial changes

For tiny docs-only or comment-only edits, a full four-way split may be unnecessary. Still apply judgment: anything that touches auth, data, payments, uploads, or user input **requires** the security and test agents.

## Coordination rules

- Acceptance criteria in `docs/backlog.md` are the contract; agents do not invent scope.
- Architecture and data-model changes must update Mermaid docs in the same change set.
- Before push: follow `git.md` local CI checklist.
- Prefer several focused agent runs over one mega-agent that “does everything.”

## Definition of done (process)

A feature is process-complete only when:

1. Implementation matches acceptance criteria.
2. Review agent findings are addressed or explicitly waived with rationale.
3. Security agent findings are addressed or explicitly waived with rationale.
4. Test agent confirms unit + feature + browser coverage (or documented N/A).
5. Local CI checklist passes.
