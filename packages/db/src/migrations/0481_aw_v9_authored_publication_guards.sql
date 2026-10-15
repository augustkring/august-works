-- A later Original revision's before/after snapshot is an actual Source copy.
-- Only the exact existing privacy tombstone permits replacing that snapshot
-- with IDs; all other immutable revision changes stay forbidden.
CREATE FUNCTION aw_agent_authored_snapshot_erasure_allowed(company uuid, prior jsonb, next jsonb)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT next=prior OR (
  next=jsonb_build_object('payloadDeleted',true,'revisionId',prior #>> '{runtimeConfig,agentDefinitionVersion,revisionId}')
  AND EXISTS(SELECT 1 FROM memory_deletion_markers m WHERE m.company_id=company AND m.kind='source'
    AND m.key='agent-authored-revision-erasure:v1:'||(prior #>> '{runtimeConfig,agentDefinitionVersion,revisionId}'))
  AND NOT EXISTS(SELECT 1 FROM agents a WHERE a.company_id=company
    AND a.runtime_config #>> '{agentDefinitionVersion,revisionId}'=prior #>> '{runtimeConfig,agentDefinitionVersion,revisionId}')
 );
$$;
--> statement-breakpoint
-- The Original configuration revision is the identified version owner.
CREATE FUNCTION aw_agent_authored_revision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (OLD.source='agent_authoring_publish' OR NEW.source='agent_authoring_publish') AND
   ((NEW.id,NEW.company_id,NEW.agent_id,NEW.source,NEW.changed_keys,
     NEW.rolled_back_from_revision_id,NEW.created_by_user_id,NEW.created_at) IS DISTINCT FROM
   (OLD.id,OLD.company_id,OLD.agent_id,OLD.source,OLD.changed_keys,
     OLD.rolled_back_from_revision_id,OLD.created_by_user_id,OLD.created_at)
   OR NOT aw_agent_authored_snapshot_erasure_allowed(OLD.company_id,OLD.before_config,NEW.before_config)
   OR NOT aw_agent_authored_snapshot_erasure_allowed(OLD.company_id,OLD.after_config,NEW.after_config)) THEN
  RAISE EXCEPTION 'agent_authored_revision_immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_agent_authored_revision_immutable BEFORE UPDATE ON agent_config_revisions
 FOR EACH ROW EXECUTE FUNCTION aw_agent_authored_revision_immutable();
--> statement-breakpoint
-- Restore and import use the same Original owner. An erased identity must not
-- resurrect its content or be reused for an unrelated publication.
CREATE FUNCTION aw_agent_authored_revision_restore_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM memory_deletion_markers m WHERE m.kind='source' AND (
   m.key='agent-authored-revision-erasure:v1:'||NEW.id::text
   OR (m.company_id=NEW.company_id AND m.key IN (
     'agent-authored-revision-erasure:v1:'||(NEW.before_config #>> '{runtimeConfig,agentDefinitionVersion,revisionId}'),
     'agent-authored-revision-erasure:v1:'||(NEW.after_config #>> '{runtimeConfig,agentDefinitionVersion,revisionId}')
   )))) THEN
  RAISE EXCEPTION 'agent_authored_revision_erased' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_agent_authored_revision_restore_guard BEFORE INSERT ON agent_config_revisions
 FOR EACH ROW EXECUTE FUNCTION aw_agent_authored_revision_restore_guard();
--> statement-breakpoint
CREATE FUNCTION aw_agent_authored_version_current() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE definition jsonb; prior jsonb; recorded jsonb;
BEGIN
 definition=NEW.runtime_config->'agentDefinitionVersion';
 IF TG_OP='UPDATE' THEN prior=OLD.runtime_config->'agentDefinitionVersion'; END IF;
 IF NOT (NEW.runtime_config ? 'agentDefinitionVersion') THEN
  IF prior IS NOT NULL THEN RAISE EXCEPTION 'agent_authored_version_readonly' USING ERRCODE='23514'; END IF;
  RETURN NULL;
 END IF;
 IF jsonb_typeof(definition) IS DISTINCT FROM 'object' OR definition->>'schema' IS DISTINCT FROM 'paperclip.agent-authored-definition.v1'
   OR NOT coalesce(definition->>'revisionId','') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
  RAISE EXCEPTION 'agent_authored_version_invalid' USING ERRCODE='23514';
 END IF;
 SELECT after_config INTO recorded FROM agent_config_revisions WHERE company_id=NEW.company_id AND agent_id=NEW.id
   AND id=(definition->>'revisionId')::uuid AND source='agent_authoring_publish';
 IF recorded IS NULL OR recorded #> '{runtimeConfig,agentDefinitionVersion}' IS DISTINCT FROM definition THEN
  RAISE EXCEPTION 'agent_authored_revision_unavailable' USING ERRCODE='23514';
 END IF;
 IF prior IS NOT NULL AND prior=definition AND
   (NEW.name,NEW.role,NEW.title,NEW.capabilities,NEW.reports_to,NEW.adapter_type,NEW.adapter_config,NEW.runtime_config) IS DISTINCT FROM
   (OLD.name,OLD.role,OLD.title,OLD.capabilities,OLD.reports_to,OLD.adapter_type,OLD.adapter_config,OLD.runtime_config) THEN
  RAISE EXCEPTION 'agent_authored_version_readonly' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND NEW.permissions IS DISTINCT FROM OLD.permissions
   AND NOT (NEW.status='terminated' AND NEW.permissions='{}'::jsonb) THEN
  RAISE EXCEPTION 'agent_authored_permissions_readonly' USING ERRCODE='23514';
 END IF;
 IF definition ? 'publication' AND (TG_OP='INSERT' OR definition IS DISTINCT FROM prior) THEN
  IF NOT coalesce(definition->>'version','') ~ '^[1-9][0-9]{0,8}$'
    OR (definition->>'version')::bigint<>coalesce((prior->>'version')::bigint,0)+1
    OR definition #>> '{publication,priorRevisionId}' IS DISTINCT FROM prior->>'revisionId'
    OR definition #>> '{content,name}' IS DISTINCT FROM NEW.name
    OR definition #>> '{content,description}' IS DISTINCT FROM NEW.capabilities THEN
   RAISE EXCEPTION 'agent_authored_publication_conflict' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER aw_agent_authored_version_current AFTER INSERT OR UPDATE ON agents
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aw_agent_authored_version_current();

--> statement-breakpoint
CREATE FUNCTION aw_agent_authored_source_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE execution uuid;
BEGIN
 IF OLD.source<>'agent_authoring_publish' THEN RETURN OLD; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('business-events:'||OLD.company_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('memory:privacy:'||OLD.company_id::text,0));
 IF EXISTS(SELECT 1 FROM agents WHERE company_id=OLD.company_id AND id=OLD.agent_id
   AND runtime_config #>> '{agentDefinitionVersion,revisionId}'=OLD.id::text) THEN
  RAISE EXCEPTION 'agent_authored_active_revision_readonly' USING ERRCODE='23514';
 END IF;
 INSERT INTO memory_deletion_markers(company_id,key,kind)
  VALUES(OLD.company_id,'agent-authored-revision-erasure:v1:'||OLD.id::text,'source') ON CONFLICT DO NOTHING;
 UPDATE agent_config_revisions SET
  before_config=CASE WHEN before_config #>> '{runtimeConfig,agentDefinitionVersion,revisionId}'=OLD.id::text
    THEN jsonb_build_object('payloadDeleted',true,'revisionId',OLD.id::text) ELSE before_config END,
  after_config=CASE WHEN after_config #>> '{runtimeConfig,agentDefinitionVersion,revisionId}'=OLD.id::text
    THEN jsonb_build_object('payloadDeleted',true,'revisionId',OLD.id::text) ELSE after_config END
  WHERE company_id=OLD.company_id AND id<>OLD.id AND (
    before_config #>> '{runtimeConfig,agentDefinitionVersion,revisionId}'=OLD.id::text
    OR after_config #>> '{runtimeConfig,agentDefinitionVersion,revisionId}'=OLD.id::text);
 FOR execution IN
  SELECT h.id FROM heartbeat_runs h WHERE h.company_id=OLD.company_id AND h.agent_id=OLD.agent_id
   AND h.context_snapshot #>> '{agentDefinitionVersion,revisionId}'=OLD.id::text
  UNION SELECT e.run_id FROM agent_execution_manifests e WHERE e.company_id=OLD.company_id AND e.agent_id=OLD.agent_id
   AND e.manifest #>> '{agentDefinitionVersion,revisionId}'=OLD.id::text
 LOOP
  INSERT INTO memory_deletion_markers(company_id,key,kind)
   VALUES(OLD.company_id,'native-runtime-source-version-erasure:v1:'||execution::text||':'||OLD.id::text,'source') ON CONFLICT DO NOTHING;
  INSERT INTO memory_jobs(company_id,operation_type,job_key,source_ref_json)
   VALUES(OLD.company_id,'retention','authored-definition-source-erasure:v1:'||execution::text||':'||OLD.id::text,
    jsonb_build_object('kind','authored_definition_source_erasure','runId',execution::text,'revisionId',OLD.id::text)) ON CONFLICT DO NOTHING;
 END LOOP;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER aaa_agent_authored_source_erasure BEFORE DELETE ON agent_config_revisions
 FOR EACH ROW EXECUTE FUNCTION aw_agent_authored_source_erasure();
