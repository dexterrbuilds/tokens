/**
 * Compatibility re-exports for the existing web app.
 *
 * The web app currently imports curated lists, wrapper groups, and variant groups
 * from `apps/web/src/lib/*`. Dogfooding the new API/registry starts by swapping
 * those imports to this module without changing call sites.
 */

export type { CuratedTokenList, CuratedTokenListId } from './data/curated-token-lists';
export {
    CURATED_LIST_ORDER,
    CURATED_TOKEN_LISTS,
    getCuratedTokenAddresses,
    getCuratedTokenList,
    isCuratedTokenListId,
    normalizeCuratedTokenListId,
} from './data/curated-token-lists';

export type { LatestAddedToken } from './data/curated-latest-added';
export { getCuratedTokenAddedAt, getLatestAddedToken } from './data/curated-latest-added';
export { CURATED_TOKEN_ADDED_AT } from './data/curated-token-added-at';

export type { TokenWrapper, TokenWrapperGroup } from './data/token-wrappers';
export {
    TOKEN_WRAPPER_GROUPS,
    getAllWrappersForGroup,
    getSiblingWrappers,
    getWrapperByAddress,
    getWrapperGroupByAddress,
    getWrapperGroupByCoingeckoId,
} from './data/token-wrappers';

export type { TokenVariantAddress, TokenVariantGroup } from './data/token-variants';
export {
    BITCOIN_VARIANT_GROUP,
    TOKEN_VARIANT_GROUPS,
    XSTOCK_VARIANT_GROUPS,
    getTokenVariantGroup,
    getTokenVariantGroupById,
} from './data/token-variants';
