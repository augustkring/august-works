-- Custom SQL migration file, put your code below! --
-- Historical backfill cursors/counts have no governed Source lineage or expiry.
-- Erase only these derived operational rows rather than inventing retrospective
-- processing approval. Native activity, event projections and suppression
-- identities remain under their original owners.
DELETE FROM business_event_backfill_runs;
-- Keep the canonical audit action/actor/time while removing its redundant
-- ungoverned derived counters. New audit publications retain only the version.
UPDATE activity_log SET details = details - ARRAY['projected','unchanged']::text[]
WHERE action = 'business_event.backfill_recorded';
