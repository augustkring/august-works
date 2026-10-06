CREATE TABLE "learning_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text,
	"purpose" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'hypothesizing' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"max_hypotheses" integer NOT NULL,
	"max_evaluations" integer NOT NULL,
	"outcome_versions" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"erased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_cycles_tenant_uq" UNIQUE("company_id","id"),
	CONSTRAINT "learning_cycle_scope_check" CHECK (("learning_cycles"."scope_type"='company' and "learning_cycles"."scope_id" is null) or ("learning_cycles"."scope_type"='project' and "learning_cycles"."scope_id" is not null)),
	CONSTRAINT "learning_cycle_status_check" CHECK ("learning_cycles"."status" in ('hypothesizing','evaluating','proposing','completed','failed','cancelled')),
	CONSTRAINT "learning_cycle_limits_check" CHECK ("learning_cycles"."version">0 and "learning_cycles"."max_hypotheses" between 1 and 20 and "learning_cycles"."max_evaluations" between 1 and 40)
);
--> statement-breakpoint
CREATE TABLE "learning_domain_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"hypothesis_id" uuid NOT NULL,
	"evaluation_id" uuid NOT NULL,
	"target_domain" text NOT NULL,
	"target_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"candidate_hash" text NOT NULL,
	"invalidated_at" timestamp with time zone,
	"erased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_candidate_tenant_uq" UNIQUE("company_id","id"),
	CONSTRAINT "learning_candidate_hypothesis_uq" UNIQUE("hypothesis_id"),
	CONSTRAINT "learning_candidate_domain_uq" UNIQUE("company_id","target_domain","candidate_id")
);
--> statement-breakpoint
CREATE TABLE "learning_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"hypothesis_id" uuid NOT NULL,
	"method" text NOT NULL,
	"result" text NOT NULL,
	"cases" jsonb NOT NULL,
	"outcome_versions" jsonb NOT NULL,
	"metrics" jsonb NOT NULL,
	"limitations" jsonb NOT NULL,
	"reviewed_by" text NOT NULL,
	"erased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_evaluations_tenant_uq" UNIQUE("company_id","id"),
	CONSTRAINT "learning_eval_result_check" CHECK ("learning_evaluations"."result" in ('passed','failed','inconclusive')),
	CONSTRAINT "learning_eval_method_check" CHECK ("learning_evaluations"."method"='manual_review')
);
--> statement-breakpoint
CREATE TABLE "learning_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"memory_record_id" uuid NOT NULL,
	"source_version" text NOT NULL,
	CONSTRAINT "learning_evidence_root_uq" UNIQUE("cycle_id","memory_record_id")
);
--> statement-breakpoint
CREATE TABLE "learning_hypotheses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"claim" text NOT NULL,
	"predicted_effect" text NOT NULL,
	"target_domain" text NOT NULL,
	"target_id" uuid NOT NULL,
	"risk_class" text NOT NULL,
	"status" text DEFAULT 'candidate' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"evaluation_contract" jsonb,
	"erased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_hypotheses_tenant_uq" UNIQUE("company_id","id"),
	CONSTRAINT "learning_hypothesis_status_check" CHECK ("learning_hypotheses"."status" in ('candidate','supported','not_supported','inconclusive','proposal_created','rejected')),
	CONSTRAINT "learning_hypothesis_risk_check" CHECK ("learning_hypotheses"."risk_class" in ('low','material','high','critical')),
	CONSTRAINT "learning_hypothesis_target_check" CHECK ("learning_hypotheses"."target_domain" in ('foundation','skill','playbook','project','policy')),
	CONSTRAINT "learning_hypothesis_version_check" CHECK ("learning_hypotheses"."version">0)
);
--> statement-breakpoint
CREATE TABLE "learning_retained_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"candidate_link_id" uuid NOT NULL,
	"asset_type" text NOT NULL,
	"asset_id" uuid NOT NULL,
	"erased_at" timestamp with time zone,
	CONSTRAINT "learning_retained_asset_uq" UNIQUE("candidate_link_id","asset_type","asset_id"),
	CONSTRAINT "learning_retained_asset_type_check" CHECK ("learning_retained_assets"."asset_type" in ('document_revision','skill_version'))
);
--> statement-breakpoint
CREATE TABLE "policy_change_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"policy_type" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"proposal" jsonb,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"review_rationale" text,
	"erased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_proposal_status_check" CHECK ("policy_change_proposals"."status" in ('pending','accepted','rejected','stale')),
	CONSTRAINT "policy_proposal_version_check" CHECK ("policy_change_proposals"."version">0)
);
--> statement-breakpoint
ALTER TABLE "learning_cycles" ADD CONSTRAINT "learning_cycles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_domain_candidates" ADD CONSTRAINT "learning_candidate_hypothesis_fk" FOREIGN KEY ("company_id","hypothesis_id") REFERENCES "public"."learning_hypotheses"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_domain_candidates" ADD CONSTRAINT "learning_candidate_eval_fk" FOREIGN KEY ("company_id","evaluation_id") REFERENCES "public"."learning_evaluations"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_evaluations" ADD CONSTRAINT "learning_eval_hypothesis_fk" FOREIGN KEY ("company_id","hypothesis_id") REFERENCES "public"."learning_hypotheses"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_evidence" ADD CONSTRAINT "learning_evidence_cycle_fk" FOREIGN KEY ("company_id","cycle_id") REFERENCES "public"."learning_cycles"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_evidence" ADD CONSTRAINT "learning_evidence_memory_fk" FOREIGN KEY ("company_id","memory_record_id") REFERENCES "public"."memory_records"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_hypotheses" ADD CONSTRAINT "learning_hypothesis_cycle_fk" FOREIGN KEY ("company_id","cycle_id") REFERENCES "public"."learning_cycles"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_retained_assets" ADD CONSTRAINT "learning_retained_asset_link_fk" FOREIGN KEY ("company_id","candidate_link_id") REFERENCES "public"."learning_domain_candidates"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_change_proposals" ADD CONSTRAINT "policy_change_proposals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learning_cycles_company_idx" ON "learning_cycles" USING btree ("company_id","created_at");
--> statement-breakpoint
-- Current canonical evidence, never model-supplied success flags, gates domain acceptance.
CREATE FUNCTION aw_learning_link_current(p_company uuid, p_link uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS (SELECT 1 FROM learning_domain_candidates l
 JOIN learning_hypotheses h ON h.company_id=l.company_id AND h.id=l.hypothesis_id
 JOIN learning_cycles c ON c.company_id=h.company_id AND c.id=h.cycle_id
 JOIN learning_evaluations e ON e.company_id=l.company_id AND e.id=l.evaluation_id
 WHERE l.company_id=p_company AND l.id=p_link AND l.invalidated_at IS NULL AND l.erased_at IS NULL
 AND c.erased_at IS NULL AND c.status NOT IN ('failed','cancelled') AND h.erased_at IS NULL AND e.erased_at IS NULL AND e.result='passed'
 AND EXISTS (SELECT 1 FROM learning_evidence r WHERE r.company_id=c.company_id AND r.cycle_id=c.id)
 AND NOT EXISTS (SELECT 1 FROM learning_evidence r LEFT JOIN memory_records m ON m.company_id=r.company_id AND m.id=r.memory_record_id
 WHERE r.company_id=c.company_id AND r.cycle_id=c.id AND (m.id IS NULL OR date_trunc('milliseconds',m.updated_at)<>r.source_version::timestamptz
 OR m.review_state<>'accepted' OR m.retention_state<>'active' OR m.deleted_at IS NOT NULL OR m.revoked_at IS NOT NULL OR m.superseded_by_record_id IS NOT NULL
 OR m.owner_agent_id IS NOT NULL OR m.scope_type<>c.scope_type OR m.scope_id IS DISTINCT FROM c.scope_id
 OR m.valid_from>now() OR m.valid_until<=now() OR m.expires_at<=now()
 OR (jsonb_typeof(m.metadata->'allowedPurposes')='array' AND NOT (m.metadata->'allowedPurposes' ? c.purpose))
 OR EXISTS (SELECT 1 FROM memory_deletion_markers d WHERE d.company_id=m.company_id AND d.record_id=m.id)))
 AND EXISTS (SELECT 1 FROM jsonb_each_text(e.outcome_versions))
 AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(e.outcome_versions) v LEFT JOIN issues i ON i.company_id=e.company_id AND i.id=v.key::uuid
 WHERE i.id IS NULL OR i.status<>'done' OR i.completed_at IS NULL OR date_trunc('milliseconds',i.updated_at)<>v.value::timestamptz
 OR (c.scope_type='project' AND i.project_id::text IS DISTINCT FROM c.scope_id)))
