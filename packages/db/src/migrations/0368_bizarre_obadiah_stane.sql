CREATE TABLE "ai_use_case_change_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"use_case_id" uuid NOT NULL,
	"purpose_version" integer NOT NULL,
	"classification" text NOT NULL,
	"reason_code" text NOT NULL,
	"source_ref_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_use_case_change_events" ADD CONSTRAINT "ai_use_case_change_events_company_id_use_case_id_purpose_version_ai_use_case_versions_company_id_use_case_id_purpose_version_fk" FOREIGN KEY ("company_id","use_case_id","purpose_version") REFERENCES "public"."ai_use_case_versions"("company_id","use_case_id","purpose_version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_use_case_change_event_idx" ON "ai_use_case_change_events" USING btree ("company_id","use_case_id","created_at");--> statement-breakpoint
CREATE FUNCTION aw_v7_governance_obligations_current(c uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(SELECT 1 FROM governance_obligations g WHERE g.company_id=c AND (g.next_review_at<=now() OR g.obligation->>'applicabilityState' IN ('uncertain','review_required')) AND NOT EXISTS(SELECT 1 FROM governance_obligations n WHERE n.company_id=g.company_id AND n.obligation->>'framework'=g.obligation->>'framework' AND n.obligation->>'authority'=g.obligation->>'authority' AND n.obligation->>'citation'=g.obligation->>'citation' AND n.obligation->>'jurisdictionOrScope'=g.obligation->>'jurisdictionOrScope' AND (n.created_at,n.id)>(g.created_at,g.id)));
$$;
--> statement-breakpoint
CREATE FUNCTION aw_v7_governance_deployment_current(d ai_use_case_deployments) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT d.status='active' AND EXISTS(SELECT 1 FROM ai_use_cases c JOIN ai_use_case_versions v ON v.company_id=c.company_id AND v.use_case_id=c.id AND v.purpose_version=c.purpose_version JOIN human_oversight_profiles o ON o.company_id=v.company_id AND o.id=v.oversight_profile_id JOIN issues i ON i.company_id=d.company_id AND i.id=d.issue_id JOIN agents a ON a.company_id=d.company_id AND a.id=d.agent_id
 WHERE c.company_id=d.company_id AND c.id=d.use_case_id AND c.status='approved' AND c.purpose_version=d.purpose_version AND c.next_review_at>now() AND v.purpose_hash=d.purpose_hash AND o.status='active' AND o.profile_hash=v.oversight_profile_hash AND i.hidden_at IS NULL AND i.assignee_agent_id=d.agent_id AND a.status<>'terminated'
 AND (v.purpose->>'riskClass' IN ('C0','C1') OR EXISTS(SELECT 1 FROM orchestration_plans p WHERE p.company_id=d.company_id AND (p.issue_id=d.issue_id OR EXISTS(SELECT 1 FROM orchestration_workers w WHERE w.company_id=p.company_id AND w.plan_id=p.id AND w.issue_id=d.issue_id)) AND substring(p.risk_class from 2)::int>=substring(v.purpose->>'riskClass' from 2)::int AND p.verification_mode='independent_required' AND (v.purpose->>'riskClass'<>'C3' OR p.human_oversight_mode='required')))
 AND v.purpose->>'peopleDomain'='none' AND v.purpose->>'riskClass'<>'C4' AND v.purpose->>'makesRecommendationsAboutPeople'='false' AND v.purpose->>'makesDecisionsAboutPeople'='false' AND v.purpose->>'materialLegalOrSimilarEffect'='false')
 AND aw_v7_governance_obligations_current(d.company_id)
 AND EXISTS(SELECT 1 FROM company_memberships m WHERE m.company_id=d.company_id AND m.principal_type='user' AND m.principal_id=d.created_by_user_id AND m.status='active');
$$;
--> statement-breakpoint
CREATE FUNCTION aw_v7_governance_fence_deployment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO governance_stop_actions(company_id,deployment_id,run_id)
  SELECT NEW.company_id,NEW.id,r.id FROM heartbeat_runs r
  WHERE r.company_id=NEW.company_id AND (r.native_issue_id=NEW.issue_id OR (r.native_issue_id IS NULL AND r.context_snapshot->>'issueId'=NEW.issue_id::text)) AND r.agent_id=NEW.agent_id AND r.status IN ('running','queued')
  AND (NOT aw_v7_governance_deployment_current(NEW) OR r.context_snapshot->>'governanceDeploymentId' IS DISTINCT FROM NEW.id::text)
  ON CONFLICT(company_id,run_id) DO NOTHING;
 UPDATE heartbeat_runs SET result_json=coalesce(result_json,'{}'::jsonb)||jsonb_build_object('executionCancellation',jsonb_build_object('state','requested','reason','governance_changed','governanceDeploymentId',NEW.id,'requestedAt',now()))
  WHERE company_id=NEW.company_id AND (native_issue_id=NEW.issue_id OR (native_issue_id IS NULL AND context_snapshot->>'issueId'=NEW.issue_id::text)) AND agent_id=NEW.agent_id AND status IN ('running','queued')
  AND (NOT aw_v7_governance_deployment_current(NEW) OR context_snapshot->>'governanceDeploymentId' IS DISTINCT FROM NEW.id::text);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_governance_fence_deployment AFTER INSERT OR UPDATE ON ai_use_case_deployments FOR EACH ROW EXECUTE FUNCTION aw_v7_governance_fence_deployment();
--> statement-breakpoint
CREATE FUNCTION aw_v7_governance_case_invalidation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status<>'approved' OR NEW.purpose_version<>OLD.purpose_version OR NEW.next_review_at<=now() THEN
  UPDATE ai_use_case_deployments SET status=CASE WHEN NEW.status IN ('suspended','retired') THEN 'suspended' ELSE 'review_required' END,updated_at=now() WHERE company_id=NEW.company_id AND use_case_id=NEW.id AND status='active';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_governance_case_invalidation AFTER UPDATE ON ai_use_cases FOR EACH ROW EXECUTE FUNCTION aw_v7_governance_case_invalidation();
--> statement-breakpoint
CREATE FUNCTION aw_v7_governance_immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'governance_versioned_evidence_immutable' USING ERRCODE='23514'; END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_governance_purpose_immutable BEFORE UPDATE OR DELETE ON ai_use_case_versions FOR EACH ROW EXECUTE FUNCTION aw_v7_governance_immutable_record();
--> statement-breakpoint
CREATE TRIGGER aw_v7_governance_assessment_immutable BEFORE UPDATE OR DELETE ON ai_use_case_assessments FOR EACH ROW EXECUTE FUNCTION aw_v7_governance_immutable_record();
--> statement-breakpoint
CREATE TRIGGER aw_v7_governance_change_immutable BEFORE UPDATE OR DELETE ON ai_use_case_change_events FOR EACH ROW EXECUTE FUNCTION aw_v7_governance_immutable_record();
--> statement-breakpoint
CREATE FUNCTION aw_v7_governance_deployment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'governance_deployment_tombstone_required' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.company_id,NEW.use_case_id,NEW.purpose_version,NEW.issue_id,NEW.agent_id,NEW.purpose_hash,NEW.authority_hash,NEW.created_by_user_id,NEW.created_at) IS DISTINCT FROM (OLD.company_id,OLD.use_case_id,OLD.purpose_version,OLD.issue_id,OLD.agent_id,OLD.purpose_hash,OLD.authority_hash,OLD.created_by_user_id,OLD.created_at) THEN RAISE EXCEPTION 'governance_deployment_scope_immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD.status IN ('review_required','suspended','retired') AND NEW.status='active' THEN RAISE EXCEPTION 'governance_deployment_requires_fresh_binding' USING ERRCODE='23514'; END IF;
 IF NEW.status='active' AND (NOT aw_v7_governance_deployment_current(NEW) OR NOT EXISTS(SELECT 1 FROM instance_settings WHERE singleton_key='default' AND experimental->>'ai_use_cases_v7'='true')) THEN RAISE EXCEPTION 'governance_current_approved_purpose_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_governance_deployment_guard BEFORE INSERT OR UPDATE OR DELETE ON ai_use_case_deployments FOR EACH ROW EXECUTE FUNCTION aw_v7_governance_deployment_guard();
--> statement-breakpoint
CREATE FUNCTION aw_v7_governance_run_admission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE deployment uuid; prior_pin text;
BEGIN
 IF TG_OP='UPDATE' THEN
  prior_pin := OLD.context_snapshot->>'governanceDeploymentId';
  IF prior_pin IS NULL AND NEW.context_snapshot->>'governanceDeploymentId' IS NOT NULL THEN RAISE EXCEPTION 'governance_run_cannot_adopt_late_purpose' USING ERRCODE='23514'; END IF;
  IF prior_pin IS NOT NULL THEN
   IF (NEW.company_id,NEW.agent_id,NEW.native_issue_id) IS DISTINCT FROM (OLD.company_id,OLD.agent_id,OLD.native_issue_id)
    OR (NEW.context_snapshot->>'governanceDeploymentId' IS NOT NULL AND NEW.context_snapshot->>'governanceDeploymentId'<>prior_pin)
   THEN RAISE EXCEPTION 'governance_run_purpose_pin_immutable' USING ERRCODE='23514'; END IF;
   NEW.context_snapshot := coalesce(NEW.context_snapshot,'{}'::jsonb)||jsonb_build_object('governanceDeploymentId',prior_pin);
  END IF;
 END IF;
 IF NEW.status IN ('running','queued','scheduled_retry') AND (TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status)
 AND EXISTS(SELECT 1 FROM ai_use_case_deployments d WHERE d.company_id=NEW.company_id AND d.issue_id=NEW.native_issue_id) THEN
  SELECT d.id INTO deployment FROM ai_use_case_deployments d WHERE d.company_id=NEW.company_id AND d.issue_id=NEW.native_issue_id AND d.agent_id=NEW.agent_id AND aw_v7_governance_deployment_current(d);
  IF deployment IS NULL OR (TG_OP='UPDATE' AND prior_pin IS DISTINCT FROM deployment::text)
   THEN RAISE EXCEPTION 'governance_run_admission_closed' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' AND NEW.retry_of_run_id IS NOT NULL AND EXISTS(SELECT 1 FROM heartbeat_runs r WHERE r.company_id=NEW.company_id AND r.id=NEW.retry_of_run_id AND r.context_snapshot->>'governanceDeploymentId' IS DISTINCT FROM deployment::text)
   THEN RAISE EXCEPTION 'governance_retry_cannot_adopt_changed_purpose' USING ERRCODE='23514'; END IF;
  NEW.context_snapshot := coalesce(NEW.context_snapshot,'{}'::jsonb)||jsonb_build_object('governanceDeploymentId',deployment::text);
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_governance_run_admission BEFORE INSERT OR UPDATE ON heartbeat_runs FOR EACH ROW EXECUTE FUNCTION aw_v7_governance_run_admission();
--> statement-breakpoint
CREATE FUNCTION aw_v7_governance_authority_hash(c uuid,t uuid,a uuid,u text) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object(
  'task',jsonb_build_object('projectId',i.project_id,'parentId',i.parent_id,'assigneeAgentId',i.assignee_agent_id),
  'agent',jsonb_build_object('adapterType',ag.adapter_type,'adapterConfig',ag.adapter_config,'runtimeConfig',ag.runtime_config,'permissions',ag.permissions),
  'runtime',coalesce((SELECT jsonb_build_object('binding',r.provider_binding_id,'profile',r.provider_profile_ref,'status',r.status,'configuration',r.qualified_configuration_hash,'conformance',r.conformance_snapshot_hash,'snapshot',p.capability_snapshot_hash,'providerStatus',p.status) FROM agent_presence_runtime_bindings r JOIN agent_provider_bindings p ON p.id=r.provider_binding_id WHERE r.company_id=c AND r.agent_id=a),'{}'::jsonb),
  'managedRuntime',coalesce((SELECT jsonb_build_object('generation',rc.generation::text,'modelProvider',rc.model_provider,'modelId',rc.model_id,'secretRef',rc.model_secret_ref,'secretVersion',rc.model_secret_version,'desiredImage',rc.desired_image_digest,'activeImage',rc.active_image_digest,'sandboxBackend',sb.backend,'profile',sb.profile,'boundary',sb.boundary_policy_hash,'controls',sb.capability_snapshot-'testedAt'-'expiresAt'-'qualificationHash') FROM runtime_cells rc LEFT JOIN runtime_sandbox_bindings sb ON sb.company_id=rc.company_id AND sb.runtime_cell_id=rc.id AND sb.cell_generation=rc.generation::text WHERE rc.company_id=c AND rc.provider_binding_id=(SELECT r.provider_binding_id FROM agent_presence_runtime_bindings r WHERE r.company_id=c AND r.agent_id=a) LIMIT 1),'{}'::jsonb),
  -- Authority pointers only: never materialize private document/skill bodies.
  'foundation',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'revision',f.approved_revision_id,'authority',f.authority_level,'status',f.status,'validFrom',f.valid_from,'validUntil',f.valid_until) ORDER BY f.id) FROM foundation_documents f WHERE f.company_id=c AND f.authority_level='canonical'),'[]'::jsonb),
  'skills',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'current',s.current_version_id,'active',s.active_version_id,'state',s.lifecycle_state,'sharing',s.sharing_scope) ORDER BY s.id) FROM company_skills s WHERE s.company_id=c AND (s.owner_agent_id IS NULL OR s.owner_agent_id=a)),'[]'::jsonb),
  'playbooks',coalesce((SELECT jsonb_agg(jsonb_build_object('id',b.id,'revision',b.approved_revision_id,'status',b.status) ORDER BY b.id) FROM playbook_documents b WHERE b.company_id=c AND (b.owner_agent_id IS NULL OR b.owner_agent_id=a)),'[]'::jsonb),
  -- Organization overlays conservatively invalidate company deployments until reviewed.
  'rolePacks',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'scope',r.scope_id,'policy',r.version_policy,'version',coalesce(r.pinned_version_id,p.published_version_id),'status',p.status) ORDER BY r.id) FROM agent_role_pack_assignments r JOIN role_packs p ON p.company_id=r.company_id AND p.id=r.role_pack_id WHERE r.company_id=c AND (r.scope_type<>'agent' OR r.scope_id=a)),'[]'::jsonb),
  'connections',coalesce((SELECT jsonb_agg(jsonb_build_object('id',g.id,'connection',g.connection_id,'status',g.status,'enabled',x.enabled,'connectionStatus',x.status,'configHash',encode(sha256(convert_to(x.config::text,'UTF8')),'hex')) ORDER BY g.id) FROM connection_grants g JOIN tool_connections x ON x.company_id=g.company_id AND x.id=g.connection_id WHERE g.company_id=c AND (g.subject_agent_id=a OR g.subject_user_id=u)),'[]'::jsonb),
  'obligations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',o.id,'hash',o.obligation_hash,'nextReview',o.next_review_at) ORDER BY o.id) FROM governance_obligations o WHERE o.company_id=c),'[]'::jsonb),
  'grants',coalesce((SELECT jsonb_agg(jsonb_build_object('id',g.id,'principal',g.principal_id,'permission',g.permission_key,'scope',g.scope) ORDER BY g.id) FROM principal_permission_grants g WHERE g.company_id=c AND g.principal_id IN (a::text,u)),'[]'::jsonb)
 )::text,'UTF8')),'hex') FROM issues i JOIN agents ag ON ag.company_id=c AND ag.id=a WHERE i.company_id=c AND i.id=t;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_v7_governance_deployment_current(d ai_use_case_deployments) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT d.status='active' AND d.authority_hash=aw_v7_governance_authority_hash(d.company_id,d.issue_id,d.agent_id,d.created_by_user_id)
 AND EXISTS(SELECT 1 FROM instance_settings WHERE singleton_key='default' AND experimental->>'ai_use_cases_v7'='true')
 AND EXISTS(SELECT 1 FROM ai_use_cases c JOIN ai_use_case_versions v ON v.company_id=c.company_id AND v.use_case_id=c.id AND v.purpose_version=c.purpose_version JOIN human_oversight_profiles o ON o.company_id=v.company_id AND o.id=v.oversight_profile_id JOIN issues i ON i.company_id=d.company_id AND i.id=d.issue_id JOIN agents a ON a.company_id=d.company_id AND a.id=d.agent_id
 WHERE c.company_id=d.company_id AND c.id=d.use_case_id AND c.status='approved' AND c.purpose_version=d.purpose_version AND c.next_review_at>now() AND v.purpose_hash=d.purpose_hash AND o.status='active' AND o.profile_hash=v.oversight_profile_hash AND i.hidden_at IS NULL AND i.assignee_agent_id=d.agent_id AND a.status<>'terminated'
 AND (v.purpose->>'riskClass' IN ('C0','C1') OR EXISTS(SELECT 1 FROM orchestration_plans p WHERE p.company_id=d.company_id AND (p.issue_id=d.issue_id OR EXISTS(SELECT 1 FROM orchestration_workers w WHERE w.company_id=p.company_id AND w.plan_id=p.id AND w.issue_id=d.issue_id)) AND substring(p.risk_class from 2)::int>=substring(v.purpose->>'riskClass' from 2)::int AND p.verification_mode='independent_required' AND (v.purpose->>'riskClass'<>'C3' OR p.human_oversight_mode='required')))
 AND v.purpose->>'peopleDomain'='none' AND v.purpose->>'riskClass'<>'C4' AND v.purpose->>'makesRecommendationsAboutPeople'='false' AND v.purpose->>'makesDecisionsAboutPeople'='false' AND v.purpose->>'materialLegalOrSimilarEffect'='false')
 AND aw_v7_governance_obligations_current(d.company_id)
 AND EXISTS(SELECT 1 FROM company_memberships m WHERE m.company_id=d.company_id AND m.principal_type='user' AND m.principal_id=d.created_by_user_id AND m.status='active');
