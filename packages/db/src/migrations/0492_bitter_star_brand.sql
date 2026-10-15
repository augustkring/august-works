CREATE TABLE "notification_preference_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_by_agent_id" uuid NOT NULL,
	"source_run_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"category" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"request_hash" text NOT NULL,
	"baseline_hash" text NOT NULL,
	"preference" jsonb,
	"confirmation_request_id" uuid,
	"confirmation_request_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preference_proposals_status_check" CHECK ("notification_preference_proposals"."status" in ('pending','applied','discarded','erased')),
	CONSTRAINT "notification_preference_proposals_version_check" CHECK ("notification_preference_proposals"."version">0 and "notification_preference_proposals"."generation">=0),
	CONSTRAINT "notification_preference_proposals_category_check" CHECK ("notification_preference_proposals"."category" in ('security','billing','runtime','approval','work_update'))
);
--> statement-breakpoint
ALTER TABLE "notification_preference_proposals" ADD CONSTRAINT "notification_preference_proposals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_preference_proposals_company_source_idx" ON "notification_preference_proposals" USING btree ("company_id","source_run_id");--> statement-breakpoint
CREATE INDEX "notification_preference_proposals_owner_chat_idx" ON "notification_preference_proposals" USING btree ("company_id","user_id","conversation_id","generation","created_at");
--> statement-breakpoint
-- Own-account proposals retain exact conversation provenance. Source loss
-- removes the proposal payload, never a preference explicitly applied by a Human.
CREATE FUNCTION aw_notification_proposal_origin_erased(company uuid, execution uuid, creator uuid, requester text, conversation uuid, generation integer)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT aw_conversation_routine_origin_erased(company,execution::text,creator,requester)
 OR NOT EXISTS(SELECT 1 FROM heartbeat_runs h JOIN issues i ON i.company_id=h.company_id AND i.id=conversation
   WHERE h.company_id=company AND h.id=execution AND h.agent_id=creator AND h.responsible_user_id=requester
    AND coalesce(h.native_issue_id,CASE WHEN coalesce(h.context_snapshot->>'issueId',h.context_snapshot->>'taskId')
      ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN coalesce(h.context_snapshot->>'issueId',h.context_snapshot->>'taskId')::uuid END)=conversation
    AND i.conversation_agent_id=creator AND i.conversation_user_id=requester
    AND i.conversation_session_generation=generation
    AND coalesce(h.context_snapshot->>'conversationSessionGeneration','0')=generation::text)
$$;
--> statement-breakpoint
CREATE FUNCTION aw_notification_proposal_erased(company uuid, proposal uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM memory_deletion_markers m WHERE m.company_id=company AND m.kind='source'
   AND m.key='notification-preference-proposal-erasure:v1:'||proposal::text)
 OR coalesce((SELECT p.status='erased' OR aw_notification_proposal_origin_erased(company,p.source_run_id,
   p.created_by_agent_id,p.user_id,p.conversation_id,p.generation)
   FROM notification_preference_proposals p WHERE p.company_id=company AND p.id=proposal),true)
$$;
--> statement-breakpoint
CREATE FUNCTION aw_guard_notification_proposal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   INSERT INTO memory_deletion_markers(company_id,kind,key)
    VALUES(OLD.company_id,'source','notification-preference-proposal-erasure:v1:'||OLD.id::text) ON CONFLICT DO NOTHING;
   RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND (NEW.id,NEW.company_id,NEW.user_id,NEW.created_by_agent_id,NEW.source_run_id,
   NEW.conversation_id,NEW.generation,NEW.category,NEW.request_hash,NEW.baseline_hash)
   IS DISTINCT FROM (OLD.id,OLD.company_id,OLD.user_id,OLD.created_by_agent_id,OLD.source_run_id,
   OLD.conversation_id,OLD.generation,OLD.category,OLD.request_hash,OLD.baseline_hash) THEN
   RAISE EXCEPTION 'Notification proposal provenance is immutable' USING ERRCODE='23514';
 END IF;
 IF aw_notification_proposal_origin_erased(NEW.company_id,NEW.source_run_id,NEW.created_by_agent_id,
     NEW.user_id,NEW.conversation_id,NEW.generation)
   OR EXISTS(SELECT 1 FROM memory_deletion_markers m WHERE m.company_id=NEW.company_id AND m.kind='source'
    AND m.key='notification-preference-proposal-erasure:v1:'||NEW.id::text)
   OR NEW.status='erased' OR (TG_OP='UPDATE' AND OLD.status='erased') THEN
   NEW.preference:=NULL; NEW.status:='erased';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_notification_proposal_guard BEFORE INSERT OR UPDATE OR DELETE ON notification_preference_proposals
 FOR EACH ROW EXECUTE FUNCTION aw_guard_notification_proposal();
--> statement-breakpoint
CREATE FUNCTION aw_guard_notification_proposal_activity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.entity_type='notification_preference_proposal' AND NEW.entity_id
  ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND aw_notification_proposal_erased(NEW.company_id,NEW.entity_id::uuid) THEN
   NEW.details:='{"payloadDeleted":true}'::jsonb;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aw_notification_proposal_activity_guard BEFORE INSERT OR UPDATE ON activity_log
 FOR EACH ROW EXECUTE FUNCTION aw_guard_notification_proposal_activity();