$$;
--> statement-breakpoint
CREATE FUNCTION aw_learning_guard_proposal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l learning_domain_candidates%ROWTYPE; body jsonb;
BEGIN
 FOR l IN SELECT * FROM learning_domain_candidates WHERE company_id=NEW.company_id AND target_domain=TG_ARGV[0] AND candidate_id=NEW.id
 UNION SELECT c.* FROM learning_retained_assets a JOIN learning_domain_candidates c ON c.company_id=a.company_id AND c.id=a.candidate_link_id
 WHERE TG_ARGV[0]='playbook' AND a.company_id=NEW.company_id AND a.asset_type='skill_version'
 AND a.asset_id=(to_jsonb(NEW)->>'source_skill_version_id')::uuid LOOP
 IF NEW.status='accepted' AND OLD.status IS DISTINCT FROM 'accepted' AND NOT aw_learning_link_current(NEW.company_id,l.id) THEN
 RAISE EXCEPTION 'Learning source evidence is no longer current' USING ERRCODE='23514'; END IF;
 IF l.erased_at IS NOT NULL THEN
   IF TG_ARGV[0]='foundation' THEN NEW.proposed_body=''; NEW.reason=NULL; NEW.change_summary=NULL;
   ELSIF TG_ARGV[0]='playbook' THEN NEW.title='Erased learning proposal'; NEW.markdown=''; NEW.reason='Erased'; NEW.review_rationale=NULL;
   ELSIF TG_ARGV[0]='policy' THEN NEW.proposal=NULL; NEW.reason=''; NEW.review_rationale=NULL;
   ELSIF TG_ARGV[0]='project' THEN NEW.reason='Erased learning evidence'; NEW.review_rationale=NULL;
     NEW.patch_json=jsonb_set(jsonb_set(NEW.patch_json,'{reason}','"Erased learning evidence"'),'{evidence}','[]');
   END IF;
 END IF;
 -- Domain acceptance creates a reviewed draft; retain the new revision's root lineage.
 IF NEW.status='accepted' AND OLD.status IS DISTINCT FROM 'accepted' AND TG_ARGV[0] IN ('foundation','playbook') THEN
   INSERT INTO learning_retained_assets(company_id,candidate_link_id,asset_type,asset_id)
   SELECT NEW.company_id,l.id,'document_revision',d.latest_revision_id FROM documents d
   WHERE d.company_id=NEW.company_id AND d.id=(CASE WHEN TG_ARGV[0]='foundation' THEN
     (SELECT document_id FROM foundation_documents WHERE company_id=NEW.company_id AND id=l.target_id) ELSE
     (SELECT document_id FROM playbook_documents WHERE company_id=NEW.company_id AND id=(to_jsonb(NEW)->>'playbook_id')::uuid) END)
   AND d.latest_revision_id IS NOT NULL ON CONFLICT DO NOTHING;
 END IF;
 END LOOP;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_learning_foundation_proposal BEFORE UPDATE ON foundation_change_proposals FOR EACH ROW EXECUTE FUNCTION aw_learning_guard_proposal('foundation');
