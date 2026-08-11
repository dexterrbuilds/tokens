import { CURATED_CATEGORY_SLUGS, asArgsObject, type CuratedCategorySlug } from './shared';
import { requireAdmin, type AdminAllowlist } from '../adminAuth';
import type { CallerIdentity } from '../server';

export { CURATED_CATEGORY_SLUGS, type CuratedCategorySlug };

const DEFAULT_TITLE: Record<CuratedCategorySlug, string> = {
    majors: 'Majors',
    currencies: 'Currencies',
    rwas: 'RWAs',
    etfs: 'ETFs',
    metals: 'Metals',
    stocks: 'Stocks',
};

export interface CategorySummary {
    id: CuratedCategorySlug;
    name: string;
    count: number;
    lastAddedAssetId: string | null;
}

export interface AdminRepo {
    listCategorySummaries(slugs: readonly CuratedCategorySlug[]): Promise<CategorySummary[]>;
}

export interface CuratedTokensDeps {
    repo: AdminRepo;
    adminAllowlist: AdminAllowlist;
}

export async function listCategories(
    deps: CuratedTokensDeps,
    args: unknown,
    identity: CallerIdentity | null,
): Promise<CategorySummary[]> {
    requireAdmin(deps.adminAllowlist, identity);
    asArgsObject(args);
    const summaries = await deps.repo.listCategorySummaries(CURATED_CATEGORY_SLUGS);
    const bySlug = new Map(summaries.map(s => [s.id, s]));
    return CURATED_CATEGORY_SLUGS.map(slug => {
        const summary = bySlug.get(slug);
        const name = (summary?.name ?? '').trim() || DEFAULT_TITLE[slug];
        return {
            id: slug,
            name,
            count: summary?.count ?? 0,
            lastAddedAssetId: summary?.lastAddedAssetId ?? null,
        };
    });
}
