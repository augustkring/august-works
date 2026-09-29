CREATE INDEX "foundation_sections_body_search_idx"
ON "foundation_sections" USING gin ("body" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "foundation_sections_company_content_hash_idx"
ON "foundation_sections" USING btree ("company_id","content_hash");
