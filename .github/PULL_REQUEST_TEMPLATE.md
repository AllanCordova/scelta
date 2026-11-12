## Summary

<!-- Why this change exists. Link the backlog item when one applies, for example `B1.1`. -->

## Test plan

<!-- Check the layers you ran. If a layer does not apply, say why (`agents/testing.md`). -->

- [ ] API lint — `pnpm --filter @scelta/api lint`
- [ ] API unit tests — `pnpm --filter @scelta/api test`
- [ ] API feature tests — `pnpm --filter @scelta/api test:feature`
- [ ] Client lint — `pnpm --filter @scelta/web lint`
- [ ] Client unit tests — `pnpm --filter @scelta/web test`
- [ ] Client browser tests — `pnpm --filter @scelta/web test:e2e`

## Security

<!-- Auth, ballot anonymity, secrets, or data exposure. Write "None" when there is no security impact. -->
