CREATE TABLE "strategy_execution_source_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"issue_id" uuid,
	"project_id" uuid,
	CONSTRAINT "strategy_bindings_issue_uq" UNIQUE("company_id","link_id","issue_id"),
	CONSTRAINT "strategy_bindings_project_uq" UNIQUE("company_id","link_id","project_id"),
	CONSTRAINT "strategy_bindings_source_check" CHECK (("strategy_execution_source_bindings"."issue_id" is not null)::int + ("strategy_execution_source_bindings"."project_id" is not null)::int = 1)
);
--> statement-breakpoint
ALTER TABLE "strategy_execution_source_bindings" ADD CONSTRAINT "strategy_bindings_link_fk" FOREIGN KEY ("company_id","link_id") REFERENCES "public"."strategy_execution_links"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_execution_source_bindings" ADD CONSTRAINT "strategy_bindings_issue_fk" FOREIGN KEY ("company_id","issue_id") REFERENCES "public"."issues"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_execution_source_bindings" ADD CONSTRAINT "strategy_bindings_project_fk" FOREIGN KEY ("company_id","project_id") REFERENCES "public"."projects"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION aw_strategy_binding_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM strategy_execution_links WHERE company_id=OLD.company_id AND id=OLD.link_id;
 RETURN OLD;
END; $$;
--> statement-breakpoint
CREATE TRIGGER aw_strategy_binding_erasure AFTER DELETE ON strategy_execution_source_bindings FOR EACH ROW EXECUTE FUNCTION aw_strategy_binding_erasure();
--> statement-breakpoint
CREATE TRIGGER aw_strategy_binding_immutable BEFORE UPDATE ON strategy_execution_source_bindings FOR EACH ROW EXECUTE FUNCTION aw_analytical_snapshot_immutable();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION aw_strategy_source_erased(tenant uuid, link uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM strategy_execution_links l WHERE l.company_id=tenant AND l.id=link AND (
 aw_strategy_endpoint_erased(tenant,l.from_type,l.from_ref) OR aw_strategy_endpoint_erased(tenant,l.to_type,l.to_ref)
 OR EXISTS(SELECT 1 FROM strategy_execution_link_versions v WHERE v.company_id=tenant AND v.link_id=link AND aw_strategy_definition_erased(tenant,v.definition_json))
 OR EXISTS(SELECT 1 FROM strategy_execution_source_bindings b JOIN analytical_source_suppressions s ON s.company_id=b.company_id AND (s.input_type='issue' AND s.input_ref=b.issue_id OR s.input_type='project' AND s.input_ref=b.project_id) WHERE b.company_id=tenant AND b.link_id=link)));
$$;
--> statement-breakpoint
CREATE FUNCTION aw_strategy_binding_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM analytical_source_suppressions s WHERE s.company_id=NEW.company_id AND (s.input_type='issue' AND s.input_ref=NEW.issue_id OR s.input_type='project' AND s.input_ref=NEW.project_id)) THEN
  RAISE EXCEPTION 'Strategy ancestry was erased' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER aw_strategy_binding_admission BEFORE INSERT ON strategy_execution_source_bindings FOR EACH ROW EXECUTE FUNCTION aw_strategy_binding_admission();
