import { describe, expect, it } from 'bun:test';

import { IdentityRequiredError, InvalidArgsError, UnauthorizedError } from './errors';
import { generateCanonicalLogoUploadUrl, type LogoUploadSigner, type LogoUploadsDeps } from './logoUploads';

const ADMINS: ReadonlySet<string> = new Set(['user_admin']);
const ADMIN = { clerkUserId: 'user_admin' };
const NOW = 1_750_000_000_000;

function makeDeps(overrides: Partial<LogoUploadsDeps> = {}): { deps: LogoUploadsDeps; signed: string[] } {
    const signed: string[] = [];
    const signer: LogoUploadSigner = {
        signPutUrl: async (objectName, contentType) => {
            signed.push(`${objectName}|${contentType}`);
            return `https://signed.example/${objectName}`;
        },
        publicUrl: objectName => `https://storage.googleapis.com/tokens-asset-logos-test/${objectName}`,
    };
    return { deps: { signer, adminAllowlist: { clerkUserIds: ADMINS, emails: new Set<string>() }, now: () => NOW, ...overrides }, signed };
}

describe('generateCanonicalLogoUploadUrl', () => {
    it('requires identity and admin allowlist membership', async () => {
        const { deps } = makeDeps();
        await expect(generateCanonicalLogoUploadUrl(deps, { assetId: 'bonk', contentType: 'image/png' }, null))
            .rejects.toBeInstanceOf(IdentityRequiredError);
        await expect(
            generateCanonicalLogoUploadUrl(deps, { assetId: 'bonk', contentType: 'image/png' }, { clerkUserId: 'user_other' }),
        ).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('returns a signed PUT URL + public URL with a content-type-derived extension', async () => {
        const { deps, signed } = makeDeps();
        const result = await generateCanonicalLogoUploadUrl(deps, { assetId: 'bonk', contentType: 'image/webp' }, ADMIN);
        expect(result.objectName.startsWith(`logos/bonk/${NOW}-`)).toBe(true);
        expect(result.objectName.endsWith('.webp')).toBe(true);
        expect(result.uploadUrl).toBe(`https://signed.example/${result.objectName}`);
        expect(result.publicUrl).toBe(`https://storage.googleapis.com/tokens-asset-logos-test/${result.objectName}`);
        expect(signed[0]).toBe(`${result.objectName}|image/webp`);
    });

    it('rejects unsupported content types and missing args', async () => {
        const { deps } = makeDeps();
        await expect(
            generateCanonicalLogoUploadUrl(deps, { assetId: 'bonk', contentType: 'image/gif' }, ADMIN),
        ).rejects.toBeInstanceOf(InvalidArgsError);
        await expect(generateCanonicalLogoUploadUrl(deps, { contentType: 'image/png' }, ADMIN)).rejects.toBeInstanceOf(
            InvalidArgsError,
        );
    });

    it('sanitizes slashes in asset ids', async () => {
        const { deps } = makeDeps();
        const result = await generateCanonicalLogoUploadUrl(
            deps,
            { assetId: 'weird/../id', contentType: 'image/png' },
            ADMIN,
        );
        expect(result.objectName.startsWith('logos/weird_.._id/')).toBe(true);
    });

    it('errors clearly when no signer is configured', async () => {
        const { deps } = makeDeps();
        delete deps.signer;
        await expect(
            generateCanonicalLogoUploadUrl(deps, { assetId: 'bonk', contentType: 'image/png' }, ADMIN),
        ).rejects.toThrow('GCS_LOGO_BUCKET');
    });
});
