CREATE TABLE "portfolio_capability_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"asset_type" text NOT NULL,
	"asset_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"recipient_company_ids" uuid[] NOT NULL,
	"classification" text NOT NULL,
	"release_notes" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"hash" text NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"published_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_capability_publications_state_check" CHECK ("portfolio_capability_publications"."status" in ('published','withdrawn')),
	CONSTRAINT "portfolio_capability_publications_classification_check" CHECK ("portfolio_capability_publications"."classification" in ('public','internal')),
	CONSTRAINT "portfolio_capability_publications_type_check" CHECK ("portfolio_capability_publications"."asset_type" in ('skill','playbook'))
);
--> statement-breakpoint
CREATE TABLE "portfolio_capability_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"publication_id" uuid NOT NULL,
	"source_company_id" uuid NOT NULL,
	"asset_type" text NOT NULL,
	"source_asset_id" uuid NOT NULL,
	"pinned_source_version_id" uuid NOT NULL,
	"local_skill_id" uuid,
	"local_playbook_id" uuid,
	"mode" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_capability_subscriptions_skill_uq" UNIQUE("local_skill_id"),
	CONSTRAINT "portfolio_capability_subscriptions_playbook_uq" UNIQUE("local_playbook_id"),
	CONSTRAINT "portfolio_capability_subscriptions_mode_check" CHECK ("portfolio_capability_subscriptions"."mode" in ('install','subscribe','fork')),
	CONSTRAINT "portfolio_capability_subscriptions_local_type_check" CHECK (("portfolio_capability_subscriptions"."asset_type" = 'skill' and "portfolio_capability_subscriptions"."local_skill_id" is not null and "portfolio_capability_subscriptions"."local_playbook_id" is null) or ("portfolio_capability_subscriptions"."asset_type" = 'playbook' and "portfolio_capability_subscriptions"."local_playbook_id" is not null and "portfolio_capability_subscriptions"."local_skill_id" is null))
);
--> statement-breakpoint
ALTER TABLE "portfolio_capability_publications" ADD CONSTRAINT "portfolio_capability_publications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_capability_subscriptions" ADD CONSTRAINT "portfolio_capability_subscriptions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_capability_subscriptions" ADD CONSTRAINT "portfolio_capability_subscriptions_publication_id_portfolio_capability_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."portfolio_capability_publications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_capability_subscriptions" ADD CONSTRAINT "portfolio_capability_subscriptions_source_company_id_companies_id_fk" FOREIGN KEY ("source_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_capability_subscriptions" ADD CONSTRAINT "portfolio_capability_subscriptions_company_id_local_skill_id_company_skills_company_id_id_fk" FOREIGN KEY ("company_id","local_skill_id") REFERENCES "public"."company_skills"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_capability_subscriptions" ADD CONSTRAINT "portfolio_capability_subscriptions_company_id_local_playbook_id_playbook_documents_company_id_id_fk" FOREIGN KEY ("company_id","local_playbook_id") REFERENCES "public"."playbook_documents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portfolio_capability_publications_asset_idx" ON "portfolio_capability_publications" USING btree ("company_id","asset_type","asset_id","created_at");--> statement-breakpoint
CREATE INDEX "portfolio_capability_subscriptions_source_idx" ON "portfolio_capability_subscriptions" USING btree ("company_id","source_company_id","source_asset_id");
--> statement-breakpoint
CREATE FUNCTION aw_v5_publication_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM companies WHERE id = OLD.company_id) THEN
      RAISE EXCEPTION 'Portfolio releases are immutable; withdraw the release' USING ERRCODE = '23514', CONSTRAINT = 'aw_v5_publication_immutable';
    END IF;
    RETURN OLD;
  END IF;
  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') OR OLD.status = 'withdrawn' AND NEW.status <> 'withdrawn' THEN
    RAISE EXCEPTION 'Portfolio release bytes and recipient grants are immutable' USING ERRCODE = '23514', CONSTRAINT = 'aw_v5_publication_immutable';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_v5_publication_immutable BEFORE UPDATE OR DELETE ON portfolio_capability_publications FOR EACH ROW EXECUTE FUNCTION aw_v5_publication_immutable();
