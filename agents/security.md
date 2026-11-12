# Security practices

Apply these practices on every change. Prefer secure defaults. When unsure, choose the stricter option and document the tradeoff.

## Threat mindset

- Assume inputs are hostile (query params, body, headers, files, webhooks, third-party payloads).
- Assume clients lie (never trust UI-only checks).
- Minimize blast radius: least privilege, short-lived credentials, isolated secrets.
- Fail closed: deny by default when authz is unclear.

## Authentication & sessions

- Use a well-maintained auth approach; do not roll custom crypto for passwords or tokens.
- Store password hashes with a modern KDF (e.g. Argon2id / bcrypt) if handling passwords directly.
- Prefer httpOnly, Secure, SameSite cookies for session tokens when using cookie-based auth.
- Rotate and expire sessions; invalidate on logout and on privilege/password change.
- Protect against session fixation and CSRF where cookie auth is used.

## Authorization

- Enforce authorization on the **server** for every sensitive operation.
- Check resource ownership / tenancy on read and write, not only on list endpoints.
- Deny by default; grant explicitly.
- Never rely on hidden UI or “security through obscurity”.

## Input validation & output encoding

- Validate and sanitize all external input at trust boundaries (API, jobs, webhooks).
- Prefer allowlists over denylists.
- Encode output appropriately for context (HTML, URL, SQL via parameterized queries, etc.).
- Reject unexpected content types and oversized payloads.

## Injection & query safety

- Use parameterized queries / ORM APIs; never concatenate untrusted input into SQL.
- Avoid shelling out with user-controlled strings; if unavoidable, use strict allowlists and safe APIs.
- Treat template and HTML rendering as XSS surfaces; escape by default.

## Secrets & configuration

- Secrets live in environment / secret manager — never in source, docs with real values, or client bundles.
- Provide `.env.example` with dummy values only.
- Rotate secrets when exposed; treat any committed secret as compromised.
- Separate secrets per environment (local / staging / production).

## Transport & headers

- HTTPS everywhere in deployed environments.
- Set security headers appropriate to the stack (e.g. CSP, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) once the web stack is chosen.
- Do not disable TLS verification in production code paths.

## Dependencies & supply chain

- Pin dependencies via lockfile; review new packages for maintenance and permission surface.
- Prefer minimal dependency trees for security-sensitive paths.
- Keep runtime and packages patched; run audits when available (`npm audit`, etc.) and address high/critical issues before merge when feasible.

## Data protection

- Collect only data needed for the feature.
- Encrypt sensitive data at rest when required by the domain; never log secrets, tokens, or full payment data.
- Redact PII in logs and error reports.
- Define retention and deletion paths for user data when the domain requires it.

## Files & uploads (when applicable)

- Validate type by content sniffing + allowlist, not only by extension.
- Store uploads outside the executable web root; serve via controlled URLs.
- Limit size; scan or sandbox untrusted files when risk warrants it.
- Generate server-side object keys; do not trust client-provided paths.

## APIs & abuse

- Rate-limit auth and sensitive endpoints.
- Use idempotency keys for unsafe retries where duplicates are harmful.
- Return generic errors to clients for auth failures; log details server-side.
- Avoid verbose stack traces in production responses.

## Frontend specifics

- Do not embed secrets in client code.
- Be careful with `dangerouslySetInnerHTML` / raw HTML; sanitize if unavoidable.
- Use trusted OAuth redirect URI allowlists.
- Treat `postMessage` and third-party scripts as untrusted unless origin-checked.

## Security review for every feature

Before marking a feature done, verify:

1. Authn/authz boundaries are explicit and tested.
2. No new secret leakage paths (logs, client, URLs, error messages).
3. Inputs validated; outputs encoded.
4. New dependencies justified and lockfile updated.
5. Threats for the feature (IDOR, XSS, CSRF, injection, mass assignment) considered.

Use a **clean-context security agent** for non-trivial features (see `writing-guide.md`).