--> statement-breakpoint
CREATE TRIGGER aw_learning_playbook_proposal BEFORE UPDATE ON playbook_change_proposals FOR EACH ROW EXECUTE FUNCTION aw_learning_guard_proposal('playbook');
--> statement-breakpoint
CREATE TRIGGER aw_learning_project_proposal BEFORE UPDATE ON project_roadmap_proposals FOR EACH ROW EXECUTE FUNCTION aw_learning_guard_proposal('project');
--> statement-breakpoint
CREATE TRIGGER aw_learning_policy_proposal BEFORE UPDATE ON policy_change_proposals FOR EACH ROW EXECUTE FUNCTION aw_learning_guard_proposal('policy');
--> statement-breakpoint
CREATE FUNCTION aw_learning_guard_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM learning_retained_assets a JOIN learning_domain_candidates l ON l.company_id=a.company_id AND l.id=a.candidate_link_id
 WHERE a.company_id=NEW.company_id AND a.asset_type='document_revision' AND a.asset_id=NEW.id AND (a.erased_at IS NOT NULL OR l.erased_at IS NOT NULL)) THEN
 NEW.body=''; NEW.title='Erased learning evidence'; NEW.change_summary=NULL; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_learning_document_erasure BEFORE UPDATE ON document_revisions FOR EACH ROW EXECUTE FUNCTION aw_learning_guard_document();
