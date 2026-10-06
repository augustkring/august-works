CREATE TABLE "agent_package_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_version_id" uuid NOT NULL,
	"component_key" text NOT NULL,
	"component" jsonb NOT NULL,
	CONSTRAINT "agent_package_components_key_uq" UNIQUE("package_version_id","component_key")
);
--> statement-breakpoint
CREATE TABLE "agent_package_stop_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_package_stop_actions_run_uq" UNIQUE("installation_id","run_id"),
	CONSTRAINT "agent_package_stop_actions_attempts_check" CHECK ("agent_package_stop_actions"."attempts" between 0 and 5),
	CONSTRAINT "agent_package_stop_actions_status_check" CHECK ("agent_package_stop_actions"."status" in ('queued','delivering','delivered'))
);
--> statement-breakpoint
CREATE TABLE "agent_package_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_package_id" uuid NOT NULL,
	"version" text NOT NULL,
	"state" text DEFAULT 'testing' NOT NULL,
	"release" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_package_versions_version_uq" UNIQUE("agent_package_id","version"),
	CONSTRAINT "agent_package_versions_package_id_uq" UNIQUE("agent_package_id","id"),
	CONSTRAINT "agent_package_versions_state_check" CHECK ("agent_package_versions"."state" in ('draft','testing','published','deprecated','revoked')),
	CONSTRAINT "agent_package_versions_hash_check" CHECK ("agent_package_versions"."content_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "agent_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_key" text NOT NULL,
	"publisher_type" text DEFAULT 'august_works' NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_packages_package_key_unique" UNIQUE("package_key"),
	CONSTRAINT "agent_packages_publisher_check" CHECK ("agent_packages"."publisher_type"='august_works'),
	CONSTRAINT "agent_packages_status_check" CHECK ("agent_packages"."status" in ('active','revoked'))
);
--> statement-breakpoint
CREATE TABLE "company_agent_package_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_package_id" uuid NOT NULL,
	"installed_version_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"ai_use_case_id" uuid,
	"update_policy" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'configuring' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"installed_by_user_id" text NOT NULL,
	"resolved_components" jsonb NOT NULL,
	"activation_hash" text,
	"readiness" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_agent_package_installations_tenant_uq" UNIQUE("company_id","id"),
	CONSTRAINT "company_agent_package_installations_status_check" CHECK ("company_agent_package_installations"."status" in ('configuring','readiness_blocked','ready','active','needs_update','degraded','suspended','uninstalled')),
	CONSTRAINT "company_agent_package_installations_version_check" CHECK ("company_agent_package_installations"."version">0),
	CONSTRAINT "company_agent_package_installations_policy_check" CHECK ("company_agent_package_installations"."update_policy" in ('manual','auto_low_risk'))
);
--> statement-breakpoint
ALTER TABLE "agent_package_components" ADD CONSTRAINT "agent_package_components_package_version_id_agent_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."agent_package_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_package_stop_actions" ADD CONSTRAINT "agent_package_stop_actions_company_id_installation_id_company_agent_package_installations_company_id_id_fk" FOREIGN KEY ("company_id","installation_id") REFERENCES "public"."company_agent_package_installations"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_package_stop_actions" ADD CONSTRAINT "agent_package_stop_actions_company_id_run_id_heartbeat_runs_company_id_id_fk" FOREIGN KEY ("company_id","run_id") REFERENCES "public"."heartbeat_runs"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_package_versions" ADD CONSTRAINT "agent_package_versions_agent_package_id_agent_packages_id_fk" FOREIGN KEY ("agent_package_id") REFERENCES "public"."agent_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_agent_package_installations" ADD CONSTRAINT "company_agent_package_installations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_agent_package_installations" ADD CONSTRAINT "company_agent_package_installations_agent_package_id_installed_version_id_agent_package_versions_agent_package_id_id_fk" FOREIGN KEY ("agent_package_id","installed_version_id") REFERENCES "public"."agent_package_versions"("agent_package_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_agent_package_installations" ADD CONSTRAINT "company_agent_package_installations_company_id_agent_id_agents_company_id_id_fk" FOREIGN KEY ("company_id","agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_agent_package_installations" ADD CONSTRAINT "company_agent_package_installations_company_id_ai_use_case_id_ai_use_cases_company_id_id_fk" FOREIGN KEY ("company_id","ai_use_case_id") REFERENCES "public"."ai_use_cases"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_agent_package_installations_agent_uq" ON "company_agent_package_installations" USING btree ("company_id","agent_id") WHERE "company_agent_package_installations"."status"<>'uninstalled';--> statement-breakpoint
CREATE INDEX "company_agent_package_installations_company_idx" ON "company_agent_package_installations" USING btree ("company_id","updated_at");--> statement-breakpoint
CREATE FUNCTION aw_v7_package_component_payload(c uuid,k text,r uuid,v uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT CASE k
 WHEN 'role_pack' THEN (SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(i.item ORDER BY i.ordinal) FROM role_pack_items i WHERE i.company_id=c AND i.version_id=v),'[]'::jsonb)) FROM role_pack_versions x JOIN role_packs p ON p.company_id=c AND p.id=x.role_pack_id WHERE x.company_id=c AND x.id=v AND x.role_pack_id=r AND x.state='published' AND p.status='active' AND aw_learning_asset_current(c,'role_pack_version',v))
 WHEN 'skill' THEN (SELECT jsonb_build_object('files',x.file_inventory) FROM company_skill_versions x JOIN company_skills s ON s.company_id=c AND s.id=x.company_skill_id WHERE x.company_id=c AND x.id=v AND x.company_skill_id=r AND x.state='active' AND s.lifecycle_state='active' AND s.active_version_id=v AND s.compatibility='compatible' AND (s.next_review_at IS NULL OR s.next_review_at>now()) AND aw_learning_asset_current(c,'skill_version',v))
 WHEN 'playbook' THEN (SELECT jsonb_build_object('body',x.body,'title',x.title) FROM playbook_documents p JOIN document_revisions x ON x.company_id=c AND x.id=v AND x.document_id=p.document_id WHERE p.company_id=c AND p.id=r AND p.approved_revision_id=v AND p.status IN ('approved','in_review') AND (p.next_review_at IS NULL OR p.next_review_at>now()) AND aw_learning_asset_current(c,'document_revision',v))
 WHEN 'workflow_template' THEN (SELECT jsonb_build_object('graph',x.graph_json,'input',x.input_schema,'output',x.output_schema) FROM workflow_revisions x JOIN workflows w ON w.company_id=c AND w.id=x.workflow_id WHERE x.company_id=c AND x.id=v AND x.workflow_id=r AND x.state='published' AND w.published_revision_id=v AND w.status='active' AND aw_learning_asset_current(c,'workflow_revision',v))
 WHEN 'routine_template' THEN (SELECT jsonb_build_object('snapshot',x.snapshot) FROM routine_revisions x JOIN routines n ON n.company_id=c AND n.id=x.routine_id WHERE x.company_id=c AND x.id=v AND x.routine_id=r AND n.latest_revision_id=v AND n.status='active')
 ELSE NULL END;
