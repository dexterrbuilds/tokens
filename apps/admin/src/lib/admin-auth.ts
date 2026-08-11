import 'server-only';

import { clerkClient } from '@clerk/nextjs/server';

/**
 * Admin allowlist. Two env vars gate three layers (this Next.js proxy,
 * cloudrun-admin, and the admin mutations on cloudrun-assets), with union
 * semantics: a caller is admin when their Clerk user ID is in
 * `TOKENS_ADMIN_CLERK_USER_IDS` OR one of their Clerk-verified emails is in
 * `TOKENS_ADMIN_EMAILS`. Both lists empty means nobody is admin (fail closed).
 *
 * Emails are resolved via the Clerk Backend API rather than JWT claims:
 * session claims cannot express whether an address is verified, and an
 * unverified address must never grant admin.
 */

export interface ResolvedAdmin {
    isAdmin: boolean;
    /** The verified, lowercased email that matched the allowlist, when the email path granted access. */
    email?: string;
}

export function parseAdminClerkUserIds(raw: string | undefined = process.env.TOKENS_ADMIN_CLERK_USER_IDS): Set<string> {
    const out = new Set<string>();
    for (const part of (raw ?? '').split(',')) {
        const trimmed = part.trim();
        if (trimmed) out.add(trimmed);
    }
    return out;
}

export function isAdminClerkUserId(clerkUserId: string | null | undefined): boolean {
    if (!clerkUserId) return false;
    return parseAdminClerkUserIds().has(clerkUserId);
}

export function parseAdminEmails(raw: string | undefined = process.env.TOKENS_ADMIN_EMAILS): Set<string> {
    const out = new Set<string>();
    for (const part of (raw ?? '').split(',')) {
        const trimmed = part.trim().toLowerCase();
        if (trimmed) out.add(trimmed);
    }
    return out;
}

const RESOLVE_CACHE_TTL_MS = 5 * 60 * 1000;
const RESOLVE_CACHE_MAX_ENTRIES = 1000;

interface ResolveCacheEntry {
    expiresAt: number;
    result: ResolvedAdmin;
}

// Positive AND negative results are cached so non-allowlisted users cannot
// hammer the Clerk API by reloading; Clerk API failures are never cached.
const resolveCache = new Map<string, ResolveCacheEntry>();

function pruneResolveCache(now: number): void {
    if (resolveCache.size < RESOLVE_CACHE_MAX_ENTRIES) return;
    for (const [key, entry] of resolveCache) {
        if (entry.expiresAt <= now) resolveCache.delete(key);
    }
    if (resolveCache.size >= RESOLVE_CACHE_MAX_ENTRIES) resolveCache.clear();
}

export async function resolveAdmin(clerkUserId: string): Promise<ResolvedAdmin> {
    if (isAdminClerkUserId(clerkUserId)) return { isAdmin: true };

    const adminEmails = parseAdminEmails();
    if (adminEmails.size === 0) return { isAdmin: false };

    const now = Date.now();
    const cached = resolveCache.get(clerkUserId);
    if (cached && cached.expiresAt > now) return cached.result;

    let result: ResolvedAdmin;
    try {
        const client = await clerkClient();
        const user = await client.users.getUser(clerkUserId);
        const match = user.emailAddresses.find(
            entry =>
                entry.verification?.status === 'verified' && adminEmails.has(entry.emailAddress.trim().toLowerCase()),
        );
        result = match ? { isAdmin: true, email: match.emailAddress.trim().toLowerCase() } : { isAdmin: false };
    } catch (error) {
        // Fail closed, but do not cache: a transient Clerk outage should not
        // lock a legitimate admin out for the full TTL.
        console.error('[admin-auth] Clerk user lookup failed; denying admin access', error);
        return { isAdmin: false };
    }

    pruneResolveCache(now);
    resolveCache.set(clerkUserId, { expiresAt: now + RESOLVE_CACHE_TTL_MS, result });
    return result;
}