--> statement-breakpoint
CREATE FUNCTION aw_learning_inherit_document() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a learning_retained_assets%ROWTYPE;
BEGIN
 FOR a IN SELECT r.* FROM learning_retained_assets r JOIN documents d ON d.company_id=r.company_id AND d.latest_revision_id=r.asset_id
 WHERE d.company_id=NEW.company_id AND d.id=NEW.document_id AND r.asset_type='document_revision' LOOP
   IF NOT aw_learning_link_current(NEW.company_id,a.candidate_link_id) THEN RAISE EXCEPTION 'Derived document requires current learning evidence' USING ERRCODE='23514'; END IF;
   INSERT INTO learning_retained_assets(company_id,candidate_link_id,asset_type,asset_id) VALUES(NEW.company_id,a.candidate_link_id,'document_revision',NEW.id) ON CONFLICT DO NOTHING;
 END LOOP;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_learning_document_inheritance AFTER INSERT ON document_revisions FOR EACH ROW EXECUTE FUNCTION aw_learning_inherit_document();
--> statement-breakpoint
CREATE FUNCTION aw_learning_guard_canonical_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.approved_revision_id IS NOT NULL AND (NEW.status='approved' OR NEW.approved_revision_id IS DISTINCT FROM OLD.approved_revision_id)
 AND EXISTS (SELECT 1 FROM learning_retained_assets a WHERE a.company_id=NEW.company_id AND a.asset_type='document_revision' AND a.asset_id=NEW.approved_revision_id AND NOT aw_learning_link_current(NEW.company_id,a.candidate_link_id))
 THEN RAISE EXCEPTION 'Canonical publication requires current learning evidence' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_learning_foundation_publication BEFORE UPDATE ON foundation_documents FOR EACH ROW EXECUTE FUNCTION aw_learning_guard_canonical_document();
--> statement-breakpoint
CREATE TRIGGER aw_learning_playbook_publication BEFORE UPDATE ON playbook_documents FOR EACH ROW EXECUTE FUNCTION aw_learning_guard_canonical_document();
--> statement-breakpoint
CREATE FUNCTION aw_learning_guard_skill_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p_link uuid; erased boolean;
BEGIN
 FOR p_link IN SELECT id FROM learning_domain_candidates WHERE company_id=NEW.company_id AND target_domain='skill' AND candidate_id=NEW.id
 UNION SELECT candidate_link_id FROM learning_retained_assets WHERE company_id=NEW.company_id AND asset_type='skill_version' AND asset_id=NEW.id LOOP
   SELECT erased_at IS NOT NULL INTO erased FROM learning_domain_candidates WHERE company_id=NEW.company_id AND id=p_link;
   IF NEW.state='active' AND NOT aw_learning_link_current(NEW.company_id,p_link) THEN RAISE EXCEPTION 'Skill promotion requires current learning evidence' USING ERRCODE='23514'; END IF;
   IF erased THEN NEW.file_inventory='[]'; NEW.label=NULL; NEW.validation_summary='{"erased":true}'; NEW.state='rejected'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_learning_skill_version_guard BEFORE UPDATE ON company_skill_versions FOR EACH ROW EXECUTE FUNCTION aw_learning_guard_skill_version();
--> statement-breakpoint
CREATE FUNCTION aw_learning_inherit_skill() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p_link uuid;
BEGIN
 FOR p_link IN SELECT l.id FROM learning_domain_candidates l JOIN company_skills s ON s.company_id=l.company_id AND s.active_version_id=l.candidate_id
 WHERE s.company_id=NEW.company_id AND s.id=NEW.company_skill_id AND l.target_domain='skill'
 UNION SELECT a.candidate_link_id FROM learning_retained_assets a JOIN company_skills s ON s.company_id=a.company_id AND s.active_version_id=a.asset_id
 WHERE s.company_id=NEW.company_id AND s.id=NEW.company_skill_id AND a.asset_type='skill_version'
 UNION SELECT a.candidate_link_id FROM learning_retained_assets a WHERE a.company_id=NEW.company_id AND a.asset_type='document_revision' AND a.asset_id=NEW.source_playbook_revision_id LOOP
   IF NOT aw_learning_link_current(NEW.company_id,p_link) THEN RAISE EXCEPTION 'Skill challenger requires current learning evidence' USING ERRCODE='23514'; END IF;
   INSERT INTO learning_retained_assets(company_id,candidate_link_id,asset_type,asset_id) VALUES(NEW.company_id,p_link,'skill_version',NEW.id) ON CONFLICT DO NOTHING;
 END LOOP;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_learning_skill_inheritance AFTER INSERT ON company_skill_versions FOR EACH ROW EXECUTE FUNCTION aw_learning_inherit_skill();