$$;
--> statement-breakpoint
CREATE FUNCTION aw_v7_package_component_hash(c uuid,k text,r uuid,v uuid) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT encode(sha256(convert_to(aw_v7_package_component_payload(c,k,r,v)::text,'UTF8')),'hex');
$$;
--> statement-breakpoint
CREATE FUNCTION aw_v7_package_authority_hash(i company_agent_package_installations) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object(
 'activationRevision',i.version,'version',i.installed_version_id,'components',i.resolved_components,'useCase',coalesce((SELECT jsonb_build_object('id',u.id,'version',u.purpose_version,'hash',v.purpose_hash,'oversight',o.profile_hash,'state',o.status) FROM ai_use_cases u JOIN ai_use_case_versions v ON v.company_id=u.company_id AND v.use_case_id=u.id AND v.purpose_version=u.purpose_version JOIN human_oversight_profiles o ON o.company_id=v.company_id AND o.id=v.oversight_profile_id WHERE u.company_id=i.company_id AND u.id=i.ai_use_case_id),'{}'::jsonb),
 'readinessPolicy',coalesce((SELECT jsonb_agg(jsonb_build_object('key',r.requirement_key,'version',r.version) ORDER BY r.requirement_key,r.version) FROM readiness_requirements r WHERE r.company_id=i.company_id),'[]'::jsonb),
 'agent',(SELECT jsonb_build_object('identity',a.agent_identity_id,'adapter',a.adapter_type,'config',a.adapter_config,'runtime',a.runtime_config,'permissions',a.permissions) FROM agents a WHERE a.company_id=i.company_id AND a.id=i.agent_id),
 'provider',(SELECT to_jsonb(r)-'created_at'-'updated_at' FROM agent_presence_runtime_bindings r WHERE r.company_id=i.company_id AND r.agent_id=i.agent_id),
 'grants',coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.id) FROM principal_permission_grants g WHERE g.company_id=i.company_id AND g.principal_id IN (i.agent_id::text,i.installed_by_user_id)),'[]'::jsonb),
 'connections',coalesce((SELECT jsonb_agg(jsonb_build_object('grant',to_jsonb(g),'connection',to_jsonb(t)-'updated_at'-'last_connected_at') ORDER BY g.id) FROM connection_grants g JOIN tool_connections t ON t.company_id=g.company_id AND t.id=g.connection_id WHERE g.company_id=i.company_id AND (g.subject_agent_id=i.agent_id OR g.subject_user_id=i.installed_by_user_id)),'[]'::jsonb),
 'roles',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM agent_role_pack_assignments a WHERE a.company_id=i.company_id AND (a.scope_type<>'agent' OR a.scope_id=i.agent_id)),'[]'::jsonb),
 'foundation',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'version',f.approved_revision_id,'status',f.status,'authority',f.authority_level,'validFrom',f.valid_from,'validUntil',f.valid_until,'review',f.last_reviewed_at) ORDER BY f.id) FROM foundation_documents f WHERE f.company_id=i.company_id AND f.authority_level='canonical'),'[]'::jsonb)
 )::text,'UTF8')),'hex');
