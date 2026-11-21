-- Retention canonicalizes the five source arrays included in the Memory body
-- hash. Bind only after that trigger has produced the actual stored row.
ALTER TRIGGER memory_records_payload_source_binding ON public.memory_records
RENAME TO zz_memory_records_payload_source_binding;

--> statement-breakpoint
-- Earlier trigger ordering could leave an apparently bound snapshot with a
-- stale body hash. Unknown is irreversible; never restamp that lost history.
UPDATE public.memory_records AS m SET payload_source_snapshot = NULL
WHERE m.payload_source_snapshot IS NOT NULL
  AND (m.payload_source_snapshot #>> '{owner,contentHash}') IS DISTINCT FROM
    public.aw_native_payload_body_hash('memory_record', to_jsonb(m));
