/**
 * Canonical asset logo uploads (GCS).
 *
 * Replaces Convex's `generateCanonicalLogoUploadUrl` (which used Convex file
 * storage) with a V4 signed PUT URL into the public logo bucket
 * (`tokens-asset-logos-<env>`, terraform `google_storage_bucket.asset_logos`).
 * The admin dialogs PUT the file bytes to `uploadUrl` (Content-Type must
 * match) and then persist `publicUrl` as `imageUrl` on the asset.
 */

import { requireAdmin, type AdminAllowlist } from '../adminAuth';
import type { CallerIdentity } from '../server';
import { InvalidArgsError } from './errors';
import { asArgsObject, requireString } from './shared';

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
};

export interface LogoUploadSigner {
    /** Returns a V4 signed PUT URL for the object with the given content type. */
    signPutUrl(objectName: string, contentType: string): Promise<string>;
    /** Publicly readable URL for the object once uploaded. */
    publicUrl(objectName: string): string;
}

export interface LogoUploadsDeps {
    signer?: LogoUploadSigner;
    adminAllowlist: AdminAllowlist;
    now?: () => number;
}

export interface LogoUploadUrlResult {
    uploadUrl: string;
    publicUrl: string;
    objectName: string;
    contentType: string;
}

export async function generateCanonicalLogoUploadUrl(
    deps: LogoUploadsDeps,
    args: unknown,
    identity: CallerIdentity | null,
): Promise<LogoUploadUrlResult> {
    requireAdmin(deps.adminAllowlist, identity);
    const a = asArgsObject(args);

    const assetId = requireString(a, 'assetId').trim();
    if (!assetId) throw new InvalidArgsError('assetId is required');

    const contentType = requireString(a, 'contentType').trim().toLowerCase();
    const ext = EXT_BY_CONTENT_TYPE[contentType];
    if (!ext) {
        throw new InvalidArgsError(
            `Unsupported logo content type: ${contentType} (expected png/jpeg/webp/svg+xml)`,
        );
    }

    const signer = deps.signer;
    if (!signer) {
        throw new Error('GCS_LOGO_BUCKET is not configured — logo uploads are unavailable');
    }

    const nowMs = (deps.now ?? Date.now)();
    const random = crypto.randomUUID().slice(0, 8);
    const safeAssetId = assetId.replaceAll('/', '_');
    const objectName = `logos/${safeAssetId}/${nowMs}-${random}.${ext}`;

    const uploadUrl = await signer.signPutUrl(objectName, contentType);
    return {
        uploadUrl,
        publicUrl: signer.publicUrl(objectName),
        objectName,
        contentType,
    };
}