$$;
--> statement-breakpoint
CREATE FUNCTION aw_v7_package_installation_current(i company_agent_package_installations) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT i.status='active' AND i.activation_hash=aw_v7_package_authority_hash(i)
 AND EXISTS(SELECT 1 FROM instance_settings WHERE singleton_key='default' AND experimental->>'agent_packages_v7'='true' AND experimental->>'role_packs_v5'='true' AND experimental->>'skill_resolver_v5'='true' AND experimental->>'skill_lifecycle_v5'='true' AND experimental->>'playbooks_v5'='true' AND experimental->>'billing_v6'='true')
 AND EXISTS(SELECT 1 FROM agent_package_versions v JOIN agent_packages p ON p.id=v.agent_package_id WHERE v.id=i.installed_version_id AND p.id=i.agent_package_id AND p.status='active' AND v.state='published' AND (v.release->'releaseEvidence'->>'expiresAt')::timestamptz>now())
 AND EXISTS(SELECT 1 FROM company_memberships m WHERE m.company_id=i.company_id AND m.principal_type='user' AND m.principal_id=i.installed_by_user_id AND m.status='active')
 AND EXISTS(SELECT 1 FROM agents a JOIN agent_presence_runtime_bindings r ON r.company_id=a.company_id AND r.agent_id=a.id JOIN agent_provider_bindings p ON p.id=r.provider_binding_id WHERE a.company_id=i.company_id AND a.id=i.agent_id AND a.status<>'terminated' AND r.status='active' AND r.qualified_configuration_hash IS NOT NULL AND p.status='active')
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(i.resolved_components) pin WHERE aw_v7_package_component_hash(i.company_id,pin->>'type',(pin->>'resourceId')::uuid,(pin->>'versionId')::uuid) IS DISTINCT FROM pin->>'contentHash')
 AND NOT EXISTS(SELECT 1 FROM agent_package_components c WHERE c.package_version_id=i.installed_version_id AND (c.component->>'required')::boolean AND c.component->>'type' IN ('role_pack','skill','playbook','workflow_template','routine_template') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(i.resolved_components) pin WHERE pin->>'key'=c.component_key AND pin->>'type'=c.component->>'type' AND pin->>'contentHash'=c.component->>'contentHash'))
 AND NOT EXISTS(SELECT 1 FROM agent_package_components c WHERE c.package_version_id=i.installed_version_id AND (c.component->>'required')::boolean AND c.component->>'type' NOT IN ('role_pack','skill','playbook','workflow_template','routine_template','eval_suite','sandbox_policy_template','use_case_template','onboarding_template'))
 AND aw_learning_asset_current(i.company_id,'agent_package_installation',i.id)
 AND EXISTS(SELECT 1 FROM agent_package_versions v WHERE v.id=i.installed_version_id AND jsonb_array_length(i.readiness->'assessmentIds')=jsonb_array_length(v.release->'manifest'->'actionClasses'))
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(i.readiness->'assessmentIds') ref LEFT JOIN readiness_assessments a ON a.company_id=i.company_id AND a.id::text=ref.value WHERE a.id IS NULL OR a.agent_id<>i.agent_id OR a.principal_id<>i.installed_by_user_id OR a.status NOT IN ('ready','ready_with_warnings') OR a.expires_at<=now())
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(i.resolved_components) pin WHERE NOT EXISTS(SELECT 1 FROM agent_package_components c WHERE c.package_version_id=i.installed_version_id AND c.component_key=pin->>'key' AND c.component->>'type'=pin->>'type' AND c.component->>'contentHash'=pin->>'contentHash'))
 AND EXISTS(SELECT 1 FROM agent_package_versions v WHERE v.id=i.installed_version_id AND (v.release->'manifest'->>'commercialProductKey' IS NULL OR EXISTS(SELECT 1 FROM billing_account_companies cb JOIN billing_accounts b ON b.id=cb.billing_account_id JOIN billing_subscriptions s ON s.billing_account_id=b.id WHERE cb.company_id=i.company_id AND cb.status='active' AND b.status='active' AND s.product_keys ? (v.release->'manifest'->>'commercialProductKey') AND ((s.status IN ('active','trialing') AND (s.current_period_end IS NULL OR s.current_period_end>now())) OR (s.status='past_due' AND s.grace_until>now())))))
 AND (i.ai_use_case_id IS NULL OR EXISTS(SELECT 1 FROM ai_use_cases u WHERE u.company_id=i.company_id AND u.id=i.ai_use_case_id AND u.status='approved' AND u.next_review_at>now()));
