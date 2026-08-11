import { describe, expect, it } from 'bun:test';

import {
    isAdminClerkUserId,
    parseAdminClerkUserIds,
    parseAdminEmails,
    requireAdmin,
    type AdminAllowlist,
} from './adminAuth';
import { IdentityRequiredError, UnauthorizedError } from './handlers/assets';

const NO_EMAILS = new Set<string>();

function allowlist(clerkUserIds: ReadonlySet<string>, emails: ReadonlySet<string> = NO_EMAILS): AdminAllowlist {
    return { clerkUserIds, emails };
}

describe('parseAdminClerkUserIds', () => {
    it('splits on commas, trims, and drops empties', () => {
        const ids = parseAdminClerkUserIds(' user_a , user_b,,  ,user_c ');
        expect([...ids].sort()).toEqual(['user_a', 'user_b', 'user_c']);
    });

    it('returns an empty set for undefined/empty input', () => {
        expect(parseAdminClerkUserIds(undefined).size).toBe(0);
        expect(parseAdminClerkUserIds('').size).toBe(0);
    });
});

describe('parseAdminEmails', () => {
    it('splits on commas, trims, lowercases, and drops empties', () => {
        const emails = parseAdminEmails(' Alice@Example.com , bob@example.com,,  ');
        expect([...emails].sort()).toEqual(['alice@example.com', 'bob@example.com']);
    });

    it('returns an empty set for undefined/empty input', () => {
        expect(parseAdminEmails(undefined).size).toBe(0);
        expect(parseAdminEmails('').size).toBe(0);
    });
});

describe('isAdminClerkUserId', () => {
    const ids = parseAdminClerkUserIds('user_a,user_b');

    it('matches trimmed ids', () => {
        expect(isAdminClerkUserId(ids, 'user_a')).toBe(true);
        expect(isAdminClerkUserId(ids, ' user_b ')).toBe(true);
        expect(isAdminClerkUserId(ids, 'user_c')).toBe(false);
        expect(isAdminClerkUserId(ids, null)).toBe(false);
        expect(isAdminClerkUserId(ids, undefined)).toBe(false);
        expect(isAdminClerkUserId(ids, '')).toBe(false);
    });
});

describe('requireAdmin', () => {
    const ids = parseAdminClerkUserIds('user_a');

    it('throws IdentityRequiredError when no identity was forwarded', () => {
        expect(() => requireAdmin(allowlist(ids), null)).toThrow(IdentityRequiredError);
    });

    it('throws UnauthorizedError for a non-allowlisted caller', () => {
        expect(() => requireAdmin(allowlist(ids), { clerkUserId: 'user_z' })).toThrow(UnauthorizedError);
    });

    it('throws UnauthorizedError when both lists are empty', () => {
        expect(() => requireAdmin(allowlist(new Set<string>()), { clerkUserId: 'user_a' })).toThrow(UnauthorizedError);
    });

    it('returns the trimmed clerkUserId for an admin caller', () => {
        expect(requireAdmin(allowlist(ids), { clerkUserId: ' user_a ' })).toEqual({ clerkUserId: 'user_a' });
    });

    it('passes on an email match when the user id is not allowlisted', () => {
        const list = allowlist(ids, parseAdminEmails('admin@example.com'));
        expect(requireAdmin(list, { clerkUserId: 'user_z', email: 'admin@example.com' })).toEqual({
            clerkUserId: 'user_z',
        });
    });

    it('matches emails case-insensitively', () => {
        const list = allowlist(new Set<string>(), parseAdminEmails('Admin@Example.com'));
        expect(requireAdmin(list, { clerkUserId: 'user_z', email: 'ADMIN@example.COM' })).toEqual({
            clerkUserId: 'user_z',
        });
    });

    it('fails closed when the identity carries no email and the id does not match', () => {
        const list = allowlist(new Set<string>(), parseAdminEmails('admin@example.com'));
        expect(() => requireAdmin(list, { clerkUserId: 'user_z' })).toThrow(UnauthorizedError);
    });

    it('rejects a non-allowlisted email', () => {
        const list = allowlist(new Set<string>(), parseAdminEmails('admin@example.com'));
        expect(() => requireAdmin(list, { clerkUserId: 'user_z', email: 'intruder@example.com' })).toThrow(
            UnauthorizedError,
        );
    });

    it('unions the two lists (id-only admin still passes with emails configured)', () => {
        const list = allowlist(ids, parseAdminEmails('admin@example.com'));
        expect(requireAdmin(list, { clerkUserId: 'user_a' })).toEqual({ clerkUserId: 'user_a' });
    });
});
