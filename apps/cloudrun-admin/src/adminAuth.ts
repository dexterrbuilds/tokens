/**
 * Port of `convex/adminAuth.ts`.
 *
 * The allowlist is injected (wired from `TOKENS_ADMIN_CLERK_USER_IDS` and
 * `TOKENS_ADMIN_EMAILS` in index.ts) so handlers are testable, and failures
 * map to the dispatcher's 401/403 statuses:
 * - no caller identity → IdentityRequiredError (401)
 * - identity not on the allowlist → UnauthorizedError (403)
 *
 * Union semantics: a caller passes on a Clerk user-ID match OR a (lowercased)
 * email match. Both lists empty means every caller is rejected (fail closed).
 * The email in the identity header is trustworthy because only the
 * IAM/bearer-authenticated Next.js admin proxy sets it, and the proxy only
 * forwards a Clerk-verified, allowlist-matched address.
 */

import { IdentityRequiredError, UnauthorizedError } from './handlers/errors';
import type { CallerIdentity } from './server';

export interface AdminAllowlist {
    clerkUserIds: ReadonlySet<string>;
    /** Lowercased, Clerk-verified admin emails. */
    emails: ReadonlySet<string>;
}

export function parseAdminClerkUserIds(raw: string | null | undefined): ReadonlySet<string> {
    const values = (raw ?? '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
    return new Set(values);
}

export function parseAdminEmails(raw: string | null | undefined): ReadonlySet<string> {
    const values = (raw ?? '')
        .split(',')
        .map(value => value.trim().toLowerCase())
        .filter(Boolean);
    return new Set(values);
}

export function isAdminClerkUserId(
    adminClerkUserIds: ReadonlySet<string>,
    clerkUserId: string | null | undefined,
): boolean {
    if (!clerkUserId) return false;
    return adminClerkUserIds.has(clerkUserId.trim());
}

export function isAdminIdentity(allowlist: AdminAllowlist, identity: CallerIdentity): boolean {
    if (isAdminClerkUserId(allowlist.clerkUserIds, identity.clerkUserId)) return true;
    const email = identity.email?.trim().toLowerCase();
    return Boolean(email && allowlist.emails.has(email));
}

export function requireAdmin(allowlist: AdminAllowlist, identity: CallerIdentity | null): { clerkUserId: string } {
    if (!identity) throw new IdentityRequiredError();
    const clerkUserId = identity.clerkUserId.trim();
    if (!clerkUserId || !isAdminIdentity(allowlist, identity)) {
        throw new UnauthorizedError('Unauthorized');
    }
    return { clerkUserId };
}
