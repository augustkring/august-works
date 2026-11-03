CREATE TABLE "support_case_deletion_markers" (
	"subject_id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"erased_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retain_until" timestamp with time zone NOT NULL,
	CONSTRAINT "support_case_deletion_markers_target_check" CHECK (("support_case_deletion_markers"."target_kind"='case' and "support_case_deletion_markers"."subject_id"="support_case_deletion_markers"."case_id") or ("support_case_deletion_markers"."target_kind"='event' and "support_case_deletion_markers"."subject_id"<>"support_case_deletion_markers"."case_id")),
	CONSTRAINT "support_case_deletion_markers_horizon_check" CHECK ("support_case_deletion_markers"."retain_until">"support_case_deletion_markers"."erased_at")
);
--> statement-breakpoint
CREATE TABLE "support_case_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"author_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"customer_status" text NOT NULL,
	"safe_context" jsonb,
	"request_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"delivery_state" text DEFAULT 'pending' NOT NULL,
	"delivery_attempt_id" uuid,
	"delivery_provider_key" text,
	"delivery_started_at" timestamp with time zone,
	"delivery_lease_until" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"provider_message_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_case_events_kind_check" CHECK ("support_case_events"."kind" in ('request','customer_reply','support_message','status_change','resolution')),
	CONSTRAINT "support_case_events_body_check" CHECK (length(trim("support_case_events"."body")) between 1 and 10000),
	CONSTRAINT "support_case_events_status_check" CHECK ("support_case_events"."customer_status" in ('RECEIVED','INVESTIGATING','WORKING_ON_IT','WAITING_FOR_YOU','RESOLVED','CLOSED')),
	CONSTRAINT "support_case_events_hash_check" CHECK ("support_case_events"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "support_case_events_delivery_check" CHECK ("support_case_events"."delivery_state" in ('pending','sending','delivered','unknown','not_required') and
    (("support_case_events"."delivery_state"='delivered' and "support_case_events"."delivered_at" is not null and "support_case_events"."delivery_attempt_id" is not null and "support_case_events"."delivery_provider_key" is not null and "support_case_events"."provider_message_ref" is not null) or ("support_case_events"."delivery_state"<>'delivered' and "support_case_events"."delivered_at" is null)) and
    ("support_case_events"."delivery_state"<>'sending' or ("support_case_events"."delivery_attempt_id" is not null and "support_case_events"."delivery_provider_key" is not null and "support_case_events"."delivery_started_at" is not null and "support_case_events"."delivery_lease_until" is not null)))
);
--> statement-breakpoint
CREATE TABLE "support_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"opened_by_user_id" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"subject" text NOT NULL,
	"description" text NOT NULL,
	"impact" text,
	"safe_context" jsonb,
	"follow_up_of_id" uuid,
	"customer_status" text DEFAULT 'RECEIVED' NOT NULL,
	"requested_response" text,
	"version" integer DEFAULT 0 NOT NULL,
	"data_policy" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"hold_reason" text,
	"hold_release_at" timestamp with time zone,
	"provider_case_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "support_cases_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "support_cases_category_check" CHECK ("support_cases"."category" in ('not_working','access','apps_connections','account_billing','using_blentera','other')),
	CONSTRAINT "support_cases_impact_check" CHECK ("support_cases"."impact" is null or "support_cases"."impact" in ('blocked','limited','question')),
	CONSTRAINT "support_cases_status_check" CHECK ("support_cases"."customer_status" in ('RECEIVED','INVESTIGATING','WORKING_ON_IT','WAITING_FOR_YOU','RESOLVED','CLOSED')),
	CONSTRAINT "support_cases_text_check" CHECK (length(trim("support_cases"."subject")) between 1 and 200 and length(trim("support_cases"."description")) between 1 and 10000),
	CONSTRAINT "support_cases_response_check" CHECK (("support_cases"."customer_status"='WAITING_FOR_YOU' and "support_cases"."requested_response" is not null and length(trim("support_cases"."requested_response")) between 1 and 10000) or ("support_cases"."customer_status"<>'WAITING_FOR_YOU' and "support_cases"."requested_response" is null)),
	CONSTRAINT "support_cases_hold_check" CHECK (("support_cases"."legal_hold" and "support_cases"."hold_reason" is not null and length(trim("support_cases"."hold_reason")) between 1 and 1000) or (not "support_cases"."legal_hold" and "support_cases"."hold_reason" is null and "support_cases"."hold_release_at" is null)),
	CONSTRAINT "support_cases_version_check" CHECK ("support_cases"."version">=0),
	CONSTRAINT "support_cases_follow_up_check" CHECK ("support_cases"."follow_up_of_id" is null or "support_cases"."follow_up_of_id"<>"support_cases"."id")
);
--> statement-breakpoint
ALTER TABLE "support_case_events" ADD CONSTRAINT "support_case_events_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_case_events" ADD CONSTRAINT "support_case_events_company_id_case_id_support_cases_company_id_id_fk" FOREIGN KEY ("company_id","case_id") REFERENCES "public"."support_cases"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_opened_by_user_id_user_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_company_id_follow_up_of_id_support_cases_company_id_id_fk" FOREIGN KEY ("company_id","follow_up_of_id") REFERENCES "public"."support_cases"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_case_deletion_markers_company_idx" ON "support_case_deletion_markers" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "support_case_deletion_markers_case_idx" ON "support_case_deletion_markers" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "support_case_deletion_markers_horizon_idx" ON "support_case_deletion_markers" USING btree ("retain_until");--> statement-breakpoint
CREATE UNIQUE INDEX "support_case_events_company_id_idx" ON "support_case_events" USING btree ("company_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_case_events_request_idx" ON "support_case_events" USING btree ("company_id","author_user_id","request_key");--> statement-breakpoint
CREATE INDEX "support_case_events_case_created_idx" ON "support_case_events" USING btree ("company_id","case_id","created_at","id");--> statement-breakpoint
CREATE INDEX "support_case_events_delivery_idx" ON "support_case_events" USING btree ("delivery_state","created_at");--> statement-breakpoint
CREATE INDEX "support_cases_company_created_idx" ON "support_cases" USING btree ("company_id","created_at","id");--> statement-breakpoint
CREATE INDEX "support_cases_opener_idx" ON "support_cases" USING btree ("opened_by_user_id","company_id");--> statement-breakpoint
CREATE INDEX "support_cases_expiry_idx" ON "support_cases" USING btree ("expires_at");
--> statement-breakpoint
-- Native support policy and erasure invariants. Configuration is not delivery,
-- permission or release proof. Customer DTOs never expose private policy/hold data.
CREATE FUNCTION public.aw_support_case_policy_valid(policy jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE field_name text;
BEGIN
  IF policy IS NULL OR jsonb_typeof(policy)<>'object' OR octet_length(policy::text)>16384 THEN RETURN false; END IF;
  IF NOT policy ?& ARRAY['schemaVersion','policyVersion','recipientName','privacyNoticeUrl','processingRegion',
    'retentionTrigger','retentionDays','backupMaxDays','restoreLagDays','deletionMarkerDays','legalHoldPolicyId']
    OR (SELECT count(*) FROM jsonb_object_keys(policy))<>11 THEN RETURN false; END IF;
  IF policy->'schemaVersion'<>'1'::jsonb THEN RETURN false; END IF;
  FOREACH field_name IN ARRAY ARRAY['policyVersion','recipientName','privacyNoticeUrl','processingRegion','retentionTrigger','legalHoldPolicyId'] LOOP
    IF jsonb_typeof(policy->field_name)<>'string' OR policy->>field_name ~ '[[:cntrl:]]' THEN RETURN false; END IF;
  END LOOP;
  IF policy->>'policyVersion' !~ '^[a-z][a-z0-9_.-]{0,127}$'
    OR policy->>'legalHoldPolicyId' !~ '^[a-z][a-z0-9_.-]{0,127}$'
    OR length(trim(policy->>'recipientName')) NOT BETWEEN 1 AND 255
    OR length(trim(policy->>'processingRegion')) NOT BETWEEN 1 AND 100
    OR length(policy->>'privacyNoticeUrl')>2048
    OR policy->>'privacyNoticeUrl' !~ '^https://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$'
    OR policy->>'retentionTrigger'<>'after_last_customer_or_support_message' THEN RETURN false; END IF;
  FOREACH field_name IN ARRAY ARRAY['retentionDays','backupMaxDays','restoreLagDays','deletionMarkerDays'] LOOP
    IF jsonb_typeof(policy->field_name)<>'number' OR policy->>field_name !~ '^[0-9]{1,6}$' THEN RETURN false; END IF;
  END LOOP;
  RETURN (policy->>'retentionDays')::integer BETWEEN 1 AND 36500
    AND (policy->>'backupMaxDays')::integer BETWEEN 1 AND 36500
    AND (policy->>'restoreLagDays')::integer BETWEEN 0 AND 36500
    AND (policy->>'deletionMarkerDays')::integer BETWEEN 1 AND 109500
    AND (policy->>'deletionMarkerDays')::integer >= (policy->>'backupMaxDays')::integer+(policy->>'restoreLagDays')::integer;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $$;
--> statement-breakpoint
ALTER TABLE support_cases ADD CONSTRAINT support_cases_policy_check
  CHECK (public.aw_support_case_policy_valid(data_policy));
--> statement-breakpoint
CREATE FUNCTION public.aw_support_case_marker(record_id uuid, tenant_id uuid, root_id uuid, record_kind text,
  erased_time timestamptz, horizon timestamptz) RETURNS void LANGUAGE plpgsql AS $$
DECLARE existing public.support_case_deletion_markers%ROWTYPE;
BEGIN
  INSERT INTO public.support_case_deletion_markers(subject_id,company_id,case_id,target_kind,erased_at,retain_until)
    VALUES(record_id,tenant_id,root_id,record_kind,erased_time,horizon) ON CONFLICT(subject_id) DO NOTHING;
  SELECT * INTO STRICT existing FROM public.support_case_deletion_markers WHERE subject_id=record_id FOR UPDATE;
  IF existing.company_id<>tenant_id OR existing.case_id<>root_id OR existing.target_kind<>record_kind THEN
    RAISE EXCEPTION 'Conflicting support erasure identity' USING ERRCODE='23514';
  END IF;
  IF existing.retain_until<horizon THEN
    UPDATE public.support_case_deletion_markers SET retain_until=horizon WHERE subject_id=record_id;
  END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.aw_support_case_content_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE root public.support_cases%ROWTYPE; marker public.support_case_deletion_markers%ROWTYPE;
  erased_time timestamptz; horizon timestamptz; child_id uuid; principal_id text;
  authoritative_erasure boolean; tenant_erased boolean;
BEGIN
  IF TG_OP='DELETE' THEN
    erased_time:=clock_timestamp();
    IF TG_TABLE_NAME='support_cases' THEN root:=OLD;
    ELSE
      SELECT * INTO root FROM public.support_cases WHERE id=OLD.case_id AND company_id=OLD.company_id FOR UPDATE;
      IF NOT FOUND THEN
        SELECT * INTO marker FROM public.support_case_deletion_markers
          WHERE subject_id=OLD.case_id AND case_id=OLD.case_id AND company_id=OLD.company_id AND target_kind='case';
        IF NOT FOUND THEN RAISE EXCEPTION 'Support erasure policy is unavailable' USING ERRCODE='23514'; END IF;
        PERFORM public.aw_support_case_marker(OLD.id,OLD.company_id,OLD.case_id,'event',erased_time,marker.retain_until);
        RETURN OLD;
      END IF;
    END IF;
    SELECT EXISTS(SELECT 1 FROM public.support_case_deletion_markers m WHERE m.company_id=root.company_id
        AND m.case_id=root.id AND ((m.target_kind='case' AND m.subject_id=root.id)
          OR (TG_TABLE_NAME='support_case_events' AND m.target_kind='event' AND m.subject_id=OLD.id))) INTO authoritative_erasure;
    IF root.legal_hold AND (root.hold_release_at IS NULL OR root.hold_release_at>erased_time) AND NOT authoritative_erasure THEN
      RAISE EXCEPTION 'Support content is on hold' USING ERRCODE='23514';
    END IF;
    -- No provider adapter is admitted by this storage migration. Keep any
    -- attempted transport facts until its physical-erasure owner is implemented.
    -- A current authenticated erasure marker outranks stale archive facts.
    IF NOT authoritative_erasure THEN
      IF TG_TABLE_NAME='support_cases' THEN
        IF root.provider_case_ref IS NOT NULL OR EXISTS(SELECT 1 FROM public.support_case_events e
          WHERE e.company_id=root.company_id AND e.case_id=root.id AND (e.delivery_attempt_id IS NOT NULL
            OR e.delivery_provider_key IS NOT NULL OR e.delivery_started_at IS NOT NULL OR e.provider_message_ref IS NOT NULL
            OR e.delivery_state IN ('sending','delivered','unknown'))) THEN
          RAISE EXCEPTION 'Support provider erasure is not confirmed' USING ERRCODE='23514';
        END IF;
      ELSIF OLD.delivery_attempt_id IS NOT NULL OR OLD.delivery_provider_key IS NOT NULL OR OLD.delivery_started_at IS NOT NULL
        OR OLD.provider_message_ref IS NOT NULL OR OLD.delivery_state IN ('sending','delivered','unknown') THEN
        RAISE EXCEPTION 'Support provider erasure is not confirmed' USING ERRCODE='23514';
      END IF;
    END IF;
    IF NOT public.aw_support_case_policy_valid(root.data_policy) THEN
      RAISE EXCEPTION 'Support erasure policy is unavailable' USING ERRCODE='23514';
    END IF;
    horizon:=erased_time+make_interval(days=>(root.data_policy->>'deletionMarkerDays')::integer);
    IF TG_TABLE_NAME='support_cases' THEN
      PERFORM public.aw_support_case_marker(OLD.id,OLD.company_id,OLD.id,'case',erased_time,horizon);
      FOR child_id IN SELECT id FROM public.support_case_events WHERE company_id=OLD.company_id AND case_id=OLD.id LOOP
        PERFORM public.aw_support_case_marker(child_id,OLD.company_id,OLD.id,'event',erased_time,horizon);
      END LOOP;
      UPDATE public.support_cases SET follow_up_of_id=NULL WHERE company_id=OLD.company_id AND follow_up_of_id=OLD.id;
    ELSE
      PERFORM public.aw_support_case_marker(OLD.id,OLD.company_id,OLD.case_id,'event',erased_time,horizon);
    END IF;
    RETURN OLD;
  END IF;
  IF EXISTS(SELECT 1 FROM public.support_case_deletion_markers WHERE subject_id=NEW.id)
    OR (TG_TABLE_NAME='support_case_events' AND EXISTS(SELECT 1 FROM public.support_case_deletion_markers
      WHERE subject_id=(to_jsonb(NEW)->>'case_id')::uuid)) THEN
    RAISE EXCEPTION 'Erased support content cannot be restored' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' AND ((TG_TABLE_NAME='support_cases' AND EXISTS(SELECT 1 FROM public.support_case_events WHERE id=NEW.id))
    OR (TG_TABLE_NAME='support_case_events' AND EXISTS(SELECT 1 FROM public.support_cases WHERE id=NEW.id))) THEN
    RAISE EXCEPTION 'Support content identity collides across owner kinds' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    principal_id:=to_jsonb(NEW)->>(CASE WHEN TG_TABLE_NAME='support_cases' THEN 'opened_by_user_id' ELSE 'author_user_id' END);
    PERFORM id FROM public."user" WHERE id=principal_id FOR SHARE;
    IF EXISTS(SELECT 1 FROM public.account_deletion_operations WHERE user_id=principal_id) THEN
      RAISE EXCEPTION 'Account erasure prevents new support content' USING ERRCODE='23514';
    END IF;
    SELECT c.content_erasure_transaction_id IS NOT NULL OR c.pause_reason='company_deleted'
      INTO tenant_erased FROM public.companies c WHERE c.id=NEW.company_id FOR SHARE;
    IF coalesce(tenant_erased,false) OR EXISTS(SELECT 1 FROM public.company_deletion_operations WHERE company_id=NEW.company_id) THEN
      RAISE EXCEPTION 'Company erasure prevents new support content' USING ERRCODE='23514';
    END IF;
    IF TG_TABLE_NAME='support_case_events' THEN
      SELECT * INTO root FROM public.support_cases WHERE id=NEW.case_id AND company_id=NEW.company_id FOR SHARE;
      IF FOUND AND (root.expires_at<=clock_timestamp() OR EXISTS(SELECT 1 FROM public.account_deletion_operations
        WHERE user_id=root.opened_by_user_id)) THEN
        RAISE EXCEPTION 'Support case no longer admits messages' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  IF TG_TABLE_NAME='support_cases' THEN
    IF TG_OP='UPDATE' THEN
      IF (to_jsonb(NEW)-ARRAY['customer_status','requested_response','version','expires_at','last_message_at',
        'legal_hold','hold_reason','hold_release_at','provider_case_ref','updated_at','resolved_at','closed_at','follow_up_of_id'])
        IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['customer_status','requested_response','version','expires_at','last_message_at',
        'legal_hold','hold_reason','hold_release_at','provider_case_ref','updated_at','resolved_at','closed_at','follow_up_of_id']) THEN
        RAISE EXCEPTION 'Original support request is immutable' USING ERRCODE='23514';
      END IF;
      IF NEW.follow_up_of_id IS DISTINCT FROM OLD.follow_up_of_id AND NOT (NEW.follow_up_of_id IS NULL AND
        EXISTS(SELECT 1 FROM public.support_case_deletion_markers WHERE subject_id=OLD.follow_up_of_id
          AND company_id=OLD.company_id AND target_kind='case')) THEN
        RAISE EXCEPTION 'Support follow-up identity is immutable' USING ERRCODE='23514';
      END IF;
      IF OLD.customer_status='CLOSED' AND NEW.customer_status<>'CLOSED' THEN
        RAISE EXCEPTION 'Closed support history requires a linked follow-up' USING ERRCODE='23514';
      END IF;
    END IF;
    IF NOT public.aw_support_case_policy_valid(NEW.data_policy) OR NEW.last_message_at<NEW.created_at
      OR NEW.expires_at<=NEW.last_message_at
      OR NEW.expires_at>NEW.last_message_at+make_interval(days=>(NEW.data_policy->>'retentionDays')::integer) THEN
      RAISE EXCEPTION 'Support retention policy binding is invalid' USING ERRCODE='23514';
    END IF;
  ELSIF TG_OP='UPDATE' THEN
    IF (OLD.delivery_attempt_id IS NOT NULL AND NEW.delivery_attempt_id IS NULL)
      OR (OLD.delivery_provider_key IS NOT NULL AND NEW.delivery_provider_key IS NULL)
      OR (OLD.delivery_started_at IS NOT NULL AND NEW.delivery_started_at IS NULL)
      OR (OLD.provider_message_ref IS NOT NULL AND NEW.provider_message_ref IS NULL) THEN
      RAISE EXCEPTION 'Support transport history cannot be forgotten' USING ERRCODE='23514';
    END IF;
    IF (to_jsonb(NEW)-ARRAY['delivery_state','delivery_attempt_id','delivery_provider_key','delivery_started_at',
      'delivery_lease_until','delivered_at','provider_message_ref']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['delivery_state','delivery_attempt_id','delivery_provider_key','delivery_started_at',
      'delivery_lease_until','delivered_at','provider_message_ref']) THEN
      RAISE EXCEPTION 'Support message and request identity are immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.delivery_state IN ('delivered','not_required') AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
      RAISE EXCEPTION 'Confirmed support delivery is immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER support_case_content_guard BEFORE INSERT OR UPDATE OR DELETE ON support_cases
  FOR EACH ROW EXECUTE FUNCTION public.aw_support_case_content_guard();
