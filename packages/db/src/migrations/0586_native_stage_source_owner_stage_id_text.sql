-- MS1f phase 4. aw_issue_native_stage_source_owner() (0571) compared the
-- uuid issue_execution_decisions.stage_id with the text
-- OLD.execution_state->>'currentStageId', so PostgreSQL raised "operator does
-- not exist: uuid = text" whenever a Native stage Reviewer's approving comment
-- transformed the Task source. The function is otherwise byte-for-byte 0571's.
CREATE OR REPLACE FUNCTION public.aw_issue_native_stage_source_owner() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE old_steps jsonb; new_steps jsonb; step jsonb; receipt jsonb; producer public.heartbeat_runs%ROWTYPE;
  n integer; receipt_key text;
BEGIN
  old_steps:=coalesce(OLD.payload_source_snapshot->'transforms','[]'::jsonb);
  new_steps:=coalesce(NEW.payload_source_snapshot->'transforms','[]'::jsonb);
  IF old_steps IS NOT DISTINCT FROM new_steps OR NEW.payload_source_snapshot IS NULL THEN RETURN NULL; END IF;
  n:=jsonb_array_length(old_steps);
  step:=new_steps->n;
  IF step->>'kind' IS DISTINCT FROM 'native_stage_policy' THEN RETURN NULL; END IF;
  SELECT * INTO producer FROM public.heartbeat_runs r WHERE r.id=(step->>'runId')::uuid AND
    r.company_id=NEW.company_id AND r.native_issue_id=NEW.id AND r.runtime_mode='native';
  receipt:=producer.result_json->'nativeStageTaskBodyTransitions'->(step->>'transitionId');
  IF producer.id IS NULL OR producer.responsible_user_id IS NULL OR receipt IS NULL OR
    (CASE WHEN jsonb_typeof(receipt)='object' THEN (SELECT count(*) FROM jsonb_object_keys(receipt)) ELSE -1 END)<>20 OR
    NOT (receipt ?& ARRAY['version','companyId','issueId','runId','agentId','responsibleUserId',
      'transitionId','owner','originalInputReceiptDigest','originalDispatchCount','originalAdditionalInputCount','executionInputDigest',
      'originalSnapshot','previousOwnerContentHash','nextOwnerContentHash','fromExecutionState','toExecutionState',
      'fromUnblockDescriptor','toUnblockDescriptor','ownerFingerprint']) OR
    jsonb_typeof(receipt->'originalDispatchCount') IS DISTINCT FROM 'number' OR
    jsonb_typeof(receipt->'originalAdditionalInputCount') IS DISTINCT FROM 'number' OR
    (CASE WHEN (receipt->>'originalDispatchCount') ~ '^(0|[1-9][0-9]{0,2})$'
      THEN (receipt->>'originalDispatchCount')::integer ELSE -1 END) NOT BETWEEN 0 AND 64 OR
    (CASE WHEN (receipt->>'originalAdditionalInputCount') ~ '^(0|[1-9][0-9]{0,2})$'
      THEN (receipt->>'originalAdditionalInputCount')::integer ELSE -1 END) NOT BETWEEN 0 AND 256 OR
    (CASE WHEN jsonb_typeof(producer.runner_profile_json->'nativeInputSourceReceipt'->'dispatches')='array'
      THEN jsonb_array_length(producer.runner_profile_json->'nativeInputSourceReceipt'->'dispatches') ELSE -1 END) < 0 OR
    (CASE WHEN jsonb_typeof(producer.runner_profile_json->'nativeInputSourceReceipt'->'additionalInputs')='array'
      THEN jsonb_array_length(producer.runner_profile_json->'nativeInputSourceReceipt'->'additionalInputs') ELSE -1 END) < 0 OR
    (CASE WHEN (receipt->>'originalDispatchCount') ~ '^(0|[1-9][0-9]{0,2})$'
      THEN (receipt->>'originalDispatchCount')::integer ELSE -1 END) IS DISTINCT FROM
      (CASE WHEN jsonb_typeof(producer.runner_profile_json->'nativeInputSourceReceipt'->'dispatches')='array'
        THEN jsonb_array_length(producer.runner_profile_json->'nativeInputSourceReceipt'->'dispatches') ELSE -1 END) OR
    (CASE WHEN (receipt->>'originalAdditionalInputCount') ~ '^(0|[1-9][0-9]{0,2})$'
      THEN (receipt->>'originalAdditionalInputCount')::integer ELSE -1 END) IS DISTINCT FROM
      (CASE WHEN jsonb_typeof(producer.runner_profile_json->'nativeInputSourceReceipt'->'additionalInputs')='array'
        THEN jsonb_array_length(producer.runner_profile_json->'nativeInputSourceReceipt'->'additionalInputs') ELSE -1 END) OR
    step->>'receiptHash' IS DISTINCT FROM encode(sha256(convert_to(receipt::text,'UTF8')),'hex') OR
    receipt->>'version' IS DISTINCT FROM '1' OR receipt->>'companyId' IS DISTINCT FROM NEW.company_id::text OR
    receipt->>'issueId' IS DISTINCT FROM NEW.id::text OR receipt->>'runId' IS DISTINCT FROM producer.id::text OR
    receipt->>'agentId' IS DISTINCT FROM producer.agent_id::text OR
    receipt->>'responsibleUserId' IS DISTINCT FROM producer.responsible_user_id OR
    receipt->>'transitionId' IS DISTINCT FROM step->>'transitionId' OR
    receipt->'owner'->>'kind' IS DISTINCT FROM step->>'ownerKind' OR
    receipt->'owner'->>'decisionId' IS DISTINCT FROM step->>'decisionId' OR
    receipt->'owner'->>'runId' IS DISTINCT FROM producer.id::text OR
    receipt->'originalSnapshot' IS DISTINCT FROM OLD.payload_source_snapshot OR
    receipt->>'previousOwnerContentHash' IS DISTINCT FROM step->>'previousOwnerContentHash' OR
    receipt->>'nextOwnerContentHash' IS DISTINCT FROM step->>'nextOwnerContentHash' OR
    receipt->'fromExecutionState' IS DISTINCT FROM coalesce(OLD.execution_state,'null'::jsonb) OR
    receipt->'toExecutionState' IS DISTINCT FROM coalesce(NEW.execution_state,'null'::jsonb) OR
    receipt->'fromUnblockDescriptor' IS DISTINCT FROM coalesce(OLD.unblock_descriptor,'null'::jsonb) OR
    receipt->'toUnblockDescriptor' IS DISTINCT FROM coalesce(NEW.unblock_descriptor,'null'::jsonb) OR
    receipt->>'originalInputReceiptDigest' IS DISTINCT FROM producer.runner_profile_json->'nativeInputSourceReceipt'->>'digest' OR
    receipt->>'executionInputDigest' IS DISTINCT FROM producer.runner_profile_json->'nativeInputSourceReceipt'->'bootstrap'->>'executionInputDigest' OR
    producer.runner_profile_json->'nativeBootstrapTaskSource'->'payloadSourceSnapshot' IS DISTINCT FROM OLD.payload_source_snapshot OR
    producer.runner_profile_json->'nativeBootstrapTaskSource'->'input'->>'kind' IS DISTINCT FROM 'task' OR
    producer.runner_profile_json->'nativeBootstrapTaskSource'->'input'->>'issueId' IS DISTINCT FROM NEW.id::text OR
    producer.runner_profile_json->'nativeBootstrapTaskSource'->'input'->>'contentHash' IS DISTINCT FROM step->>'previousOwnerContentHash' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native Stage source is not bound to its actual producer receipt';
  END IF;
  IF step->>'ownerKind'='native_status_decision' THEN
    IF NEW.last_status_decision_id::text IS DISTINCT FROM step->>'decisionId' OR NOT EXISTS (
      SELECT 1 FROM public.status_decisions d
      JOIN public.native_run_finalizations f ON f.company_id=d.company_id AND f.issue_id=d.issue_id AND
        f.run_id=d.run_id AND f.decision_id=d.id AND f.assessment_id=d.assessment_id AND f.phase='committed'
      JOIN public.native_run_results r ON r.company_id=f.company_id AND r.issue_id=f.issue_id AND
        r.run_id=f.run_id AND r.id=f.result_id AND r.schema_status='accepted'
      JOIN public.work_assessments a ON a.company_id=d.company_id AND a.issue_id=d.issue_id AND
        a.run_id=d.run_id AND a.id=d.assessment_id AND a.result_id=r.id AND a.contract_id=r.completion_contract_id
      JOIN public.status_decision_effects e ON e.company_id=d.company_id AND e.issue_id=d.issue_id AND
        e.decision_id=d.id AND e.effect_kind='execution_stage_wake' AND e.target_type='agent_wakeup_request'
      JOIN public.agent_wakeup_requests w ON w.company_id=e.company_id AND w.id::text=e.target_id AND
        w.requested_by_actor_type='agent' AND w.requested_by_actor_id=producer.agent_id::text AND
        w.idempotency_key='issue.execution_stage:'||NEW.id::text||':'||d.id::text
      WHERE d.company_id=NEW.company_id AND d.issue_id=NEW.id AND d.run_id=producer.id AND
        d.id::text=step->>'decisionId' AND d.application_state='applied' AND d.applied_at IS NOT NULL AND
        d.reason_code='execution_policy_stage_pending' AND d.to_status='in_review' AND
        d.decision_json->'unblockDescriptor' IS NOT DISTINCT FROM coalesce(NEW.unblock_descriptor,'null'::jsonb) AND
        e.payload->'executionStage' IS NOT DISTINCT FROM w.payload->'executionStage' AND
        w.agent_id::text=NEW.execution_state->'currentParticipant'->>'agentId' AND
        w.payload->'executionStage'->>'stageId' IS NOT DISTINCT FROM NEW.execution_state->>'currentStageId'
    ) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native Stage source lacks its applied entry decision and wake effect'; END IF;
  ELSE
    receipt_key:=encode(sha256(convert_to(receipt->'owner'->'effect'->>'callId','UTF8')),'hex');
    IF NOT EXISTS (
      SELECT 1 FROM public.issue_execution_decisions d JOIN public.issue_comments c ON c.company_id=d.company_id AND
        c.issue_id=d.issue_id AND c.id::text=receipt->'owner'->>'commentId' AND c.created_by_run_id=producer.id AND
        c.author_agent_id=producer.agent_id AND c.author_user_id IS NULL AND c.author_type='agent' AND c.deleted_at IS NULL
      WHERE d.company_id=NEW.company_id AND d.issue_id=NEW.id AND d.created_by_run_id=producer.id AND
        d.actor_agent_id=producer.agent_id AND d.actor_user_id IS NULL AND d.id::text=step->>'decisionId' AND
        d.id::text=NEW.execution_state->>'lastDecisionId' AND d.outcome=NEW.execution_state->>'lastDecisionOutcome' AND
        d.stage_id::text IS NOT DISTINCT FROM OLD.execution_state->>'currentStageId' AND
        (CASE WHEN jsonb_typeof(producer.result_json->'nativeStagePolicyTransitions'->receipt_key)='object'
          THEN (SELECT count(*) FROM jsonb_object_keys(producer.result_json->'nativeStagePolicyTransitions'->receipt_key)) ELSE -1 END)=19 AND
        (producer.result_json->'nativeStagePolicyTransitions'->receipt_key) ?& ARRAY['version','origin','companyId','issueId','runId','agentId',
          'responsibleUserId','originalReceiptDigest','originalDispatchCount','originalAdditionalInputCount','executionInputDigest',
          'stageSource','effect','fromState','toState','stageDecisionId','stageDecisionHash','commentId','commentHash'] AND
        producer.result_json->'nativeStagePolicyTransitions'->receipt_key->>'stageDecisionId'=d.id::text AND
        producer.result_json->'nativeStagePolicyTransitions'->receipt_key->>'originalReceiptDigest' IS NOT DISTINCT FROM receipt->>'originalInputReceiptDigest' AND
        producer.result_json->'nativeStagePolicyTransitions'->receipt_key->>'originalDispatchCount' IS NOT DISTINCT FROM receipt->>'originalDispatchCount' AND
        producer.result_json->'nativeStagePolicyTransitions'->receipt_key->>'originalAdditionalInputCount' IS NOT DISTINCT FROM receipt->>'originalAdditionalInputCount' AND
        producer.result_json->'nativeStagePolicyTransitions'->receipt_key->'effect' IS NOT DISTINCT FROM receipt->'owner'->'effect' AND
        producer.result_json->'nativeStagePolicyTransitions'->receipt_key->'toState' IS NOT DISTINCT FROM NEW.execution_state
    ) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Native Stage source lacks its actual approval-comment effect'; END IF;
  END IF;
  RETURN NULL;
END;
$$;