$$;
--> statement-breakpoint
CREATE FUNCTION aw_v7_governance_case_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v ai_use_case_versions; o human_oversight_profiles;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.company_id,NEW.key,NEW.owner_user_id,NEW.created_at) IS DISTINCT FROM (OLD.company_id,OLD.key,OLD.owner_user_id,OLD.created_at) THEN RAISE EXCEPTION 'governance_case_origin_immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.version<OLD.version OR NEW.purpose_version<OLD.purpose_version OR (OLD.status='retired' AND NEW.status<>'retired')) THEN RAISE EXCEPTION 'governance_case_cannot_revive' USING ERRCODE='23514'; END IF;
 IF NEW.status='approved' THEN
  SELECT * INTO v FROM ai_use_case_versions WHERE company_id=NEW.company_id AND use_case_id=NEW.id AND purpose_version=NEW.purpose_version;
  SELECT * INTO o FROM human_oversight_profiles WHERE company_id=NEW.company_id AND id=v.oversight_profile_id;
  IF v.id IS NULL OR o.id IS NULL OR o.status<>'active' OR o.profile_hash<>v.oversight_profile_hash OR NEW.next_review_at<=now() OR NEW.next_review_at IS DISTINCT FROM (v.purpose->>'nextReviewAt')::timestamptz OR v.purpose->>'peopleDomain'<>'none' OR v.purpose->>'riskClass'='C4' OR v.purpose->>'makesRecommendationsAboutPeople'<>'false' OR v.purpose->>'makesDecisionsAboutPeople'<>'false' OR v.purpose->>'materialLegalOrSimilarEffect'<>'false'
  OR substring(o.profile->>'riskClass' from 2)::int<substring(v.purpose->>'riskClass' from 2)::int
  OR (v.purpose->>'externalCommunication'='true' AND v.purpose->>'riskClass' IN ('C0','C1'))
  OR (v.purpose->>'riskClass' IN ('C2','C3') AND o.profile->>'mode'='monitor_only')
  OR (v.purpose->>'riskClass'='C3' AND o.profile->>'mode' NOT IN ('mandatory_human_decision','continuous_supervision'))
  OR (SELECT count(DISTINCT a.assessment->>'framework') FROM ai_use_case_assessments a WHERE a.company_id=NEW.company_id AND a.use_case_id=NEW.id AND a.purpose_version=NEW.purpose_version AND a.assessment->>'framework' IN ('eu_ai_act','gdpr','company_policy') AND a.assessment->>'reviewRequired'='false' AND a.assessment->>'classification' IN ('reviewed','not_applicable','limited_risk') AND EXISTS(SELECT 1 FROM company_memberships m WHERE m.company_id=a.company_id AND m.principal_type='user' AND m.principal_id=a.assessed_by_user_id AND m.status='active'))<>3
  OR EXISTS(SELECT 1 FROM ai_use_case_assessments a WHERE a.company_id=NEW.company_id AND a.use_case_id=NEW.id AND a.purpose_version=NEW.purpose_version AND a.assessment->>'classification' IN ('prohibited','high_risk')) THEN RAISE EXCEPTION 'governance_current_versioned_assessments_required' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_governance_case_guard BEFORE INSERT OR UPDATE ON ai_use_cases FOR EACH ROW EXECUTE FUNCTION aw_v7_governance_case_guard();
