-- Deployment upload limits are enforced by the staging owner. Match the
-- existing int-backed attachment size bound here, including configured limits.
CREATE OR REPLACE FUNCTION public.aw_native_current_attachment_stage_matches(
  p_profile jsonb, p_company_id uuid, p_run_id uuid, p_agent_id uuid, p_issue_id uuid, p_responsible_user text,
  p_bootstrap_inputs jsonb, p_dispatch_intent jsonb
) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE
  stages jsonb;
  stage jsonb;
  captures jsonb;
  attachment_inputs jsonb;
  capture_inputs jsonb;
  input_row jsonb;
  capture_row jsonb;
  source_snapshot jsonb;
  authority jsonb;
  expected_stage_hash text;
  stage_hash text;
BEGIN
  IF jsonb_typeof(p_profile) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_profile->'nativeExecutionInput') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_profile->'nativeExecutionInput'->'binding') IS DISTINCT FROM 'object'
    OR p_profile->'nativeExecutionInput'->'binding'->>'companyId' IS DISTINCT FROM p_company_id::text
    OR p_profile->'nativeExecutionInput'->'binding'->>'runId' IS DISTINCT FROM p_run_id::text
    OR p_profile->'nativeExecutionInput'->'binding'->>'agentId' IS DISTINCT FROM p_agent_id::text
    OR p_profile->'nativeExecutionInput'->'binding'->>'issueId' IS DISTINCT FROM p_issue_id::text
    OR jsonb_typeof(p_bootstrap_inputs) IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_dispatch_intent) IS DISTINCT FROM 'object' THEN
    RETURN false;
  END IF;
  SELECT coalesce(jsonb_agg(item.value ORDER BY item.ordinality), '[]'::jsonb) INTO attachment_inputs
    FROM jsonb_array_elements(p_bootstrap_inputs) WITH ORDINALITY item(value,ordinality)
    WHERE item.value->>'kind'='attachment';
  stages := p_profile->'nativeAttachmentStageSources';
  IF stages IS NULL THEN RETURN jsonb_array_length(attachment_inputs)=0; END IF;
  IF jsonb_typeof(stages) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(stages)=0 THEN RETURN jsonb_array_length(attachment_inputs)=0; END IF;
  IF jsonb_array_length(stages)<>1 OR jsonb_array_length(attachment_inputs)=0 THEN RETURN false; END IF;
  stage := stages->0;
  IF jsonb_typeof(stage) IS DISTINCT FROM 'object'
    OR NOT stage ?& ARRAY['eventSeq','attempt','responsibleUserId','baseTaskDigest','finalTaskDigest','sourceCaptureHash','descriptorHash','stageHash','sourceCaptures']
    OR stage-ARRAY['eventSeq','attempt','responsibleUserId','baseTaskDigest','finalTaskDigest','sourceCaptureHash','descriptorHash','stageHash','sourceCaptures','remoteStageReceipts']<>'{}'::jsonb
    OR (stage ? 'remoteStageReceipts' AND (jsonb_typeof(stage->'remoteStageReceipts') IS DISTINCT FROM 'array'
      OR jsonb_array_length(stage->'remoteStageReceipts')>20))
    OR jsonb_typeof(stage->'eventSeq') IS DISTINCT FROM 'number'
    OR jsonb_typeof(stage->'attempt') IS DISTINCT FROM 'number'
    OR stage->>'eventSeq' !~ '^[1-9][0-9]{0,9}$'
    OR stage->>'attempt' !~ '^[1-9][0-9]{0,9}$'
    OR (stage->>'eventSeq')::numeric>2147483647
    OR (stage->>'attempt')::numeric>2147483647
    OR stage->'eventSeq' IS DISTINCT FROM p_dispatch_intent->'eventSeq'
    OR stage->'attempt' IS DISTINCT FROM p_dispatch_intent->'attempt'
    OR stage->'responsibleUserId' IS DISTINCT FROM coalesce(to_jsonb(p_responsible_user),'null'::jsonb)
    OR p_dispatch_intent->>'responsibleUserId' IS DISTINCT FROM p_responsible_user
    OR jsonb_typeof(stage->'baseTaskDigest') IS DISTINCT FROM 'string'
    OR stage->>'baseTaskDigest' !~ '^[0-9a-f]{64}$'
    OR stage->>'baseTaskDigest' IS DISTINCT FROM encode(sha256(convert_to(public.aw_native_canonical_jsonb(p_profile->'nativeExecutionInput'->'task'),'UTF8')),'hex')
    OR jsonb_typeof(stage->'finalTaskDigest') IS DISTINCT FROM 'string'
    OR stage->>'finalTaskDigest' !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(stage->'sourceCaptureHash') IS DISTINCT FROM 'string'
    OR stage->>'sourceCaptureHash' !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(stage->'descriptorHash') IS DISTINCT FROM 'string'
    OR stage->>'descriptorHash' !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(stage->'stageHash') IS DISTINCT FROM 'string'
    OR stage->>'stageHash' !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(stage->'sourceCaptures') IS DISTINCT FROM 'array'
    OR jsonb_array_length(stage->'sourceCaptures') NOT BETWEEN 1 AND 64 THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.heartbeat_run_events event
      WHERE event.company_id=p_company_id AND event.run_id=p_run_id AND event.agent_id=p_agent_id
        AND event.seq=(stage->>'eventSeq')::integer AND event.event_type='native.process_start_requested')
    OR NOT EXISTS (SELECT 1 FROM public.native_run_finalizations finalization
      WHERE finalization.company_id=p_company_id AND finalization.run_id=p_run_id
        AND finalization.attempt=(stage->>'attempt')::integer AND finalization.lease_expires_at>clock_timestamp()) THEN
    RETURN false;
  END IF;
  captures := stage->'sourceCaptures';
  SELECT coalesce(jsonb_agg(capture.value->'input' ORDER BY capture.ordinality), '[]'::jsonb) INTO capture_inputs
    FROM jsonb_array_elements(captures) WITH ORDINALITY capture(value,ordinality);
  IF capture_inputs IS DISTINCT FROM attachment_inputs THEN RETURN false; END IF;
  FOR capture_row IN SELECT value FROM jsonb_array_elements(captures) LOOP
    input_row := capture_row->'input';
    source_snapshot := capture_row->'payloadSourceSnapshot';
    IF jsonb_typeof(capture_row) IS DISTINCT FROM 'object'
      OR capture_row-ARRAY['input','payloadSourceSnapshot']<>'{}'::jsonb
      OR jsonb_typeof(input_row) IS DISTINCT FROM 'object'
      OR NOT input_row ?& ARRAY['kind','issueId','attachmentId','commentId','assetId','sha256','byteSize','disposition']
      OR input_row-ARRAY['kind','issueId','attachmentId','commentId','assetId','sha256','byteSize','disposition']<>'{}'::jsonb
      OR input_row->>'kind' IS DISTINCT FROM 'attachment'
      OR input_row->>'issueId' IS DISTINCT FROM p_issue_id::text
      OR jsonb_typeof(input_row->'attachmentId') IS DISTINCT FROM 'string'
      OR input_row->>'attachmentId' !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      OR jsonb_typeof(input_row->'commentId') NOT IN ('string','null')
      OR (input_row->>'commentId' IS NOT NULL AND input_row->>'commentId' !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
      OR jsonb_typeof(input_row->'assetId') IS DISTINCT FROM 'string'
      OR input_row->>'assetId' !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      OR jsonb_typeof(input_row->'sha256') IS DISTINCT FROM 'string'
      OR input_row->>'sha256' !~ '^[0-9a-f]{64}$'
      OR jsonb_typeof(input_row->'byteSize') IS DISTINCT FROM 'number'
      OR (input_row->>'byteSize')::numeric<0 OR (input_row->>'byteSize')::numeric>2147483647
      OR input_row->>'disposition' IS DISTINCT FROM 'delivered'
      OR jsonb_typeof(source_snapshot) IS DISTINCT FROM 'object'
      OR source_snapshot->'version' IS DISTINCT FROM '1'::jsonb
      OR source_snapshot->'owner'->>'kind' IS DISTINCT FROM 'attachment'
      OR source_snapshot->'owner'->>'companyId' IS DISTINCT FROM p_company_id::text
      OR source_snapshot->'owner'->>'id' IS DISTINCT FROM input_row->>'attachmentId'
      OR source_snapshot->>'digest' IS DISTINCT FROM encode(sha256(convert_to((source_snapshot-'digest')::text,'UTF8')),'hex')
      OR NOT EXISTS (SELECT 1 FROM public.issue_attachments attachment
        JOIN public.assets asset ON asset.company_id=attachment.company_id AND asset.id=attachment.asset_id
        WHERE attachment.company_id=p_company_id AND attachment.issue_id=p_issue_id
          AND attachment.id=(input_row->>'attachmentId')::uuid
          AND attachment.issue_comment_id IS NOT DISTINCT FROM nullif(input_row->>'commentId','')::uuid
          AND attachment.asset_id=(input_row->>'assetId')::uuid
          AND attachment.payload_source_protocol_version=1 AND NOT attachment.payload_source_snapshot_invalidated
          AND attachment.payload_source_snapshot=source_snapshot
          AND asset.sha256=input_row->>'sha256' AND asset.byte_size=(input_row->>'byteSize')::integer) THEN
      RETURN false;
    END IF;
  END LOOP;
  IF stage->>'sourceCaptureHash' IS DISTINCT FROM encode(sha256(convert_to(public.aw_native_canonical_jsonb(captures),'UTF8')),'hex') THEN
    RETURN false;
  END IF;
  IF stage ? 'remoteStageReceipts' THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(stage->'remoteStageReceipts') receipt(value)
        WHERE jsonb_typeof(receipt.value) IS DISTINCT FROM 'object'
          OR NOT receipt.value ?& ARRAY['attachmentId','stageNonce','sha256','byteSize']
          OR receipt.value-ARRAY['attachmentId','stageNonce','sha256','byteSize']<>'{}'::jsonb
          OR jsonb_typeof(receipt.value->'attachmentId') IS DISTINCT FROM 'string'
          OR receipt.value->>'attachmentId' !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
          OR jsonb_typeof(receipt.value->'stageNonce') IS DISTINCT FROM 'string'
          OR receipt.value->>'stageNonce' !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
          OR jsonb_typeof(receipt.value->'sha256') IS DISTINCT FROM 'string'
          OR receipt.value->>'sha256' !~ '^[0-9a-f]{64}$'
          OR jsonb_typeof(receipt.value->'byteSize') IS DISTINCT FROM 'number'
          OR (receipt.value->>'byteSize')::numeric<1 OR (receipt.value->>'byteSize')::numeric>2147483647
          OR trunc((receipt.value->>'byteSize')::numeric)<>(receipt.value->>'byteSize')::numeric
          OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(captures) captured(value)
            WHERE captured.value->'input'->>'kind'='attachment'
              AND captured.value->'input'->>'attachmentId'=receipt.value->>'attachmentId'
              AND captured.value->'input'->>'disposition'='delivered'
              AND captured.value->'input'->>'sha256'=receipt.value->>'sha256'
              AND captured.value->'input'->'byteSize'=receipt.value->'byteSize'))
      OR (SELECT count(*) FROM jsonb_array_elements(stage->'remoteStageReceipts')) <>
         (SELECT count(DISTINCT value->>'attachmentId') FROM jsonb_array_elements(stage->'remoteStageReceipts'))
      OR (SELECT count(*) FROM jsonb_array_elements(stage->'remoteStageReceipts')) <>
         (SELECT count(DISTINCT value->>'stageNonce') FROM jsonb_array_elements(stage->'remoteStageReceipts')) THEN
      RETURN false;
    END IF;
    stage_hash := encode(sha256(convert_to(public.aw_native_canonical_jsonb(jsonb_build_object(
      'eventSeq',stage->'eventSeq','attempt',stage->'attempt','responsibleUserId',stage->'responsibleUserId',
      'baseTaskDigest',stage->'baseTaskDigest','finalTaskDigest',stage->'finalTaskDigest',
      'sourceCaptureHash',stage->'sourceCaptureHash','descriptorHash',stage->'descriptorHash',
      'remoteStageReceipts',stage->'remoteStageReceipts')),'UTF8')),'hex');
  ELSE
    stage_hash := encode(sha256(convert_to(public.aw_native_canonical_jsonb(jsonb_build_object(
      'eventSeq',stage->'eventSeq','attempt',stage->'attempt','responsibleUserId',stage->'responsibleUserId',
      'baseTaskDigest',stage->'baseTaskDigest','finalTaskDigest',stage->'finalTaskDigest',
      'sourceCaptureHash',stage->'sourceCaptureHash','descriptorHash',stage->'descriptorHash')),'UTF8')),'hex');
  END IF;
  IF stage_hash IS DISTINCT FROM stage->>'stageHash' THEN RETURN false; END IF;
  authority := p_profile->'nativeOpenCodeSourceAuthority';
  IF jsonb_typeof(authority)='object' AND authority->'version'='1'::jsonb
    AND (authority->>'executionInputHash' IS DISTINCT FROM encode(sha256(convert_to(public.aw_native_canonical_jsonb(p_profile->'nativeExecutionInput'),'UTF8')),'hex')
      OR authority->>'attachmentStageHash' IS DISTINCT FROM stage->>'stageHash') THEN
    RETURN false;
  END IF;
  RETURN true;
EXCEPTION WHEN others THEN
  RETURN false;
END;
$$;
