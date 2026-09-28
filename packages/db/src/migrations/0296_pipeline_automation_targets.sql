ALTER TABLE "pipeline_automation_executions" ADD COLUMN "target_kind" text;
--> statement-breakpoint
ALTER TABLE "pipeline_automation_executions" ADD COLUMN "target_ref" uuid;
--> statement-breakpoint
ALTER TABLE "pipeline_automation_executions" ADD COLUMN "workflow_run_id" uuid;
--> statement-breakpoint
UPDATE "pipeline_automation_executions"
SET
  "target_kind" = 'routine',
  "target_ref" = "routine_id"
WHERE "routine_id" IS NOT NULL
  AND "target_kind" IS NULL
  AND "target_ref" IS NULL;
--> statement-breakpoint
ALTER TABLE "pipeline_automation_executions" ALTER COLUMN "routine_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "pipeline_automation_executions"
ADD CONSTRAINT "pipeline_automation_executions_target_check" CHECK (
  (
    "target_kind" IS NULL
    AND "target_ref" IS NULL
    AND "routine_id" IS NOT NULL
  )
  OR (
    "target_kind" = 'routine'
    AND "target_ref" IS NOT NULL
    AND "routine_id" = "target_ref"
    AND "workflow_run_id" IS NULL
  )
  OR (
    "target_kind" = 'workflow'
    AND "target_ref" IS NOT NULL
    AND "routine_id" IS NULL
  )
);
--> statement-breakpoint
CREATE INDEX "pipeline_automation_executions_target_idx"
ON "pipeline_automation_executions" USING btree ("company_id","target_kind","target_ref");
--> statement-breakpoint
CREATE INDEX "pipeline_automation_executions_workflow_run_idx"
ON "pipeline_automation_executions" USING btree ("company_id","workflow_run_id");
--> statement-breakpoint
ALTER TABLE "pipeline_automation_executions"
ADD CONSTRAINT "pipeline_automation_executions_company_workflow_run_fk"
FOREIGN KEY ("company_id","workflow_run_id")
REFERENCES "public"."workflow_runs"("company_id","id")
ON DELETE NO ACTION ON UPDATE NO ACTION;