--> statement-breakpoint
CREATE FUNCTION aw_learning_guard_document_cache() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM learning_retained_assets a JOIN learning_domain_candidates l ON l.company_id=a.company_id AND l.id=a.candidate_link_id
 WHERE a.company_id=NEW.company_id AND a.asset_type='document_revision' AND a.asset_id=NEW.latest_revision_id AND (a.erased_at IS NOT NULL OR l.erased_at IS NOT NULL)) THEN
 NEW.latest_body=''; NEW.title='Erased learning evidence'; END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_learning_document_cache_erasure BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION aw_learning_guard_document_cache();
--> statement-breakpoint
CREATE FUNCTION aw_learning_guard_foundation_section() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM learning_retained_assets a JOIN learning_domain_candidates l ON l.company_id=a.company_id AND l.id=a.candidate_link_id
 WHERE a.company_id=NEW.company_id AND a.asset_type='document_revision' AND a.asset_id=NEW.document_revision_id AND (a.erased_at IS NOT NULL OR l.erased_at IS NOT NULL)) THEN
 NEW.body=''; NEW.heading_path=ARRAY['erased']; NEW.token_count=0;
 NEW.content_hash='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
 END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_learning_foundation_section_erasure BEFORE INSERT OR UPDATE ON foundation_sections FOR EACH ROW EXECUTE FUNCTION aw_learning_guard_foundation_section();
--> statement-breakpoint
CREATE FUNCTION aw_learning_cycle_erased(p_company uuid, p_cycle uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS (SELECT 1 FROM learning_cycles c WHERE c.company_id=p_company AND c.id=p_cycle AND c.erased_at IS NOT NULL)
 OR EXISTS (SELECT 1 FROM learning_evidence e JOIN memory_records m ON m.company_id=e.company_id AND m.id=e.memory_record_id
 WHERE e.company_id=p_company AND e.cycle_id=p_cycle AND (m.deleted_at IS NOT NULL
 OR EXISTS (SELECT 1 FROM memory_deletion_markers d WHERE d.company_id=m.company_id AND d.record_id=m.id)))
$$;
--> statement-breakpoint
CREATE FUNCTION aw_learning_guard_payload() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p_cycle uuid;
BEGIN
 IF TG_TABLE_NAME='learning_cycles' THEN p_cycle=NEW.id;
 ELSIF TG_TABLE_NAME='learning_hypotheses' THEN p_cycle=NEW.cycle_id;
 ELSE SELECT cycle_id INTO p_cycle FROM learning_hypotheses WHERE company_id=NEW.company_id AND id=NEW.hypothesis_id;
 END IF;
 IF aw_learning_cycle_erased(NEW.company_id,p_cycle) THEN
   NEW.erased_at=coalesce(OLD.erased_at,now());
   IF TG_TABLE_NAME='learning_cycles' THEN NEW.trigger=''; NEW.purpose='erased'; NEW.status='cancelled'; NEW.outcome_versions='{}';
   ELSIF TG_TABLE_NAME='learning_hypotheses' THEN NEW.claim=''; NEW.predicted_effect=''; NEW.evaluation_contract=NULL; NEW.status='rejected';
   ELSE NEW.cases='[]'; NEW.metrics='{}'; NEW.outcome_versions='{}'; NEW.limitations='[]'; NEW.reviewed_by='erased';
   END IF;
 END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_learning_cycle_payload_erasure BEFORE UPDATE ON learning_cycles FOR EACH ROW EXECUTE FUNCTION aw_learning_guard_payload();
--> statement-breakpoint
CREATE TRIGGER aw_learning_hypothesis_payload_erasure BEFORE UPDATE ON learning_hypotheses FOR EACH ROW EXECUTE FUNCTION aw_learning_guard_payload();
--> statement-breakpoint
CREATE TRIGGER aw_learning_evaluation_payload_erasure BEFORE UPDATE ON learning_evaluations FOR EACH ROW EXECUTE FUNCTION aw_learning_guard_payload();
