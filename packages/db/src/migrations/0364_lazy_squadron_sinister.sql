ALTER TABLE "work_signal_candidates" ADD COLUMN "target_issue_id" uuid;--> statement-breakpoint
ALTER TABLE "work_signal_candidates" ADD CONSTRAINT "work_signal_candidates_company_id_target_issue_id_issues_company_id_id_fk" FOREIGN KEY ("company_id","target_issue_id") REFERENCES "public"."issues"("company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_work_source_retained(c work_signal_candidates) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT c.invalidated_at IS NULL AND c.expires_at>now() AND c.source_delivery_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM company_memberships m WHERE m.company_id=c.company_id AND m.principal_type='user' AND m.principal_id=c.source_user_id AND m.status='active')
 AND EXISTS(SELECT 1 FROM chat_deliveries d JOIN chat_endpoints e ON e.company_id=d.company_id AND e.id=d.endpoint_id
 JOIN tool_connections t ON t.company_id=e.company_id AND t.id=e.connection_id
 JOIN chat_identity_links l ON l.company_id=d.company_id AND l.endpoint_id=e.id AND l.principal_id=d.principal_id
 WHERE d.company_id=c.company_id AND d.id=c.source_delivery_id AND d.endpoint_id=c.endpoint_id AND d.provider_event_id=c.source_event_key
 AND d.principal_id=c.source_principal_id AND d.state='processed' AND coalesce(d.normalized_event->'filtering'->>'contentRetained','true')<>'false'
 AND e.provider='slack' AND e.status='active' AND t.status='active' AND t.enabled AND l.status='linked' AND l.paperclip_user_id=c.source_user_id
 AND l.revoked_at IS NULL AND (l.expires_at IS NULL OR l.expires_at>now()))
 AND c.source_revision=coalesce((SELECT d.id::text FROM chat_deliveries d WHERE d.company_id=c.company_id AND d.endpoint_id=c.endpoint_id
 AND d.normalized_event->'message'->>'targetProviderEventId'=c.source_event_key ORDER BY d.created_at DESC,d.id DESC LIMIT 1),'original')
 AND NOT EXISTS(SELECT 1 FROM chat_deliveries d WHERE d.company_id=c.company_id AND d.endpoint_id=c.endpoint_id AND d.id::text=c.source_revision AND d.event_kind IN ('message_deleted','message_restored'))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_work_candidate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'work_signal_lineage_requires_retained_tombstone' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (NEW.company_id,NEW.id,NEW.issue_id,NEW.endpoint_id,NEW.source_event_key,NEW.source_principal_id,NEW.source_user_id,NEW.source_channel,NEW.source_message_id,NEW.source_hash,NEW.source_revision,NEW.run_id,NEW.read_invocation_id,NEW.signal_type,NEW.sensitivity,NEW.confidence,NEW.purpose,NEW.expires_at)
   IS DISTINCT FROM (OLD.company_id,OLD.id,OLD.issue_id,OLD.endpoint_id,OLD.source_event_key,OLD.source_principal_id,OLD.source_user_id,OLD.source_channel,OLD.source_message_id,OLD.source_hash,OLD.source_revision,OLD.run_id,OLD.read_invocation_id,OLD.signal_type,OLD.sensitivity,OLD.confidence,OLD.purpose,OLD.expires_at)
   OR NEW.version<OLD.version OR (OLD.proposal_id IS NOT NULL AND NEW.proposal_id IS DISTINCT FROM OLD.proposal_id)
   OR (OLD.target_issue_id IS NOT NULL AND NEW.target_issue_id IS DISTINCT FROM OLD.target_issue_id)
   OR (NEW.source_delivery_id IS DISTINCT FROM OLD.source_delivery_id AND NEW.source_delivery_id IS NOT NULL)
   THEN RAISE EXCEPTION 'work_signal_origin_is_immutable' USING ERRCODE='23514'; END IF;
  IF NEW.facts IS NOT NULL AND NEW.facts IS DISTINCT FROM OLD.facts THEN RAISE EXCEPTION 'work_signal_facts_are_immutable' USING ERRCODE='23514'; END IF;
  IF OLD.invalidated_at IS NOT NULL THEN NEW.invalidated_at:=OLD.invalidated_at; END IF;
 END IF;
 IF NEW.signal_type NOT IN ('commitment','completion_claim','blocker','deadline_change','owner_change','decision','approval_request','risk','project_update','new_task','correction') OR NEW.sensitivity NOT IN ('internal','restricted') OR NEW.confidence NOT IN ('explicit','uncertain') THEN RAISE EXCEPTION 'work_signal_invalid_classification' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NOT aw_v7_work_source_retained(NEW) OR NOT EXISTS(SELECT 1 FROM tool_invocations i JOIN heartbeat_runs r ON r.company_id=i.company_id AND r.id=i.run_id
    WHERE i.company_id=NEW.company_id AND i.id=NEW.read_invocation_id AND i.issue_id=NEW.issue_id AND i.run_id=NEW.run_id AND i.status='succeeded'
    AND (i.tool_name LIKE '%slack_message' OR i.upstream_tool_name='slack_message') AND r.native_issue_id=NEW.issue_id AND r.responsible_user_id=NEW.source_user_id AND r.status='running')
   THEN RAISE EXCEPTION 'work_signal_requires_current_native_source_receipt' USING ERRCODE='23514'; END IF;
 ELSIF NEW.invalidated_at IS NOT NULL OR NOT aw_v7_work_source_retained(NEW) THEN
  NEW.facts:=NULL; NEW.status:='invalidated'; NEW.invalidated_at:=coalesce(NEW.invalidated_at,now()); NEW.version:=greatest(NEW.version,OLD.version+1);
 END IF;
 IF NEW.proposal_id IS NOT NULL AND NEW.invalidated_at IS NULL AND NOT EXISTS(SELECT 1 FROM project_roadmap_proposals p
  WHERE p.company_id=NEW.company_id AND p.id=NEW.proposal_id AND p.created_by_user_id=NEW.source_user_id AND NEW.signal_type='deadline_change' AND NEW.sensitivity='internal' AND NEW.confidence='explicit'
  AND jsonb_array_length(p.patch_json->'changes')=1 AND p.patch_json->'changes'->0->>'issueId'=NEW.target_issue_id::text)
 THEN RAISE EXCEPTION 'work_signal_requires_human_native_proposal' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_work_candidate_guard BEFORE INSERT OR UPDATE OR DELETE ON work_signal_candidates FOR EACH ROW EXECUTE FUNCTION aw_v7_work_candidate_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_work_invalidation_effects() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.invalidated_at IS NOT NULL THEN
  UPDATE project_roadmap_proposals SET status='stale',patch_json=jsonb_set(jsonb_set(patch_json,'{changes}','[]'::jsonb),'{evidence}','[]'::jsonb),reason='The coordination source was withdrawn.',updated_at=now()
   WHERE company_id=NEW.company_id AND id=NEW.proposal_id AND status='pending';
  UPDATE issue_thread_interactions SET status='withdrawn',updated_at=now() WHERE company_id=NEW.company_id AND id=NEW.interaction_id AND status='pending';
 END IF;
 IF NEW.status='ignored' THEN UPDATE issue_thread_interactions SET status='withdrawn',updated_at=now() WHERE company_id=NEW.company_id AND id=NEW.interaction_id AND status='pending'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_work_invalidation_effects AFTER UPDATE ON work_signal_candidates FOR EACH ROW EXECUTE FUNCTION aw_v7_work_invalidation_effects();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_work_delivery_invalidation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  UPDATE work_signal_candidates SET source_delivery_id=NULL,facts=NULL,status='invalidated',invalidated_at=coalesce(invalidated_at,now()),updated_at=now() WHERE company_id=OLD.company_id AND source_delivery_id=OLD.id;
  RETURN OLD;
 END IF;
 IF NEW.event_kind IN ('message_updated','message_deleted','message_restored') THEN
  UPDATE work_signal_candidates SET facts=NULL,status='invalidated',invalidated_at=coalesce(invalidated_at,now()),updated_at=now()
   WHERE company_id=NEW.company_id AND endpoint_id=NEW.endpoint_id AND source_event_key=NEW.normalized_event->'message'->>'targetProviderEventId' AND invalidated_at IS NULL;
 END IF;
 IF TG_OP='UPDATE' AND (NEW.normalized_event->'message'->>'text' IS DISTINCT FROM OLD.normalized_event->'message'->>'text' OR NEW.normalized_event->'filtering'->>'contentRetained'='false') THEN
  UPDATE work_signal_candidates SET facts=NULL,status='invalidated',invalidated_at=coalesce(invalidated_at,now()),updated_at=now() WHERE company_id=NEW.company_id AND source_delivery_id=NEW.id AND invalidated_at IS NULL;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_work_delivery_invalidation AFTER INSERT OR UPDATE OF normalized_event ON chat_deliveries FOR EACH ROW EXECUTE FUNCTION aw_v7_work_delivery_invalidation();
--> statement-breakpoint
CREATE TRIGGER aw_v7_work_delivery_delete BEFORE DELETE ON chat_deliveries FOR EACH ROW EXECUTE FUNCTION aw_v7_work_delivery_invalidation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_work_identity_invalidation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='chat_identity_links' THEN
  UPDATE work_signal_candidates c SET facts=NULL,status='invalidated',invalidated_at=coalesce(c.invalidated_at,now()),updated_at=now()
   WHERE c.company_id=NEW.company_id AND c.endpoint_id=NEW.endpoint_id AND c.source_principal_id=NEW.principal_id AND c.invalidated_at IS NULL AND NOT aw_v7_work_source_retained(c);
 ELSIF TG_TABLE_NAME='chat_endpoints' THEN
  UPDATE work_signal_candidates c SET facts=NULL,status='invalidated',invalidated_at=coalesce(c.invalidated_at,now()),updated_at=now() WHERE c.company_id=NEW.company_id AND c.endpoint_id=NEW.id AND c.invalidated_at IS NULL AND NOT aw_v7_work_source_retained(c);
 ELSE
  UPDATE work_signal_candidates c SET facts=NULL,status='invalidated',invalidated_at=coalesce(c.invalidated_at,now()),updated_at=now() WHERE c.company_id=NEW.company_id AND c.endpoint_id IN (SELECT id FROM chat_endpoints WHERE company_id=NEW.company_id AND connection_id=NEW.id) AND c.invalidated_at IS NULL AND NOT aw_v7_work_source_retained(c);
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_work_identity_invalidation AFTER UPDATE ON chat_identity_links FOR EACH ROW EXECUTE FUNCTION aw_v7_work_identity_invalidation();
--> statement-breakpoint
CREATE TRIGGER aw_v7_work_endpoint_invalidation AFTER UPDATE ON chat_endpoints FOR EACH ROW EXECUTE FUNCTION aw_v7_work_identity_invalidation();
--> statement-breakpoint
CREATE TRIGGER aw_v7_work_connection_invalidation AFTER UPDATE ON tool_connections FOR EACH ROW EXECUTE FUNCTION aw_v7_work_identity_invalidation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_work_proposal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source work_signal_candidates; flags jsonb;
BEGIN
 SELECT * INTO source FROM work_signal_candidates WHERE company_id=NEW.company_id AND proposal_id=NEW.id LIMIT 1;
 IF FOUND THEN
  IF NEW.status='accepted' AND OLD.status<>'accepted' THEN
   SELECT experimental INTO flags FROM instance_settings WHERE singleton_key='default';
   IF source.status<>'proposed' OR NOT aw_v7_work_source_retained(source) OR coalesce(flags->>'work_signals_v7','false')<>'true' OR coalesce(flags->>'enableChatConnectors','false')<>'true'
    THEN RAISE EXCEPTION 'work_signal_proposal_source_is_not_current' USING ERRCODE='23514'; END IF;
  ELSIF source.invalidated_at IS NOT NULL AND NEW.status<>'accepted' THEN
   NEW.status:='stale'; NEW.patch_json:=jsonb_set(jsonb_set(NEW.patch_json,'{changes}','[]'::jsonb),'{evidence}','[]'::jsonb); NEW.reason:='The coordination source was withdrawn.';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_work_proposal_guard BEFORE UPDATE ON project_roadmap_proposals FOR EACH ROW EXECUTE FUNCTION aw_v7_work_proposal_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_work_followup_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source work_signal_candidates;
BEGIN
 IF NEW.idempotency_key LIKE 'v7-work-signal:%' THEN
  SELECT * INTO source FROM work_signal_candidates WHERE company_id=NEW.company_id AND id::text=substring(NEW.idempotency_key from 16);
  IF NOT FOUND OR source.issue_id<>NEW.issue_id OR NEW.created_by_user_id IS DISTINCT FROM source.source_user_id OR NEW.addressee_user_id IS DISTINCT FROM source.source_user_id
    OR NEW.kind<>'request_confirmation' OR NEW.continuation_policy<>'none' OR NEW.requested_resolver_policy<>'human_only'
   THEN RAISE EXCEPTION 'work_signal_followup_requires_original_human_scope' USING ERRCODE='23514'; END IF;
  IF source.status<>'review_requested' OR NOT aw_v7_work_source_retained(source) THEN
   NEW.status:='withdrawn'; NEW.result:=NULL; NEW.title:='Coordination source withdrawn'; NEW.summary:='This source is no longer current.';
   NEW.payload:='{"version":1,"allowDeclineReason":true,"prompt":"The original coordination source was withdrawn."}'::jsonb;
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_work_followup_guard BEFORE INSERT OR UPDATE ON issue_thread_interactions FOR EACH ROW EXECUTE FUNCTION aw_v7_work_followup_guard();