$$;
--> statement-breakpoint
CREATE FUNCTION aw_v7_package_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'package_revocation_tombstone_required' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.agent_package_id,NEW.version,NEW.release,NEW.content_hash,NEW.created_by_user_id,NEW.created_at) IS DISTINCT FROM (OLD.agent_package_id,OLD.version,OLD.release,OLD.content_hash,OLD.created_by_user_id,OLD.created_at) THEN RAISE EXCEPTION 'package_release_content_immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD.state IN ('published','deprecated','revoked') AND NEW.state NOT IN ('deprecated','revoked') AND NEW.state<>OLD.state THEN RAISE EXCEPTION 'package_version_no_republication' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_package_version_guard BEFORE UPDATE OR DELETE ON agent_package_versions FOR EACH ROW EXECUTE FUNCTION aw_v7_package_version_guard();
--> statement-breakpoint
CREATE FUNCTION aw_v7_package_component_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' OR EXISTS(SELECT 1 FROM agent_package_versions v WHERE v.id=NEW.package_version_id AND v.state IN ('published','deprecated','revoked')) THEN RAISE EXCEPTION 'package_components_immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_package_component_guard BEFORE INSERT OR UPDATE OR DELETE ON agent_package_components FOR EACH ROW EXECUTE FUNCTION aw_v7_package_component_guard();
--> statement-breakpoint
CREATE FUNCTION aw_v7_package_installation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'package_uninstall_tombstone_required' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.company_id,NEW.agent_id,NEW.agent_package_id,NEW.installed_by_user_id,NEW.created_at) IS DISTINCT FROM (OLD.company_id,OLD.agent_id,OLD.agent_package_id,OLD.installed_by_user_id,OLD.created_at) THEN RAISE EXCEPTION 'package_installation_scope_immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.version<>OLD.version+1 OR OLD.status='uninstalled') THEN RAISE EXCEPTION 'package_installation_revision_conflict' USING ERRCODE='23514'; END IF;
 IF NEW.status='active' AND (aw_v7_package_installation_current(NEW) IS NOT TRUE OR NEW.readiness IS NULL OR NEW.readiness->>'status' NOT IN ('ready','ready_with_warnings')) THEN RAISE EXCEPTION 'package_current_readiness_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_package_installation_guard BEFORE INSERT OR UPDATE OR DELETE ON company_agent_package_installations FOR EACH ROW EXECUTE FUNCTION aw_v7_package_installation_guard();
--> statement-breakpoint
CREATE FUNCTION aw_v7_package_fence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO agent_package_stop_actions(company_id,installation_id,run_id)
 SELECT NEW.company_id,NEW.id,r.id FROM heartbeat_runs r WHERE r.company_id=NEW.company_id AND r.agent_id=NEW.agent_id AND r.status IN ('queued','running','scheduled_retry') AND (NOT aw_v7_package_installation_current(NEW) OR r.context_snapshot->>'agentPackageActivationHash' IS DISTINCT FROM NEW.activation_hash OR r.context_snapshot->>'agentPackageInstallationId' IS DISTINCT FROM NEW.id::text) ON CONFLICT DO NOTHING;
 UPDATE heartbeat_runs SET result_json=coalesce(result_json,'{}'::jsonb)||jsonb_build_object('executionCancellation',jsonb_build_object('state','requested','reason','package_changed','requestedAt',now())) WHERE company_id=NEW.company_id AND agent_id=NEW.agent_id AND status IN ('queued','running','scheduled_retry') AND (NOT aw_v7_package_installation_current(NEW) OR context_snapshot->>'agentPackageActivationHash' IS DISTINCT FROM NEW.activation_hash OR context_snapshot->>'agentPackageInstallationId' IS DISTINCT FROM NEW.id::text);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_package_fence AFTER INSERT OR UPDATE ON company_agent_package_installations FOR EACH ROW EXECUTE FUNCTION aw_v7_package_fence();
