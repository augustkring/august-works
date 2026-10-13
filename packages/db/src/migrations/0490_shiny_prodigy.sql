ALTER TABLE "foundation_change_proposals" ADD COLUMN "conversation_source_run_id" uuid;--> statement-breakpoint
ALTER TABLE "foundation_change_proposals" ADD COLUMN "conversation_responsible_user_id" text;--> statement-breakpoint
CREATE INDEX "foundation_change_proposals_company_conversation_source_idx" ON "foundation_change_proposals" USING btree ("company_id","conversation_source_run_id");
--> statement-breakpoint
CREATE FUNCTION aw_conversation_foundation_proposal_erased(company uuid, proposal uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
DECLARE prior text; depth integer; erased boolean;
BEGIN
 IF EXISTS(SELECT 1 FROM memory_deletion_markers m WHERE m.company_id=company AND m.kind='source'
   AND m.key='conversation-foundation-proposal-erasure:v1:'||proposal::text) THEN RETURN true; END IF;
 prior:=current_setting('aw.foundation_source_depth',true);
 depth:=CASE WHEN coalesce(prior,'') ~ '^[0-9]{1,3}$' THEN prior::integer ELSE 0 END;
 IF depth>=16 THEN RETURN true; END IF;
 PERFORM set_config('aw.foundation_source_depth',(depth+1)::text,true);
 SELECT coalesce((SELECT CASE WHEN p.conversation_source_run_id IS NULL AND p.source_type<>'conversation_authoring' THEN false ELSE
   p.source_type IS DISTINCT FROM 'conversation_authoring' OR p.source_id IS DISTINCT FROM p.conversation_source_run_id::text OR
   aw_conversation_routine_origin_erased(company,p.conversation_source_run_id::text,p.proposed_by_agent_id,p.conversation_responsible_user_id)
   END FROM foundation_change_proposals p WHERE p.company_id=company AND p.id=proposal),true) INTO erased;
 PERFORM set_config('aw.foundation_source_depth',coalesce(prior,''),true);
 RETURN erased;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('aw.foundation_source_depth',coalesce(prior,''),true);
 RAISE;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION aw_erase_conversation_foundation_proposal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (OLD.source_type='conversation_authoring' OR OLD.conversation_source_run_id IS NOT NULL)
  AND (NEW.source_type,NEW.source_id,NEW.conversation_source_run_id,NEW.conversation_responsible_user_id,NEW.proposed_by_agent_id,NEW.foundation_document_id,NEW.company_id)
    IS DISTINCT FROM (OLD.source_type,OLD.source_id,OLD.conversation_source_run_id,OLD.conversation_responsible_user_id,OLD.proposed_by_agent_id,OLD.foundation_document_id,OLD.company_id) THEN
  RAISE EXCEPTION 'Foundation proposal provenance is immutable' USING ERRCODE='23514';
 END IF;
 IF (NEW.source_type='conversation_authoring' OR NEW.conversation_source_run_id IS NOT NULL) AND (
   EXISTS(SELECT 1 FROM memory_deletion_markers m WHERE m.company_id=NEW.company_id AND m.kind='source'
     AND m.key='conversation-foundation-proposal-erasure:v1:'||NEW.id::text)
   OR
   NEW.source_type IS DISTINCT FROM 'conversation_authoring' OR NEW.source_id IS DISTINCT FROM NEW.conversation_source_run_id::text
   OR aw_conversation_routine_origin_erased(NEW.company_id,NEW.conversation_source_run_id::text,NEW.proposed_by_agent_id,NEW.conversation_responsible_user_id)) THEN
   NEW.proposed_body:=''; NEW.change_summary:=NULL; NEW.reason:=NULL;
   IF NEW.status='pending' THEN NEW.status:='rejected'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_conversation_foundation_proposal_guard BEFORE INSERT OR UPDATE ON foundation_change_proposals
 FOR EACH ROW EXECUTE FUNCTION aw_erase_conversation_foundation_proposal();

--> statement-breakpoint
CREATE FUNCTION aw_guard_foundation_proposal_activity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proposal uuid;
BEGIN
 IF NEW.entity_type='foundation_change_proposal' AND NEW.entity_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
  proposal:=NEW.entity_id::uuid;
  IF EXISTS(SELECT 1 FROM foundation_change_proposals p WHERE p.company_id=NEW.company_id AND p.id=proposal AND p.conversation_source_run_id IS NOT NULL)
    AND aw_conversation_foundation_proposal_erased(NEW.company_id,proposal) THEN NEW.details:='{"payloadDeleted":true}'::jsonb; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_foundation_proposal_activity_guard BEFORE INSERT OR UPDATE ON activity_log
 FOR EACH ROW EXECUTE FUNCTION aw_guard_foundation_proposal_activity();

--> statement-breakpoint
CREATE FUNCTION aw_foundation_proposal_delete_marker() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.conversation_source_run_id IS NOT NULL THEN
  INSERT INTO memory_deletion_markers(company_id,kind,key)
    VALUES(OLD.company_id,'source','conversation-foundation-proposal-erasure:v1:'||OLD.id::text) ON CONFLICT DO NOTHING;
 END IF;
 RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_foundation_proposal_delete_marker BEFORE DELETE ON foundation_change_proposals
 FOR EACH ROW EXECUTE FUNCTION aw_foundation_proposal_delete_marker();
