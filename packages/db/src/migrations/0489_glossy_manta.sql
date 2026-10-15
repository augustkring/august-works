CREATE INDEX "routine_revisions_company_authoring_run_idx" ON "routine_revisions" USING btree ("company_id","created_by_run_id");
--> statement-breakpoint
-- Conversation-only routines retain the actual source run after any Human
-- revision. This is erasure closure, never a reader or execution grant.
CREATE FUNCTION aw_conversation_routine_origin_erased(company uuid, origin text, creator uuid, requester text)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN h.id IS NULL OR i.id IS NULL OR h.agent_id IS DISTINCT FROM creator
     OR h.responsible_user_id IS DISTINCT FROM requester OR requester IS NULL
     OR i.conversation_agent_id IS DISTINCT FROM h.agent_id OR i.conversation_user_id IS DISTINCT FROM requester
     OR i.conversation_retired_at IS NOT NULL OR i.origin_kind='routine_execution' THEN true
   ELSE aw_workflow_memory_erased(company,h.id,i.id) END
 FROM (SELECT 1) anchor LEFT JOIN heartbeat_runs h ON h.company_id=company AND h.id=CASE
   WHEN origin ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN origin::uuid ELSE NULL END
 LEFT JOIN issues i ON i.company_id=h.company_id AND i.id=coalesce(h.native_issue_id,CASE
   WHEN coalesce(h.context_snapshot->>'issueId',h.context_snapshot->>'taskId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   THEN coalesce(h.context_snapshot->>'issueId',h.context_snapshot->>'taskId')::uuid ELSE NULL END)
$$;
--> statement-breakpoint
CREATE FUNCTION aw_conversation_routine_source_erased(company uuid, routine uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce((SELECT CASE WHEN r.origin_kind<>'conversation_draft' THEN false ELSE
   aw_conversation_routine_origin_erased(company,r.origin_id,r.created_by_agent_id,r.responsible_user_id) END
   FROM routines r WHERE r.company_id=company AND r.id=routine),true)
$$;
--> statement-breakpoint
-- Actual Routine execution tasks use the routine's current source owner.
CREATE FUNCTION aw_routine_execution_source_erased(company uuid, task uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce((SELECT CASE WHEN i.origin_kind<>'routine_execution' THEN false ELSE
   aw_conversation_routine_source_erased(company,CASE
     WHEN i.origin_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN i.origin_id::uuid ELSE NULL END)
   END FROM issues i WHERE i.company_id=company AND i.id=task),false)
$$;
--> statement-breakpoint
-- Preserve direct and Native task owners; inherited tasks also retain actual
-- Routine-source closure without recursive model-selected graph evaluation.
CREATE OR REPLACE FUNCTION aw_workflow_memory_erased(company uuid, execution uuid, task uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT aw_workflow_memory_erased_direct(company,execution,task)
 OR EXISTS(SELECT 1 FROM aw_runner_task_source_chain(company,execution,task) s
   WHERE s.invalid OR aw_workflow_memory_erased_direct(company,s.source_run_id,s.source_task_id)
     OR aw_routine_execution_source_erased(company,s.source_task_id))
 OR aw_routine_execution_source_erased(company,coalesce(task,(SELECT coalesce(h.native_issue_id,CASE
   WHEN coalesce(h.context_snapshot->>'issueId',h.context_snapshot->>'taskId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   THEN coalesce(h.context_snapshot->>'issueId',h.context_snapshot->>'taskId')::uuid ELSE NULL END)
   FROM heartbeat_runs h WHERE h.company_id=company AND h.id=execution)))
$$;

--> statement-breakpoint
-- Restore/late writers cannot put private routine payloads back after source
-- erasure. Existing IDs and Native revision identities remain as provenance.
CREATE FUNCTION aw_erase_conversation_routine_payload() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent uuid; lost boolean; doc uuid;
BEGIN
 IF TG_TABLE_NAME='routines' THEN
   lost := NEW.origin_kind='conversation_draft' AND aw_conversation_routine_origin_erased(NEW.company_id,NEW.origin_id,NEW.created_by_agent_id,NEW.responsible_user_id);
   IF lost THEN NEW.title:='Source-erased routine'; NEW.description:=NULL; NEW.variables:='[]'::jsonb; NEW.env:=NULL; NEW.status:='paused'; END IF;
 ELSIF TG_TABLE_NAME='routine_revisions' THEN
   IF aw_conversation_routine_source_erased(NEW.company_id,NEW.routine_id) THEN
     NEW.title:='Source-erased routine'; NEW.description:=NULL; NEW.change_summary:=NULL;
     NEW.snapshot:=jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(NEW.snapshot,'{routine,title}','"Source-erased routine"'::jsonb),'{routine,description}','null'::jsonb),'{routine,variables}','[]'::jsonb),'{routine,env}','null'::jsonb),'{routine,status}','"paused"'::jsonb),'{triggers}','[]'::jsonb);
   END IF;
 ELSIF TG_TABLE_NAME='routine_triggers' THEN
   IF aw_conversation_routine_source_erased(NEW.company_id,NEW.routine_id) THEN NEW.enabled:=false; NEW.next_run_at:=NULL; NEW.label:=NULL; NEW.last_result:=NULL; NEW.last_webhook_delivery:=NULL; END IF;
 ELSIF TG_TABLE_NAME='routine_runs' THEN
   IF aw_conversation_routine_source_erased(NEW.company_id,NEW.routine_id) THEN NEW.trigger_payload:=NULL; NEW.failure_reason:='source_erased'; END IF;
 ELSIF TG_TABLE_NAME='activity_log' THEN
   IF NEW.entity_type='routine' THEN parent:=CASE WHEN NEW.entity_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN NEW.entity_id::uuid ELSE NULL END;
   ELSIF NEW.entity_type='routine_trigger' THEN
     SELECT t.routine_id INTO parent FROM routine_triggers t WHERE t.company_id=NEW.company_id AND t.id=CASE
       WHEN NEW.entity_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN NEW.entity_id::uuid ELSE NULL END;
   END IF;
   IF parent IS NOT NULL AND EXISTS(SELECT 1 FROM routines r WHERE r.company_id=NEW.company_id AND r.id=parent AND r.origin_kind='conversation_draft')
      AND aw_conversation_routine_source_erased(NEW.company_id,parent) THEN NEW.details:='{"payloadDeleted":true}'::jsonb; END IF;
 ELSIF TG_TABLE_NAME='routine_documents' THEN
   IF aw_conversation_routine_source_erased(NEW.company_id,NEW.routine_id) THEN
     UPDATE documents SET title='Source-erased routine document',latest_body='' WHERE company_id=NEW.company_id AND id=NEW.document_id;
     UPDATE document_revisions SET title=NULL,body='',change_summary=NULL WHERE company_id=NEW.company_id AND document_id=NEW.document_id;
   END IF;
 ELSIF TG_TABLE_NAME IN ('documents','document_revisions') THEN
   IF TG_TABLE_NAME='documents' THEN doc:=NEW.id; ELSE doc:=NEW.document_id; END IF;
   lost:=EXISTS(SELECT 1 FROM routine_documents d WHERE d.company_id=NEW.company_id AND d.document_id=doc AND aw_conversation_routine_source_erased(NEW.company_id,d.routine_id));
   IF lost THEN
     IF TG_TABLE_NAME='documents' THEN NEW.title:='Source-erased routine document'; NEW.latest_body:='';
     ELSE NEW.title:=NULL; NEW.body:=''; NEW.change_summary:=NULL; END IF;
   END IF;
 END IF;
 RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE TRIGGER aw_conversation_routine_source_guard BEFORE INSERT OR UPDATE ON routines FOR EACH ROW EXECUTE FUNCTION aw_erase_conversation_routine_payload();

--> statement-breakpoint
CREATE TRIGGER aw_conversation_routine_source_guard BEFORE INSERT OR UPDATE ON routine_revisions FOR EACH ROW EXECUTE FUNCTION aw_erase_conversation_routine_payload();

--> statement-breakpoint
CREATE TRIGGER aw_conversation_routine_source_guard BEFORE INSERT OR UPDATE ON routine_triggers FOR EACH ROW EXECUTE FUNCTION aw_erase_conversation_routine_payload();

--> statement-breakpoint
CREATE TRIGGER aw_conversation_routine_source_guard BEFORE INSERT OR UPDATE ON routine_runs FOR EACH ROW EXECUTE FUNCTION aw_erase_conversation_routine_payload();

--> statement-breakpoint
CREATE TRIGGER aw_conversation_routine_source_guard BEFORE INSERT OR UPDATE ON routine_documents FOR EACH ROW EXECUTE FUNCTION aw_erase_conversation_routine_payload();

--> statement-breakpoint
CREATE TRIGGER aw_conversation_routine_source_guard BEFORE INSERT OR UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION aw_erase_conversation_routine_payload();

--> statement-breakpoint
CREATE TRIGGER aw_conversation_routine_source_guard BEFORE INSERT OR UPDATE ON document_revisions FOR EACH ROW EXECUTE FUNCTION aw_erase_conversation_routine_payload();

--> statement-breakpoint
CREATE TRIGGER aw_conversation_routine_source_guard BEFORE INSERT OR UPDATE ON activity_log FOR EACH ROW EXECUTE FUNCTION aw_erase_conversation_routine_payload();