--> statement-breakpoint
CREATE FUNCTION aw_v7_package_run_admission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE i company_agent_package_installations; prior_id text; prior_hash text;
BEGIN
 IF TG_OP='UPDATE' THEN
  prior_id:=OLD.context_snapshot->>'agentPackageInstallationId'; prior_hash:=OLD.context_snapshot->>'agentPackageActivationHash';
  IF prior_id IS NULL AND NEW.context_snapshot->>'agentPackageInstallationId' IS NOT NULL THEN RAISE EXCEPTION 'package_run_cannot_adopt_late_installation' USING ERRCODE='23514'; END IF;
  IF prior_id IS NOT NULL THEN
   IF (NEW.company_id,NEW.agent_id) IS DISTINCT FROM (OLD.company_id,OLD.agent_id) OR (NEW.context_snapshot->>'agentPackageInstallationId' IS NOT NULL AND NEW.context_snapshot->>'agentPackageInstallationId'<>prior_id) OR (NEW.context_snapshot->>'agentPackageActivationHash' IS NOT NULL AND NEW.context_snapshot->>'agentPackageActivationHash'<>prior_hash) THEN RAISE EXCEPTION 'package_run_pin_immutable' USING ERRCODE='23514'; END IF;
   NEW.context_snapshot:=coalesce(NEW.context_snapshot,'{}'::jsonb)||jsonb_build_object('agentPackageInstallationId',prior_id,'agentPackageActivationHash',prior_hash);
  END IF;
 END IF;
 IF (TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status) AND NEW.status IN ('queued','running','scheduled_retry') AND EXISTS(SELECT 1 FROM company_agent_package_installations x WHERE x.company_id=NEW.company_id AND x.agent_id=NEW.agent_id) THEN
  SELECT * INTO i FROM company_agent_package_installations x WHERE x.company_id=NEW.company_id AND x.agent_id=NEW.agent_id AND aw_v7_package_installation_current(x);
  IF i.id IS NULL OR (TG_OP='UPDATE' AND (prior_id IS DISTINCT FROM i.id::text OR prior_hash IS DISTINCT FROM i.activation_hash)) THEN RAISE EXCEPTION 'package_run_activation_required' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' AND NEW.retry_of_run_id IS NOT NULL AND EXISTS(SELECT 1 FROM heartbeat_runs r WHERE r.company_id=NEW.company_id AND r.id=NEW.retry_of_run_id AND (r.context_snapshot->>'agentPackageInstallationId' IS DISTINCT FROM i.id::text OR r.context_snapshot->>'agentPackageActivationHash' IS DISTINCT FROM i.activation_hash)) THEN RAISE EXCEPTION 'package_retry_activation_changed' USING ERRCODE='23514'; END IF;
  NEW.context_snapshot:=coalesce(NEW.context_snapshot,'{}'::jsonb)||jsonb_build_object('agentPackageInstallationId',i.id::text,'agentPackageActivationHash',i.activation_hash);
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_package_run_admission BEFORE INSERT OR UPDATE ON heartbeat_runs FOR EACH ROW EXECUTE FUNCTION aw_v7_package_run_admission();
--> statement-breakpoint
CREATE FUNCTION aw_v7_package_stop_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'package_stop_history_immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND ((NEW.company_id,NEW.installation_id,NEW.run_id,NEW.created_at) IS DISTINCT FROM (OLD.company_id,OLD.installation_id,OLD.run_id,OLD.created_at) OR NEW.attempts<OLD.attempts OR NEW.attempts>OLD.attempts+1 OR (OLD.status='delivered' AND NEW.status<>'delivered') OR (OLD.lease_until>now() AND NEW.attempts>OLD.attempts)) THEN RAISE EXCEPTION 'package_stop_lease_or_history_conflict' USING ERRCODE='23514'; END IF;
 IF NEW.status='delivering' AND (NEW.lease_until IS NULL OR NEW.lease_until<=now() OR NEW.lease_until>now()+interval '91 seconds') THEN RAISE EXCEPTION 'package_stop_bounded_lease_required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v7_package_stop_guard BEFORE UPDATE OR DELETE ON agent_package_stop_actions FOR EACH ROW EXECUTE FUNCTION aw_v7_package_stop_guard();