--> statement-breakpoint
CREATE TRIGGER support_case_event_content_guard BEFORE INSERT OR UPDATE OR DELETE ON support_case_events
  FOR EACH ROW EXECUTE FUNCTION public.aw_support_case_content_guard();
--> statement-breakpoint
CREATE FUNCTION public.aw_support_case_marker_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.retain_until>clock_timestamp() THEN
      RAISE EXCEPTION 'Support restore horizon has not elapsed' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF (to_jsonb(NEW)-'retain_until') IS DISTINCT FROM (to_jsonb(OLD)-'retain_until') OR NEW.retain_until<OLD.retain_until THEN
    RAISE EXCEPTION 'Support erasure identity and horizon cannot be shortened' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER support_case_marker_guard BEFORE UPDATE OR DELETE ON support_case_deletion_markers
  FOR EACH ROW EXECUTE FUNCTION public.aw_support_case_marker_guard();
--> statement-breakpoint
CREATE FUNCTION public.aw_support_case_company_erasure_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tenant_id uuid;
BEGIN
  IF TG_TABLE_NAME='companies' THEN
    tenant_id:=NEW.id;
    IF NOT EXISTS(SELECT 1 FROM public.companies WHERE id=tenant_id AND content_erasure_transaction_id IS NOT NULL) THEN RETURN NEW; END IF;
  ELSE
    tenant_id:=NEW.company_id;
    IF NEW.status<>'completed' THEN RETURN NEW; END IF;
  END IF;
  PERFORM id FROM public.companies WHERE id=tenant_id FOR UPDATE NOWAIT;
  IF EXISTS(SELECT 1 FROM public.support_cases WHERE company_id=tenant_id) THEN
    RAISE EXCEPTION 'Support content remains after claimed company erasure' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER support_case_company_erasure_guard AFTER UPDATE ON companies
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (NEW.content_erasure_transaction_id IS NOT NULL)
  EXECUTE FUNCTION public.aw_support_case_company_erasure_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER support_case_operation_erasure_guard AFTER INSERT OR UPDATE ON company_deletion_operations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (NEW.status='completed')
  EXECUTE FUNCTION public.aw_support_case_company_erasure_guard();