--> statement-breakpoint
CREATE FUNCTION aw_v7_governance_oversight_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-'status'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'updated_at') OR (OLD.status='revoked' AND NEW.status<>'revoked') THEN RAISE EXCEPTION 'governance_oversight_requires_new_profile' USING ERRCODE='23514'; END IF;
 IF NEW.status='revoked' THEN UPDATE ai_use_case_deployments d SET status='review_required',updated_at=now() FROM ai_use_case_versions v WHERE v.company_id=NEW.company_id AND v.oversight_profile_id=NEW.id AND d.company_id=v.company_id AND d.use_case_id=v.use_case_id AND d.purpose_version=v.purpose_version AND d.status='active'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_governance_oversight_guard BEFORE UPDATE ON human_oversight_profiles FOR EACH ROW EXECUTE FUNCTION aw_v7_governance_oversight_guard();

--> statement-breakpoint
CREATE FUNCTION aw_v7_governance_stop_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'governance_stop_tombstone_required' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'queued' OR NEW.attempts<>0 OR NEW.lease_until IS NOT NULL OR NOT EXISTS(
   SELECT 1 FROM ai_use_case_deployments d JOIN heartbeat_runs r ON r.company_id=d.company_id AND (r.native_issue_id=d.issue_id OR (r.native_issue_id IS NULL AND r.context_snapshot->>'issueId'=d.issue_id::text)) AND r.agent_id=d.agent_id
   WHERE d.company_id=NEW.company_id AND d.id=NEW.deployment_id AND r.id=NEW.run_id AND (NOT aw_v7_governance_deployment_current(d) OR r.context_snapshot->>'governanceDeploymentId' IS DISTINCT FROM d.id::text)
  ) THEN RAISE EXCEPTION 'governance_stop_scope_mismatch' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW.id,NEW.company_id,NEW.deployment_id,NEW.run_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.company_id,OLD.deployment_id,OLD.run_id,OLD.created_at)
   OR NEW.attempts<OLD.attempts OR NEW.attempts>5 OR (OLD.status='delivered' AND NEW.status<>'delivered')
   OR (NEW.status='delivering' AND (NEW.attempts<>OLD.attempts+1 OR NEW.lease_until IS NULL OR NEW.lease_until>now()+interval '91 seconds' OR (OLD.lease_until IS NOT NULL AND OLD.lease_until>now())))
   OR (NEW.status<>'delivering' AND (NEW.attempts<>OLD.attempts OR NEW.lease_until IS NOT NULL))
   OR (NEW.status='delivered' AND OLD.status<>'delivering')
  THEN RAISE EXCEPTION 'governance_stop_delivery_fenced' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_governance_stop_guard BEFORE INSERT OR UPDATE OR DELETE ON governance_stop_actions FOR EACH ROW EXECUTE FUNCTION aw_v7_governance_stop_guard();

--> statement-breakpoint
CREATE TRIGGER aw_v7_governance_obligation_immutable BEFORE UPDATE OR DELETE ON governance_obligations FOR EACH ROW EXECUTE FUNCTION aw_v7_governance_immutable_record();
