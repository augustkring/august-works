ALTER TABLE "agent_role_pack_assignments" DROP CONSTRAINT "agent_role_pack_assignments_company_id_pinned_version_id_role_pack_versions_company_id_id_fk";
--> statement-breakpoint

ALTER TABLE "role_packs" DROP CONSTRAINT "role_packs_published_version_id_role_pack_versions_id_fk";
--> statement-breakpoint

ALTER TABLE "role_pack_versions" ADD CONSTRAINT "role_pack_versions_company_pack_id_uq" UNIQUE("company_id","role_pack_id","id");--> statement-breakpoint

ALTER TABLE "agent_role_pack_assignments" ADD CONSTRAINT "agent_role_pack_assignments_company_id_role_pack_id_pinned_version_id_role_pack_versions_company_id_role_pack_id_id_fk" FOREIGN KEY ("company_id","role_pack_id","pinned_version_id") REFERENCES "public"."role_pack_versions"("company_id","role_pack_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "role_packs" ADD CONSTRAINT "role_packs_company_id_id_published_version_id_role_pack_versions_company_id_role_pack_id_id_fk" FOREIGN KEY ("company_id","id","published_version_id") REFERENCES "public"."role_pack_versions"("company_id","role_pack_id","id") ON DELETE no action ON UPDATE no action;