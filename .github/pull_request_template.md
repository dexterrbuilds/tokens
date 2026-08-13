> [!IMPORTANT]
> External pull requests are not accepted and will be closed automatically.
> Please open an issue for bugs, data corrections, or suggestions. This template
> is for maintainer-authored pull requests from within the organization. See the
> [contribution policy](https://github.com/solana-foundation/tokens/blob/main/CONTRIBUTING.md).

## Summary

Describe what changed.

## Why

Explain the reason for the change.

## Risk / Impact

Call out user-facing, API, auth, dependency, or operational risk.

## Verification

Confirm the credential-free checks pass (see TESTING.md):

- [ ] `bun run check:repo-hygiene`
- [ ] `bun run verify:api-health-routes`
- [ ] `bun run lint`
- [ ] `bun run build`
- [ ] `bun run audit:deps`

## Docs / Tests

Note any docs updates, new checks, or reasons they were not added.

## Linked issue

Closes #
