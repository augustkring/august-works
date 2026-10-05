CREATE TABLE "billing_account_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"billing_account_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_account_companies_status_ck" CHECK ("billing_account_companies"."status" in ('active','inactive'))
);
--> statement-breakpoint
CREATE TABLE "billing_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"provider" text DEFAULT 'paddle' NOT NULL,
	"provider_customer_id" text,
	"payer_user_id" text NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"country_code" text,
	"version" integer DEFAULT 1 NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_accounts_status_ck" CHECK ("billing_accounts"."status" in ('active','suspended','closing','closed')),
	CONSTRAINT "billing_accounts_currency_ck" CHECK ("billing_accounts"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "billing_accounts_provider_ck" CHECK ("billing_accounts"."provider" in ('paddle','manual_contract'))
);
--> statement-breakpoint
CREATE TABLE "billing_catalog_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text DEFAULT 'paddle' NOT NULL,
	"environment" text NOT NULL,
	"product_key" text NOT NULL,
	"price_key" text NOT NULL,
	"provider_product_id" text NOT NULL,
	"provider_price_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_until" timestamp with time zone,
	CONSTRAINT "billing_catalog_mappings_environment_ck" CHECK ("billing_catalog_mappings"."environment" in ('sandbox','production'))
);
--> statement-breakpoint
CREATE TABLE "billing_checkout_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"billing_account_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"product_key" text NOT NULL,
	"price_key" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_hash" text NOT NULL,
	"provider_transaction_id" text,
	"checkout_url" text,
	"expires_at" timestamp with time zone NOT NULL,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_checkout_intents_status_ck" CHECK ("billing_checkout_intents"."status" in ('requested','creating','ready','completed','expired','failed','needs_reconciliation'))
);
--> statement-breakpoint
CREATE TABLE "billing_entitlement_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"billing_account_id" uuid,
	"entitlement_key" text NOT NULL,
	"value" jsonb NOT NULL,
	"reason" text NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by_user_id" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_entitlement_overrides_scope_ck" CHECK (("billing_entitlement_overrides"."company_id" is null) <> ("billing_entitlement_overrides"."billing_account_id" is null)),
	CONSTRAINT "billing_entitlement_overrides_expiry_ck" CHECK ("billing_entitlement_overrides"."expires_at" > "billing_entitlement_overrides"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "billing_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"billing_account_id" uuid NOT NULL,
	"provider" text DEFAULT 'paddle' NOT NULL,
	"provider_subscription_id" text NOT NULL,
	"status" text NOT NULL,
	"product_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"trial_ends_at" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"scheduled_change" jsonb,
	"past_due_since" timestamp with time zone,
	"grace_until" timestamp with time zone,
	"provider_updated_at" timestamp with time zone NOT NULL,
	"source_hash" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_subscriptions_status_ck" CHECK ("billing_subscriptions"."status" in ('trialing','active','past_due','paused','canceled'))
);
--> statement-breakpoint
CREATE TABLE "billing_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text DEFAULT 'paddle' NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"payload_hash" text NOT NULL,
	"payload_ciphertext" text,
	"status" text DEFAULT 'received' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"not_before" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_until" timestamp with time zone,
	"last_error_code" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "billing_webhook_events_status_ck" CHECK ("billing_webhook_events"."status" in ('received','processing','processed','failed','ignored','ignored_stale','quarantined'))
);
--> statement-breakpoint
CREATE TABLE "entitlement_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"billing_account_id" uuid NOT NULL,
	"catalog_version" text NOT NULL,
	"source_hash" text NOT NULL,
	"entitlements" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_aggregates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"billing_account_id" uuid NOT NULL,
	"meter_key" text NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"bucket_end" timestamp with time zone NOT NULL,
	"quantity" numeric(40, 0) NOT NULL,
	"unit" text NOT NULL,
	"source_watermark" timestamp with time zone NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_aggregates_quantity_ck" CHECK ("usage_aggregates"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"billing_account_id" uuid NOT NULL,
	"meter_key" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"quantity" numeric(40, 0) NOT NULL,
	"unit" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"source_event_id" text NOT NULL,
	"metadata" jsonb,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_events_quantity_ck" CHECK ("usage_events"."quantity" >= 0 and "usage_events"."period_end" >= "usage_events"."period_start"),
	CONSTRAINT "usage_events_meter_ck" CHECK ("usage_events"."meter_key" in ('runtime.shared_millisecond','runtime.dedicated_gateway_millisecond','runtime.dedicated_vm_millisecond','storage.byte_millisecond','backup.byte_millisecond'))
);
--> statement-breakpoint
CREATE TABLE "company_deletion_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"stage" text DEFAULT 'revoke' NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"not_before" timestamp with time zone DEFAULT now() NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "company_deletion_operations_status_ck" CHECK ("company_deletion_operations"."status" in ('requested','processing','waiting_retention','failed','completed'))
);
--> statement-breakpoint
CREATE TABLE "company_onboarding_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"billing_account_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"current_stage" text DEFAULT 'organization' NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "company_onboarding_runs_status_ck" CHECK ("company_onboarding_runs"."status" in ('in_progress','completed','abandoned'))
);
--> statement-breakpoint
CREATE TABLE "deployment_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_sha" text NOT NULL,
	"image_digest" text NOT NULL,
	"schema_version" text NOT NULL,
	"config_hash" text NOT NULL,
	"operator" text NOT NULL,
	"environment" text NOT NULL,
	"verification_result" text NOT NULL,
	"deployed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deployment_records_digest_ck" CHECK ("deployment_records"."image_digest" ~ '^sha256:[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "email_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"user_id" text,
	"purpose" text NOT NULL,
	"recipient_hash" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload_ciphertext" text,
	"payload_expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider_message_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"not_before" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_until" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "email_deliveries_status_ck" CHECK ("email_deliveries"."status" in ('pending','sending','accepted','delivered','failed','bounced','complained','suppressed','expired','quarantined')),
	CONSTRAINT "email_deliveries_purpose_ck" CHECK ("email_deliveries"."purpose" in ('verification','password_reset','invite','billing','runtime','security'))
);
--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"recipient_hash" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_webhook_receipts" (
	"event_id" text PRIMARY KEY NOT NULL,
	"payload_hash" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_admin_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"operator_user_id" text NOT NULL,
	"support_session_id" uuid,
	"action" text NOT NULL,
	"resource_id" text,
	"safe_details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_scheduler_leases" (
	"job_key" text PRIMARY KEY NOT NULL,
	"occurrence_id" text NOT NULL,
	"owner" text NOT NULL,
	"lease_until" timestamp with time zone NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_error_code" text
);
--> statement-breakpoint
CREATE TABLE "saas_notification_preferences" (
	"user_id" text NOT NULL,
	"category" text NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "saas_notification_preferences_security_ck" CHECK ("saas_notification_preferences"."category" <> 'security' or "saas_notification_preferences"."email_enabled")
);
--> statement-breakpoint
CREATE TABLE "saas_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"relative_path" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saas_notifications_path_ck" CHECK ("saas_notifications"."relative_path" like '/%' and "saas_notifications"."relative_path" not like '//%')
);
--> statement-breakpoint
CREATE TABLE "support_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"operator_user_id" text NOT NULL,
	"approved_by_user_id" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "support_sessions_expiry_ck" CHECK ("support_sessions"."expires_at" > "support_sessions"."created_at" and "support_sessions"."expires_at" <= "support_sessions"."created_at" + interval '1 hour')
);
--> statement-breakpoint
CREATE TABLE "runtime_backups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"runtime_cell_id" uuid NOT NULL,
	"generation" bigint NOT NULL,
	"image_digest" text NOT NULL,
	"state_format" text NOT NULL,
	"status" text DEFAULT 'REQUESTED' NOT NULL,
	"object_key" text NOT NULL,
	"encryption_key_ref" text NOT NULL,
	"ciphertext_sha256" text,
	"byte_size" bigint,
	"manifest" jsonb,
	"retain_until" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_backups_status_ck" CHECK ("runtime_backups"."status" in ('REQUESTED','UPLOADING','AVAILABLE','VERIFIED','FAILED','DELETED'))
);
--> statement-breakpoint
CREATE TABLE "runtime_capacity_profiles" (
	"key" text PRIMARY KEY NOT NULL,
	"cpu_millis" integer NOT NULL,
	"memory_bytes" bigint NOT NULL,
	"disk_bytes" bigint NOT NULL,
	"pids_limit" integer NOT NULL,
	"benchmark_evidence" jsonb,
	"qualified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_capacity_profiles_positive_ck" CHECK ("runtime_capacity_profiles"."cpu_millis" > 0 and "runtime_capacity_profiles"."memory_bytes" > 0 and "runtime_capacity_profiles"."disk_bytes" > 0 and "runtime_capacity_profiles"."pids_limit" > 0)
);
--> statement-breakpoint
CREATE TABLE "runtime_cells" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"billing_account_id" uuid NOT NULL,
	"runtime_host_id" uuid,
	"dedicated_agent_id" uuid,
	"provider_binding_id" uuid,
	"runtime_provider" text DEFAULT 'openclaw' NOT NULL,
	"isolation_mode" text NOT NULL,
	"capacity_profile" text NOT NULL,
	"desired_image_digest" text NOT NULL,
	"active_image_digest" text,
	"generation" bigint DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'REQUESTED' NOT NULL,
	"gateway_secret_ref" text,
	"state_storage_ref" text,
	"active_since" timestamp with time zone,
	"metered_through" timestamp with time zone,
	"last_healthy_at" timestamp with time zone,
	"last_backup_at" timestamp with time zone,
	"last_error_code" text,
	"suspended_reason" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_cells_generation_ck" CHECK ("runtime_cells"."generation" > 0),
	CONSTRAINT "runtime_cells_isolation_ck" CHECK ("runtime_cells"."isolation_mode" in ('company_cell','dedicated_agent_gateway','dedicated_vm')),
	CONSTRAINT "runtime_cells_status_ck" CHECK ("runtime_cells"."status" in ('REQUESTED','WAITING_FOR_CAPACITY','PROVISIONING','CONFIGURING','STARTING','HEALTHY','DEGRADED','STOPPING','STOPPED','UPGRADING','BACKING_UP','MIGRATING','RECOVERING','DELETING','DELETED','FAILED')),
	CONSTRAINT "runtime_cells_deleted_ck" CHECK (("runtime_cells"."status" = 'DELETED') = ("runtime_cells"."deleted_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "runtime_host_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"runtime_host_id" uuid NOT NULL,
	"company_id" uuid,
	"runtime_cell_id" uuid,
	"operation_id" uuid,
	"cell_generation" bigint,
	"command_type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"claim_token_hash" text,
	"not_before" timestamp with time zone DEFAULT now() NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"lease_until" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"safe_result" jsonb,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_host_commands_cell_scope_ck" CHECK (("runtime_host_commands"."company_id" is null) = ("runtime_host_commands"."runtime_cell_id" is null)),
	CONSTRAINT "runtime_host_commands_status_ck" CHECK ("runtime_host_commands"."status" in ('PENDING','CLAIMED','SUCCEEDED','FAILED','EXPIRED','CANCELED'))
);
--> statement-breakpoint
CREATE TABLE "runtime_host_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"runtime_host_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expected_provider_resource_id" text,
	"expected_region" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runtime_host_request_nonces" (
	"runtime_host_id" uuid NOT NULL,
	"nonce" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runtime_hosts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text DEFAULT 'upcloud' NOT NULL,
	"provider_resource_id" text,
	"environment" text NOT NULL,
	"region" text NOT NULL,
	"private_ip" text,
	"dedicated_company_id" uuid,
	"capacity_class" text NOT NULL,
	"cpu_total_millis" integer NOT NULL,
	"memory_total_bytes" bigint NOT NULL,
	"disk_total_bytes" bigint NOT NULL,
	"cpu_reserved_millis" integer DEFAULT 0 NOT NULL,
	"memory_reserved_bytes" bigint DEFAULT 0 NOT NULL,
	"disk_reserved_bytes" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'PROVISIONING' NOT NULL,
	"public_key_pem" text,
	"credential_version" integer DEFAULT 1 NOT NULL,
	"credential_revoked_at" timestamp with time zone,
	"host_agent_version" text,
	"last_heartbeat_at" timestamp with time zone,
	"last_inventory" jsonb,
	"drain_requested_at" timestamp with time zone,
	"fenced_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_hosts_status_ck" CHECK ("runtime_hosts"."status" in ('PROVISIONING','BOOTSTRAPPING','READY','DRAINING','DEGRADED','UNREACHABLE','RETIRED','FAILED')),
	CONSTRAINT "runtime_hosts_capacity_ck" CHECK ("runtime_hosts"."cpu_reserved_millis" >= 0 and "runtime_hosts"."cpu_reserved_millis" <= "runtime_hosts"."cpu_total_millis" and "runtime_hosts"."memory_reserved_bytes" >= 0 and "runtime_hosts"."memory_reserved_bytes" <= "runtime_hosts"."memory_total_bytes" and "runtime_hosts"."disk_reserved_bytes" >= 0 and "runtime_hosts"."disk_reserved_bytes" <= "runtime_hosts"."disk_total_bytes")
);
--> statement-breakpoint
CREATE TABLE "runtime_operation_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"runtime_host_id" uuid,
	"command_id" uuid,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"error_code" text
);
--> statement-breakpoint
CREATE TABLE "runtime_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"runtime_cell_id" uuid NOT NULL,
	"operation_type" text NOT NULL,
	"status" text DEFAULT 'REQUESTED' NOT NULL,
	"requested_by_type" text NOT NULL,
	"requested_by_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"desired_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"not_before" timestamp with time zone DEFAULT now() NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"error_code" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_operations_status_ck" CHECK ("runtime_operations"."status" in ('REQUESTED','RUNNING','WAITING_FOR_CAPACITY','NEEDS_RECONCILIATION','SUCCEEDED','FAILED','CANCELED'))
);
--> statement-breakpoint
CREATE TABLE "runtime_usage_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"runtime_cell_id" uuid NOT NULL,
	"generation" bigint NOT NULL,
	"sample_id" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"healthy" boolean NOT NULL,
	"cpu_millis" integer NOT NULL,
	"memory_bytes" bigint NOT NULL,
	"disk_bytes" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runtime_version_catalog" (
	"image_digest" text PRIMARY KEY NOT NULL,
	"provider_version" text NOT NULL,
	"state_format" text NOT NULL,
	"host_agent_minimum_version" text NOT NULL,
	"conformance" jsonb NOT NULL,
	"status" text DEFAULT 'candidate' NOT NULL,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_version_catalog_digest_ck" CHECK ("runtime_version_catalog"."image_digest" ~ '^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$'),
	CONSTRAINT "runtime_version_catalog_status_ck" CHECK ("runtime_version_catalog"."status" in ('candidate','canary','approved','halted','retired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_account_companies_pair_uq" ON "billing_account_companies" USING btree ("company_id","billing_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_cells_company_id_uq" ON "runtime_cells" USING btree ("company_id","id");--> statement-breakpoint
ALTER TABLE "billing_account_companies" ADD CONSTRAINT "billing_account_companies_billing_account_id_billing_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_account_companies" ADD CONSTRAINT "billing_account_companies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_checkout_intents" ADD CONSTRAINT "billing_checkout_intents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_checkout_intents" ADD CONSTRAINT "billing_checkout_intents_billing_account_id_billing_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_checkout_intents" ADD CONSTRAINT "billing_checkout_intents_company_id_billing_account_id_billing_account_companies_company_id_billing_account_id_fk" FOREIGN KEY ("company_id","billing_account_id") REFERENCES "public"."billing_account_companies"("company_id","billing_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_entitlement_overrides" ADD CONSTRAINT "billing_entitlement_overrides_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_entitlement_overrides" ADD CONSTRAINT "billing_entitlement_overrides_billing_account_id_billing_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_billing_account_id_billing_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_snapshots" ADD CONSTRAINT "entitlement_snapshots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_snapshots" ADD CONSTRAINT "entitlement_snapshots_billing_account_id_billing_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_aggregates" ADD CONSTRAINT "usage_aggregates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_aggregates" ADD CONSTRAINT "usage_aggregates_billing_account_id_billing_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_billing_account_id_billing_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_company_id_billing_account_id_billing_account_companies_company_id_billing_account_id_fk" FOREIGN KEY ("company_id","billing_account_id") REFERENCES "public"."billing_account_companies"("company_id","billing_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_deletion_operations" ADD CONSTRAINT "company_deletion_operations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_onboarding_runs" ADD CONSTRAINT "company_onboarding_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_onboarding_runs" ADD CONSTRAINT "company_onboarding_runs_billing_account_id_billing_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admin_audit" ADD CONSTRAINT "platform_admin_audit_support_session_id_support_sessions_id_fk" FOREIGN KEY ("support_session_id") REFERENCES "public"."support_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saas_notifications" ADD CONSTRAINT "saas_notifications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_sessions" ADD CONSTRAINT "support_sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_backups" ADD CONSTRAINT "runtime_backups_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_backups" ADD CONSTRAINT "runtime_backups_company_id_runtime_cell_id_runtime_cells_company_id_id_fk" FOREIGN KEY ("company_id","runtime_cell_id") REFERENCES "public"."runtime_cells"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_cells" ADD CONSTRAINT "runtime_cells_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_cells" ADD CONSTRAINT "runtime_cells_billing_account_id_billing_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_cells" ADD CONSTRAINT "runtime_cells_runtime_host_id_runtime_hosts_id_fk" FOREIGN KEY ("runtime_host_id") REFERENCES "public"."runtime_hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_cells" ADD CONSTRAINT "runtime_cells_dedicated_agent_id_agents_id_fk" FOREIGN KEY ("dedicated_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_cells" ADD CONSTRAINT "runtime_cells_provider_binding_id_agent_provider_bindings_id_fk" FOREIGN KEY ("provider_binding_id") REFERENCES "public"."agent_provider_bindings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_cells" ADD CONSTRAINT "runtime_cells_capacity_profile_runtime_capacity_profiles_key_fk" FOREIGN KEY ("capacity_profile") REFERENCES "public"."runtime_capacity_profiles"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_cells" ADD CONSTRAINT "runtime_cells_desired_image_digest_runtime_version_catalog_image_digest_fk" FOREIGN KEY ("desired_image_digest") REFERENCES "public"."runtime_version_catalog"("image_digest") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_cells" ADD CONSTRAINT "runtime_cells_active_image_digest_runtime_version_catalog_image_digest_fk" FOREIGN KEY ("active_image_digest") REFERENCES "public"."runtime_version_catalog"("image_digest") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_cells" ADD CONSTRAINT "runtime_cells_company_id_billing_account_id_billing_account_companies_company_id_billing_account_id_fk" FOREIGN KEY ("company_id","billing_account_id") REFERENCES "public"."billing_account_companies"("company_id","billing_account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_host_commands" ADD CONSTRAINT "runtime_host_commands_runtime_host_id_runtime_hosts_id_fk" FOREIGN KEY ("runtime_host_id") REFERENCES "public"."runtime_hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_host_commands" ADD CONSTRAINT "runtime_host_commands_operation_id_runtime_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."runtime_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_host_commands" ADD CONSTRAINT "runtime_host_commands_company_id_runtime_cell_id_runtime_cells_company_id_id_fk" FOREIGN KEY ("company_id","runtime_cell_id") REFERENCES "public"."runtime_cells"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_host_enrollments" ADD CONSTRAINT "runtime_host_enrollments_runtime_host_id_runtime_hosts_id_fk" FOREIGN KEY ("runtime_host_id") REFERENCES "public"."runtime_hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_host_request_nonces" ADD CONSTRAINT "runtime_host_request_nonces_runtime_host_id_runtime_hosts_id_fk" FOREIGN KEY ("runtime_host_id") REFERENCES "public"."runtime_hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_hosts" ADD CONSTRAINT "runtime_hosts_dedicated_company_id_companies_id_fk" FOREIGN KEY ("dedicated_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_operation_attempts" ADD CONSTRAINT "runtime_operation_attempts_operation_id_runtime_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."runtime_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_operation_attempts" ADD CONSTRAINT "runtime_operation_attempts_runtime_host_id_runtime_hosts_id_fk" FOREIGN KEY ("runtime_host_id") REFERENCES "public"."runtime_hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_operation_attempts" ADD CONSTRAINT "runtime_operation_attempts_command_id_runtime_host_commands_id_fk" FOREIGN KEY ("command_id") REFERENCES "public"."runtime_host_commands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_operations" ADD CONSTRAINT "runtime_operations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_operations" ADD CONSTRAINT "runtime_operations_company_id_runtime_cell_id_runtime_cells_company_id_id_fk" FOREIGN KEY ("company_id","runtime_cell_id") REFERENCES "public"."runtime_cells"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_usage_samples" ADD CONSTRAINT "runtime_usage_samples_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_usage_samples" ADD CONSTRAINT "runtime_usage_samples_company_id_runtime_cell_id_runtime_cells_company_id_id_fk" FOREIGN KEY ("company_id","runtime_cell_id") REFERENCES "public"."runtime_cells"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_account_companies_active_uq" ON "billing_account_companies" USING btree ("company_id") WHERE "billing_account_companies"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "billing_accounts_provider_customer_uq" ON "billing_accounts" USING btree ("provider","provider_customer_id") WHERE "billing_accounts"."provider_customer_id" is not null;--> statement-breakpoint
CREATE INDEX "billing_accounts_payer_idx" ON "billing_accounts" USING btree ("payer_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_catalog_mappings_active_uq" ON "billing_catalog_mappings" USING btree ("provider","environment","price_key") WHERE "billing_catalog_mappings"."active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_catalog_mappings_price_uq" ON "billing_catalog_mappings" USING btree ("provider","environment","provider_price_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkout_intents_key_uq" ON "billing_checkout_intents" USING btree ("billing_account_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkout_intents_pending_uq" ON "billing_checkout_intents" USING btree ("billing_account_id") WHERE "billing_checkout_intents"."status" in ('requested','creating','ready','needs_reconciliation');--> statement-breakpoint
CREATE UNIQUE INDEX "billing_subscriptions_provider_uq" ON "billing_subscriptions" USING btree ("provider","provider_subscription_id");--> statement-breakpoint
CREATE INDEX "billing_subscriptions_account_idx" ON "billing_subscriptions" USING btree ("billing_account_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_webhook_events_provider_uq" ON "billing_webhook_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "billing_webhook_events_work_idx" ON "billing_webhook_events" USING btree ("status","not_before");--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_snapshots_company_uq" ON "entitlement_snapshots" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_aggregates_bucket_uq" ON "usage_aggregates" USING btree ("company_id","meter_key","bucket_start","bucket_end");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_events_source_uq" ON "usage_events" USING btree ("company_id","meter_key","resource_type","resource_id","source_event_id");--> statement-breakpoint
CREATE INDEX "usage_events_period_idx" ON "usage_events" USING btree ("billing_account_id","company_id","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "company_deletion_operations_company_uq" ON "company_deletion_operations" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_onboarding_runs_company_uq" ON "company_onboarding_runs" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_onboarding_runs_request_uq" ON "company_onboarding_runs" USING btree ("created_by_user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "email_deliveries_dedupe_uq" ON "email_deliveries" USING btree ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "email_deliveries_provider_uq" ON "email_deliveries" USING btree ("provider_message_id") WHERE "email_deliveries"."provider_message_id" is not null;--> statement-breakpoint
CREATE INDEX "email_deliveries_work_idx" ON "email_deliveries" USING btree ("status","not_before");--> statement-breakpoint
CREATE UNIQUE INDEX "saas_notification_preferences_uq" ON "saas_notification_preferences" USING btree ("user_id","category");--> statement-breakpoint
CREATE UNIQUE INDEX "saas_notifications_user_dedupe_uq" ON "saas_notifications" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "saas_notifications_user_idx" ON "saas_notifications" USING btree ("company_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "support_sessions_operator_idx" ON "support_sessions" USING btree ("operator_user_id","expires_at");--> statement-breakpoint
CREATE INDEX "runtime_backups_retention_idx" ON "runtime_backups" USING btree ("status","retain_until");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_cells_dedicated_agent_uq" ON "runtime_cells" USING btree ("company_id","dedicated_agent_id") WHERE "runtime_cells"."deleted_at" is null and "runtime_cells"."isolation_mode" = 'dedicated_agent_gateway';--> statement-breakpoint
CREATE INDEX "runtime_cells_company_idx" ON "runtime_cells" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "runtime_cells_host_idx" ON "runtime_cells" USING btree ("runtime_host_id","status");--> statement-breakpoint
CREATE INDEX "runtime_cells_billing_idx" ON "runtime_cells" USING btree ("billing_account_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_host_commands_key_uq" ON "runtime_host_commands" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "runtime_host_commands_work_idx" ON "runtime_host_commands" USING btree ("runtime_host_id","status","not_before");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_host_enrollments_token_uq" ON "runtime_host_enrollments" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_host_request_nonces_uq" ON "runtime_host_request_nonces" USING btree ("runtime_host_id","nonce");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_hosts_provider_uq" ON "runtime_hosts" USING btree ("provider","provider_resource_id") WHERE "runtime_hosts"."provider_resource_id" is not null;--> statement-breakpoint
CREATE INDEX "runtime_hosts_placement_idx" ON "runtime_hosts" USING btree ("status","region","capacity_class");--> statement-breakpoint
CREATE INDEX "runtime_hosts_heartbeat_idx" ON "runtime_hosts" USING btree ("last_heartbeat_at");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_operation_attempts_number_uq" ON "runtime_operation_attempts" USING btree ("operation_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_operations_request_uq" ON "runtime_operations" USING btree ("company_id","operation_type","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_operations_active_cell_uq" ON "runtime_operations" USING btree ("runtime_cell_id") WHERE "runtime_operations"."status" in ('REQUESTED','RUNNING','WAITING_FOR_CAPACITY','NEEDS_RECONCILIATION');--> statement-breakpoint
CREATE INDEX "runtime_operations_work_idx" ON "runtime_operations" USING btree ("status","not_before");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_usage_samples_source_uq" ON "runtime_usage_samples" USING btree ("runtime_cell_id","generation","sample_id");