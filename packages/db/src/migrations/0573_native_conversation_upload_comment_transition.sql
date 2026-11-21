-- Preserve a direct Human upload's original Task/audit evidence while allowing
-- the exact first-comment owner transition. This does not clear snapshots or
-- change the monotonic invalidation marker.
CREATE OR REPLACE FUNCTION public.aw_native_conversation_upload_comment_transition_valid(
  old_row jsonb, new_row jsonb
) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE old_snapshot jsonb; new_snapshot jsonb; comment_input jsonb;
  comment_row public.issue_comments%ROWTYPE; upload_input jsonb;
  upload_row public.issue_attachments%ROWTYPE; upload_asset public.assets%ROWTYPE;
  task_id uuid; v_company uuid; owner_user_id text; comment_id uuid; attachment_id uuid;
  old_attachment_hash text; old_attachment_snapshot jsonb; old_attachment_digest text;
  object_key_count integer; seen_attachment_ids text[] := ARRAY[]::text[];
BEGIN
  IF old_row->>'id' IS NULL OR old_row->>'company_id' IS NULL THEN RETURN false; END IF;
  task_id := (old_row->>'id')::uuid;
  v_company := (old_row->>'company_id')::uuid;
  old_snapshot := old_row->'payload_source_snapshot';
  new_snapshot := new_row->'payload_source_snapshot';
  IF jsonb_typeof(old_snapshot) IS DISTINCT FROM 'object' OR
     jsonb_typeof(new_snapshot) IS DISTINCT FROM 'object' OR
     old_row->>'payload_source_protocol_version' IS DISTINCT FROM '1' OR
     new_row->>'payload_source_protocol_version' IS DISTINCT FROM '1' OR
     old_row->>'payload_source_snapshot_invalidated' IS DISTINCT FROM 'false' OR
     new_row->>'payload_source_snapshot_invalidated' IS DISTINCT FROM 'false' OR
     old_row->>'origin_kind' IS DISTINCT FROM 'manual' OR
     old_row->>'origin_id' IS NOT NULL OR
     old_row->>'created_by_user_id' IS NULL OR old_row->>'created_by_agent_id' IS NOT NULL OR
     old_row->>'conversation_user_id' IS DISTINCT FROM old_row->>'created_by_user_id' OR
     old_row->>'conversation_agent_id' IS NULL OR old_row->>'parent_id' IS NOT NULL OR
     old_row->>'project_id' IS NOT NULL OR old_row->>'description' IS NOT NULL OR
     old_row->>'execution_run_id' IS NOT NULL OR old_row->>'conversation_state' IS DISTINCT FROM 'waiting' OR
     old_row->>'status' IS DISTINCT FROM 'in_review' OR
     old_row->>'conversation_session_generation' IS DISTINCT FROM '0' OR
     old_row->>'conversation_boundary_comment_id' IS NOT NULL OR
     old_row->>'conversation_retired_at' IS NOT NULL OR
     (to_jsonb(new_row)-ARRAY['payload_source_snapshot','updated_at']) IS DISTINCT FROM
       (to_jsonb(old_row)-ARRAY['payload_source_snapshot','updated_at']) OR
     old_snapshot ? 'transforms' OR new_snapshot ? 'transforms' OR
     old_snapshot->'version' IS DISTINCT FROM '1'::jsonb OR
     new_snapshot->'version' IS DISTINCT FROM '1'::jsonb OR
     old_snapshot->'policy' IS DISTINCT FROM jsonb_build_object('issueIds','[]'::jsonb,'projectIds','[]'::jsonb,
       'runIds','[]'::jsonb,'memoryIds','[]'::jsonb,'foundationRevisionIds','[]'::jsonb) OR
     new_snapshot->'policy' IS DISTINCT FROM jsonb_build_object('issueIds','[]'::jsonb,'projectIds','[]'::jsonb,
       'runIds','[]'::jsonb,'memoryIds','[]'::jsonb,'foundationRevisionIds','[]'::jsonb) OR
     old_snapshot->'owner'->>'kind' IS DISTINCT FROM 'issue' OR
     old_snapshot->'owner'->>'id' IS DISTINCT FROM task_id::text OR
     old_snapshot->'owner'->>'companyId' IS DISTINCT FROM v_company::text OR
     old_snapshot->'owner'->>'contentHash' IS DISTINCT FROM public.aw_native_payload_body_hash('issue',old_row) OR
     old_snapshot->>'digest' IS DISTINCT FROM encode(sha256(convert_to((old_snapshot-'digest')::text,'UTF8')),'hex') OR
     new_snapshot->'owner'->>'kind' IS DISTINCT FROM 'issue' OR
     new_snapshot->'owner'->>'id' IS DISTINCT FROM task_id::text OR
     new_snapshot->'owner'->>'companyId' IS DISTINCT FROM v_company::text OR
     new_snapshot->'owner'->>'contentHash' IS DISTINCT FROM public.aw_native_payload_body_hash('issue',new_row) OR
     new_snapshot->>'digest' IS DISTINCT FROM encode(sha256(convert_to((new_snapshot-'digest')::text,'UTF8')),'hex') THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(old_snapshot->'inputs') IS DISTINCT FROM 'array' OR
     jsonb_typeof(new_snapshot->'inputs') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(old_snapshot->'inputs')<1 OR jsonb_array_length(old_snapshot->'inputs')>20 OR
     jsonb_array_length(new_snapshot->'inputs')<>1 THEN RETURN false; END IF;

  SELECT value INTO comment_input FROM jsonb_array_elements(new_snapshot->'inputs') AS e(value);
  IF jsonb_typeof(comment_input) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  SELECT count(*) INTO object_key_count FROM jsonb_object_keys(comment_input);
  IF object_key_count<>5 OR comment_input->>'kind' IS DISTINCT FROM 'comment' OR
     comment_input->>'issueId' IS DISTINCT FROM task_id::text OR
     comment_input->>'commentId' !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' OR
     comment_input->>'sourceVersion' IS NULL OR comment_input->>'contentHash' !~ '^[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;
  comment_id := (comment_input->>'commentId')::uuid;
  owner_user_id := old_row->>'conversation_user_id';
  SELECT * INTO comment_row FROM public.issue_comments c WHERE c.company_id=v_company AND c.issue_id=task_id AND c.id=comment_id;
  IF comment_row.id IS NULL OR comment_row.deleted_at IS NOT NULL OR comment_row.author_type IS DISTINCT FROM 'user' OR
     comment_row.author_user_id IS DISTINCT FROM owner_user_id OR comment_row.author_agent_id IS NOT NULL OR
     comment_row.created_by_run_id IS NOT NULL OR comment_row.payload_source_protocol_version<>1 OR
     comment_row.payload_source_snapshot IS NULL OR comment_row.payload_source_snapshot_invalidated OR
     comment_row.payload_source_snapshot->'version' IS DISTINCT FROM '1'::jsonb OR
     comment_input->>'sourceVersion' IS DISTINCT FROM extract(epoch FROM comment_row.updated_at)::text OR
     comment_input->>'contentHash' IS DISTINCT FROM encode(sha256(convert_to(public.aw_native_canonical_jsonb(
       jsonb_build_object('body',comment_row.body,'presentation',comment_row.presentation,'metadata',comment_row.metadata)),'UTF8')),'hex') OR
     comment_row.payload_source_snapshot->'owner'->>'kind' IS DISTINCT FROM 'comment' OR
     comment_row.payload_source_snapshot->'owner'->>'id' IS DISTINCT FROM comment_id::text OR
     comment_row.payload_source_snapshot->'owner'->>'companyId' IS DISTINCT FROM v_company::text OR
     comment_row.payload_source_snapshot->'owner'->>'contentHash' IS DISTINCT FROM public.aw_native_payload_body_hash('comment',to_jsonb(comment_row)) OR
     comment_row.payload_source_snapshot->'policy' IS DISTINCT FROM jsonb_build_object('issueIds',jsonb_build_array(task_id::text),
       'projectIds','[]'::jsonb,'runIds','[]'::jsonb,'memoryIds','[]'::jsonb,'foundationRevisionIds','[]'::jsonb) OR
     comment_row.payload_source_snapshot->'inputs' IS DISTINCT FROM '[]'::jsonb OR
     comment_row.payload_source_snapshot->>'digest' IS DISTINCT FROM encode(sha256(convert_to(
       (comment_row.payload_source_snapshot-'digest')::text,'UTF8')),'hex') OR
     (SELECT count(*) FROM public.issue_comments c WHERE c.company_id=v_company AND c.issue_id=task_id)<>1 OR
     NOT EXISTS (SELECT 1 FROM public.company_memberships cm WHERE cm.company_id=v_company
       AND cm.principal_type='user' AND cm.principal_id=owner_user_id AND cm.status='active') OR
     NOT EXISTS (SELECT 1 FROM public.activity_log a WHERE a.company_id=v_company AND a.actor_type='user'
       AND a.actor_id=owner_user_id AND a.action='issue.conversation_opened' AND a.entity_type='issue'
       AND a.entity_id=task_id::text AND a.details->>'agentId'=old_row->>'conversation_agent_id') THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.issue_privacy_sources s WHERE s.company_id=v_company AND s.issue_id=task_id) OR
     EXISTS (SELECT 1 FROM public.issue_documents d WHERE d.company_id=v_company AND d.issue_id=task_id) THEN
    RETURN false;
  END IF;

  IF (SELECT count(*) FROM public.issue_attachments a WHERE a.company_id=v_company AND a.issue_id=task_id)
       <>jsonb_array_length(old_snapshot->'inputs') THEN RETURN false; END IF;
  FOR upload_input IN SELECT value FROM jsonb_array_elements(old_snapshot->'inputs') AS e(value) LOOP
    IF jsonb_typeof(upload_input) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    SELECT count(*) INTO object_key_count FROM jsonb_object_keys(upload_input);
    IF object_key_count<>8 OR upload_input->>'kind' IS DISTINCT FROM 'attachment' OR
       upload_input->>'issueId' IS DISTINCT FROM task_id::text OR upload_input->'commentId' IS DISTINCT FROM 'null'::jsonb OR
       upload_input->>'disposition' IS DISTINCT FROM 'delivered' OR
       upload_input->>'attachmentId' !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN RETURN false; END IF;
    attachment_id := (upload_input->>'attachmentId')::uuid;
    IF attachment_id::text=ANY(seen_attachment_ids) THEN RETURN false; END IF;
    seen_attachment_ids := array_append(seen_attachment_ids,attachment_id::text);
    SELECT * INTO upload_row FROM public.issue_attachments a
      WHERE a.company_id=v_company AND a.issue_id=task_id AND a.id=attachment_id;
    IF upload_row.id IS NULL OR upload_row.issue_comment_id IS DISTINCT FROM comment_id OR upload_row.originating_run_id IS NOT NULL OR
       upload_row.payload_source_protocol_version<>1 OR upload_row.payload_source_snapshot IS NULL OR
       upload_row.payload_source_snapshot_invalidated OR upload_row.payload_source_snapshot->'inputs' IS DISTINCT FROM '[]'::jsonb OR
       upload_row.payload_source_snapshot->'version' IS DISTINCT FROM '1'::jsonb OR
       upload_row.payload_source_snapshot->'policy' IS DISTINCT FROM jsonb_build_object('issueIds',jsonb_build_array(task_id::text),
         'projectIds','[]'::jsonb,'runIds','[]'::jsonb,'memoryIds','[]'::jsonb,'foundationRevisionIds','[]'::jsonb) OR
       upload_row.payload_source_snapshot->'owner'->>'kind' IS DISTINCT FROM 'attachment' OR
       upload_row.payload_source_snapshot->'owner'->>'id' IS DISTINCT FROM attachment_id::text OR
       upload_row.payload_source_snapshot->'owner'->>'companyId' IS DISTINCT FROM v_company::text OR
       upload_row.payload_source_snapshot->'owner'->>'contentHash' IS DISTINCT FROM
         public.aw_native_payload_body_hash('attachment',to_jsonb(upload_row)) OR
       upload_row.payload_source_snapshot->>'digest' IS DISTINCT FROM encode(sha256(convert_to(
         (upload_row.payload_source_snapshot-'digest')::text,'UTF8')),'hex') THEN RETURN false; END IF;
    SELECT * INTO upload_asset FROM public.assets a WHERE a.company_id=v_company AND a.id=upload_row.asset_id;
    IF upload_asset.id IS NULL OR upload_asset.created_by_user_id IS DISTINCT FROM owner_user_id OR
       upload_asset.created_by_agent_id IS NOT NULL OR
       upload_asset.sha256 !~ '^[0-9a-f]{64}$' OR upload_asset.byte_size<=0 OR upload_asset.byte_size>9007199254740991 OR
       upload_input->>'assetId' IS DISTINCT FROM upload_asset.id::text OR upload_input->>'sha256' IS DISTINCT FROM upload_asset.sha256 OR
       upload_input->>'byteSize' IS DISTINCT FROM upload_asset.byte_size::text THEN RETURN false; END IF;

    old_attachment_hash := public.aw_native_payload_body_hash('attachment',
      to_jsonb(upload_row)||jsonb_build_object('issue_comment_id',NULL));
    old_attachment_snapshot := jsonb_build_object('version',1,'owner',jsonb_build_object('kind','attachment',
      'companyId',v_company::text,'id',attachment_id::text,'contentHash',old_attachment_hash),
      'policy',jsonb_build_object('issueIds',jsonb_build_array(task_id::text),'projectIds','[]'::jsonb,
        'runIds','[]'::jsonb,'memoryIds','[]'::jsonb,'foundationRevisionIds','[]'::jsonb),'inputs','[]'::jsonb);
    old_attachment_digest := encode(sha256(convert_to(old_attachment_snapshot::text,'UTF8')),'hex');
    IF upload_row.payload_source_snapshot->'owner'->>'contentHash' IS DISTINCT FROM
         public.aw_native_payload_body_hash('attachment',to_jsonb(upload_row)) OR
       NOT EXISTS (SELECT 1 FROM public.activity_log a WHERE a.company_id=v_company AND a.actor_type='user'
         AND a.actor_id=owner_user_id AND a.action='attachment.payload_source_captured' AND a.entity_type='issue'
         AND a.entity_id=task_id::text AND a.details->>'attachmentId'=attachment_id::text
         AND a.details->>'assetId'=upload_asset.id::text AND a.details->>'producer'='direct_manual_upload'
         AND a.details->>'contentHash'=old_attachment_hash AND a.details->>'digest'=old_attachment_digest) THEN
      RETURN false;
    END IF;
  END LOOP;
  IF cardinality(seen_attachment_ids)<>jsonb_array_length(old_snapshot->'inputs') OR
     EXISTS (SELECT 1 FROM public.issue_attachments a WHERE a.company_id=v_company AND a.issue_id=task_id
       AND a.issue_comment_id IS DISTINCT FROM comment_id) THEN RETURN false; END IF;
  RETURN true;
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.aw_native_payload_source_binding() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE snapshot jsonb; row_data jsonb; owner_kind text := TG_ARGV[0];
BEGIN
  -- Invalidation is a server-owned monotonic lifecycle marker. This guard
  -- applies even when the forged row omits its snapshot; a NULL proof must
  -- not make an already-invalidated owner insertable.
  IF TG_OP='INSERT' AND NEW.payload_source_snapshot_invalidated IS DISTINCT FROM false THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native payload source invalidation marker is server-owned';
  END IF;
  IF NEW.payload_source_protocol_version NOT IN (0,1) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Unknown native payload source protocol';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.payload_source_protocol_version IS DISTINCT FROM OLD.payload_source_protocol_version THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native payload source protocol is insert-only';
    END IF;
    IF NEW.payload_source_snapshot_invalidated IS DISTINCT FROM OLD.payload_source_snapshot_invalidated THEN
      IF owner_kind='memory_record' THEN
        -- The evidence invalidation trigger may retain a stale snapshot as an
        -- inaccessible monotonicity witness. It cannot change any other field.
        IF to_jsonb(OLD)->>'created_by_actor_type'='user' AND OLD.payload_source_protocol_version=1
          AND OLD.payload_source_snapshot IS NOT NULL AND OLD.payload_source_snapshot_invalidated=false
          AND NEW.payload_source_snapshot_invalidated=true
          AND NEW.payload_source_snapshot IS NOT DISTINCT FROM OLD.payload_source_snapshot
          AND pg_trigger_depth()>1
          AND (to_jsonb(NEW)-'payload_source_snapshot_invalidated')=(to_jsonb(OLD)-'payload_source_snapshot_invalidated') THEN
          RETURN NEW;
        END IF;
        IF to_jsonb(OLD)->>'created_by_actor_type'='user' AND OLD.payload_source_protocol_version=1
          AND OLD.payload_source_snapshot IS NOT NULL AND OLD.payload_source_snapshot_invalidated=true
          AND NEW.payload_source_snapshot_invalidated=false AND NEW.payload_source_snapshot IS NOT NULL THEN
          snapshot := NEW.payload_source_snapshot;
          -- Source fields are merged in the preceding invalidated state. The
          -- final reseal itself may only replace the snapshot and clear its
          -- marker; it cannot change the already-bound body or owner fields.
          IF (to_jsonb(NEW)-ARRAY['payload_source_snapshot','payload_source_snapshot_invalidated','updated_at'])
              IS DISTINCT FROM
             (to_jsonb(OLD)-ARRAY['payload_source_snapshot','payload_source_snapshot_invalidated','updated_at']) THEN
            RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Human Memory evidence seal cannot change its body or owner';
          END IF;
          IF jsonb_typeof(OLD.payload_source_snapshot->'inputs') IS DISTINCT FROM 'array'
            OR jsonb_typeof(snapshot->'inputs') IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Human Memory evidence seal requires Task source history';
          END IF;
          IF (CASE WHEN jsonb_typeof(OLD.payload_source_snapshot->'inputs')='array'
              THEN jsonb_array_length(OLD.payload_source_snapshot->'inputs')>0 ELSE false END) IS NOT TRUE
            OR (CASE WHEN jsonb_typeof(snapshot->'inputs')='array'
              THEN jsonb_array_length(snapshot->'inputs')>0 ELSE false END) IS NOT TRUE THEN
            RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Human Memory evidence seal requires Task source history';
          END IF;
          IF EXISTS (SELECT 1 FROM jsonb_array_elements(OLD.payload_source_snapshot->'inputs') AS e(item)
              WHERE e.item->>'kind' IS DISTINCT FROM 'task')
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(snapshot->'inputs') AS e(item)
              WHERE e.item->>'kind' IS DISTINCT FROM 'task') THEN
            RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Human Memory evidence seal accepts only Task sources';
          END IF;
          row_data := to_jsonb(NEW);
          IF jsonb_typeof(snapshot) IS DISTINCT FROM 'object'
            OR snapshot->'version' IS DISTINCT FROM '1'::jsonb
            OR snapshot->'owner'->>'kind' IS DISTINCT FROM owner_kind
            OR snapshot->'owner'->>'companyId' IS DISTINCT FROM NEW.company_id::text
            OR snapshot->'owner'->>'id' IS DISTINCT FROM NEW.id::text
            OR snapshot->'owner'->>'contentHash' IS DISTINCT FROM public.aw_native_payload_body_hash(owner_kind,row_data)
            OR snapshot->>'digest' IS DISTINCT FROM encode(sha256(convert_to((snapshot-'digest')::text,'UTF8')),'hex')
            OR OLD.payload_source_snapshot->>'digest' IS DISTINCT FROM encode(sha256(convert_to((OLD.payload_source_snapshot-'digest')::text,'UTF8')),'hex')
            OR ((snapshot->'inputs') @> (OLD.payload_source_snapshot->'inputs')) IS NOT TRUE
            OR ((snapshot->'policy'->'issueIds') @> (OLD.payload_source_snapshot->'policy'->'issueIds')) IS NOT TRUE
            OR ((snapshot->'policy'->'projectIds') @> (OLD.payload_source_snapshot->'policy'->'projectIds')) IS NOT TRUE
            OR ((snapshot->'policy'->'runIds') @> (OLD.payload_source_snapshot->'policy'->'runIds')) IS NOT TRUE
            OR ((snapshot->'policy'->'memoryIds') @> (OLD.payload_source_snapshot->'policy'->'memoryIds')) IS NOT TRUE
            OR ((snapshot->'policy'->'foundationRevisionIds') @> (OLD.payload_source_snapshot->'policy'->'foundationRevisionIds')) IS NOT TRUE THEN
            RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Human Memory evidence seal does not retain its source history';
          END IF;
          RETURN NEW;
        END IF;
      END IF;
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native payload source invalidation marker is server-owned';
    END IF;
    IF OLD.payload_source_snapshot_invalidated THEN
      IF owner_kind='memory_record' AND to_jsonb(OLD)->>'created_by_actor_type'='user'
        AND OLD.payload_source_protocol_version=1 AND OLD.payload_source_snapshot IS NOT NULL
        AND NEW.payload_source_snapshot_invalidated=true
        AND NEW.payload_source_snapshot IS NOT DISTINCT FROM OLD.payload_source_snapshot
        AND (to_jsonb(NEW)-ARRAY['source_provenance_qualified','source_run_ids','source_issue_ids','source_project_ids',
          'source_memory_ids','source_foundation_revision_ids','updated_at'])
          =(to_jsonb(OLD)-ARRAY['source_provenance_qualified','source_run_ids','source_issue_ids','source_project_ids',
            'source_memory_ids','source_foundation_revision_ids','updated_at']) THEN
        RETURN NEW;
      END IF;
      IF NEW.payload_source_snapshot IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalidated native payload source snapshot cannot be rebound';
      END IF;
      RETURN NEW;
    END IF;
    IF OLD.payload_source_snapshot IS NOT NULL AND NEW.payload_source_snapshot IS NULL THEN
      NEW.payload_source_snapshot_invalidated := true;
      RETURN NEW;
    END IF;
  END IF;
  snapshot := NEW.payload_source_snapshot;
  IF snapshot IS NULL THEN RETURN NEW; END IF;
  row_data := to_jsonb(NEW);
  IF NEW.payload_source_protocol_version <> 1 OR NEW.payload_source_snapshot_invalidated
      OR jsonb_typeof(snapshot) IS DISTINCT FROM 'object'
      OR snapshot->'version' IS DISTINCT FROM '1'::jsonb
      OR snapshot->'owner'->>'kind' IS DISTINCT FROM owner_kind
      OR snapshot->'owner'->>'companyId' IS DISTINCT FROM NEW.company_id::text
      OR snapshot->'owner'->>'id' IS DISTINCT FROM NEW.id::text
      OR snapshot->'owner'->>'contentHash' IS DISTINCT FROM public.aw_native_payload_body_hash(owner_kind,row_data)
      OR snapshot->>'digest' IS DISTINCT FROM encode(sha256(convert_to((snapshot-'digest')::text,'UTF8')),'hex') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native payload source snapshot does not bind its owner and body';
  END IF;
  IF TG_OP='UPDATE' AND owner_kind='issue' AND OLD.payload_source_snapshot IS NOT NULL
    AND NEW.payload_source_snapshot IS NOT NULL
    AND OLD.payload_source_snapshot_invalidated=false AND NEW.payload_source_snapshot_invalidated=false
    AND public.aw_native_conversation_upload_comment_transition_valid(to_jsonb(OLD),to_jsonb(NEW)) THEN
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' AND OLD.payload_source_snapshot IS NOT NULL THEN
    IF ((snapshot->'inputs') @> (OLD.payload_source_snapshot->'inputs')) IS NOT TRUE
      OR ((snapshot->'policy'->'issueIds') @> (OLD.payload_source_snapshot->'policy'->'issueIds')) IS NOT TRUE
      OR ((snapshot->'policy'->'projectIds') @> (OLD.payload_source_snapshot->'policy'->'projectIds')) IS NOT TRUE
      OR ((snapshot->'policy'->'runIds') @> (OLD.payload_source_snapshot->'policy'->'runIds')) IS NOT TRUE
      OR ((snapshot->'policy'->'memoryIds') @> (OLD.payload_source_snapshot->'policy'->'memoryIds')) IS NOT TRUE
      OR ((snapshot->'policy'->'foundationRevisionIds') @> (OLD.payload_source_snapshot->'policy'->'foundationRevisionIds')) IS NOT TRUE THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native payload source snapshot cannot discard retained inputs';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
