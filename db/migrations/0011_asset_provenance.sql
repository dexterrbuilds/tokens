-- Provenance for the no-PR admin pipeline.
--
-- The nightly registry seed used to DELETE+reinsert asset_collection_members,
-- wiping admin-added membership and admin edits. To merge instead of replace,
-- the seed needs to know which rows the admin owns:
--   - asset_collection_members.source: 'registry' rows are managed by the seed
--     (inserted/removed as the committed files change); 'admin' rows are never
--     touched by the seed.
--   - assets.admin_edited_at: when set, the seed stops overwriting the asset's
--     fields (an admin edit wins over the committed registry until cleared).
--
-- The unique index also replaces the pg_advisory_xact_lock workaround in
-- upsertAssetCollectionMember with a plain ON CONFLICT upsert.

-- Dedupe before creating the unique index: keep the earliest-added row per
-- (collection_slug, asset_id), breaking added_at ties by id for determinism.
DELETE FROM asset_collection_members acm
USING asset_collection_members keeper
WHERE acm.collection_slug = keeper.collection_slug
  AND acm.asset_id = keeper.asset_id
  AND (acm.added_at, acm.id) > (keeper.added_at, keeper.id);

CREATE UNIQUE INDEX asset_collection_members_by_slug_and_asset
    ON asset_collection_members (collection_slug, asset_id);

ALTER TABLE asset_collection_members
    ADD COLUMN source text NOT NULL DEFAULT 'registry'
    CHECK (source IN ('registry', 'admin'));

-- Unix ms, matching asset_collection_members.added_at.
ALTER TABLE assets ADD COLUMN admin_edited_at bigint;

INSERT INTO schema_migrations(version) VALUES ('0011_asset_provenance');
