ALTER TABLE "routines" ADD COLUMN "execution_target_kind" text;
--> statement-breakpoint
ALTER TABLE "routines" ADD COLUMN "execution_target_ref" uuid;
--> statement-breakpoint
ALTER TABLE "routine_runs" ADD COLUMN "linked_workflow_run_id" uuid;
--> statement-breakpoint
UPDATE "routines"
SET
  "execution_target_kind" = 'agent_task',
  "execution_target_ref" = "assignee_agent_id"
WHERE "assignee_agent_id" IS NOT NULL
  AND "execution_target_kind" IS NULL
  AND "execution_target_ref" IS NULL;
--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_execution_target_pair_check" CHECK (
  ("execution_target_kind" IS NULL AND "execution_target_ref" IS NULL)
  OR
  ("execution_target_kind" IN ('agent_task', 'workflow') AND "execution_target_ref" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX "routines_company_execution_target_idx"
ON "routines" USING btree ("company_id","execution_target_kind","execution_target_ref");
--> statement-breakpoint
ALTER TABLE "workflow_runs"
ADD CONSTRAINT "workflow_runs_company_id_uq" UNIQUE("company_id","id");
--> statement-breakpoint
ALTER TABLE "routine_runs"
ADD CONSTRAINT "routine_runs_company_linked_workflow_run_fk"
FOREIGN KEY ("company_id","linked_workflow_run_id")
REFERENCES "public"."workflow_runs"("company_id","id")
ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE INDEX "routine_runs_linked_workflow_run_idx"
ON "routine_runs" USING btree ("company_id","linked_workflow_run_id");
