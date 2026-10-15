CREATE TABLE "experience_observation_commands" (
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"receipt" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '1 day' NOT NULL,
	CONSTRAINT "experience_observation_commands_company_id_user_id_request_id_pk" PRIMARY KEY("company_id","user_id","request_id"),
	CONSTRAINT "experience_observation_commands_hash_ck" CHECK ("experience_observation_commands"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "experience_observation_commands_receipt_ck" CHECK (jsonb_typeof("experience_observation_commands"."receipt") = 'object'
    and "experience_observation_commands"."receipt" ?& array['companyId','requestId','enabled','version','observationsErased']
    and "experience_observation_commands"."receipt" - array['companyId','requestId','enabled','version','observationsErased'] = '{}'::jsonb
    and "experience_observation_commands"."receipt"->>'companyId' = "experience_observation_commands"."company_id"::text and "experience_observation_commands"."receipt"->>'requestId' = "experience_observation_commands"."request_id"::text
    and jsonb_typeof("experience_observation_commands"."receipt"->'enabled') = 'boolean' and jsonb_typeof("experience_observation_commands"."receipt"->'observationsErased') = 'boolean'
    and ("experience_observation_commands"."receipt"->>'enabled')::boolean <> ("experience_observation_commands"."receipt"->>'observationsErased')::boolean
    and jsonb_typeof("experience_observation_commands"."receipt"->'version') = 'number' and "experience_observation_commands"."receipt"->>'version' ~ '^[0-9]{1,10}$'
    and ("experience_observation_commands"."receipt"->>'version')::numeric between 1 and 2147483647),
	CONSTRAINT "experience_observation_commands_expiry_ck" CHECK ("experience_observation_commands"."expires_at" > "experience_observation_commands"."created_at" and "experience_observation_commands"."expires_at" <= "experience_observation_commands"."created_at" + interval '1 day')
);
--> statement-breakpoint
CREATE TABLE "experience_observation_preferences" (
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"last_request_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experience_observation_preferences_company_id_user_id_pk" PRIMARY KEY("company_id","user_id"),
	CONSTRAINT "experience_observation_preferences_version_ck" CHECK ("experience_observation_preferences"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "experience_observations" (
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"preference_version" integer NOT NULL,
	"kind" text NOT NULL,
	"surface" text NOT NULL,
	"variant" text NOT NULL,
	"step" text,
	"duration_bucket" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '35 days' NOT NULL,
	CONSTRAINT "experience_observations_company_id_user_id_request_id_pk" PRIMARY KEY("company_id","user_id","request_id"),
	CONSTRAINT "experience_observations_hash_ck" CHECK ("experience_observations"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "experience_observations_preference_version_ck" CHECK ("experience_observations"."preference_version" > 0),
	CONSTRAINT "experience_observations_kind_ck" CHECK ("experience_observations"."kind" in ('surface_opened','activation_step_opened','active_view_interval')),
	CONSTRAINT "experience_observations_surface_ck" CHECK ("experience_observations"."surface" in ('home','needs_you','activation','agents','workflow','maintenance_history','support','other')),
	CONSTRAINT "experience_observations_variant_ck" CHECK ("experience_observations"."variant" in ('streamlined','classic')),
	CONSTRAINT "experience_observations_step_ck" CHECK ("experience_observations"."step" is null or "experience_observations"."step" in ('intent','discovery_permission','discovery_progress','material_facts','capability','access','review','running','result','activated')),
	CONSTRAINT "experience_observations_duration_ck" CHECK ("experience_observations"."duration_bucket" is null or "experience_observations"."duration_bucket" in ('under_minute','one_to_five_minutes','five_to_fifteen_minutes','fifteen_to_thirty_minutes','over_thirty_minutes')),
	CONSTRAINT "experience_observations_shape_ck" CHECK (("experience_observations"."kind" = 'activation_step_opened') = ("experience_observations"."step" is not null)
    and ("experience_observations"."step" is null or "experience_observations"."surface" = 'activation')
    and ("experience_observations"."kind" = 'active_view_interval') = ("experience_observations"."duration_bucket" is not null)),
	CONSTRAINT "experience_observations_expiry_ck" CHECK ("experience_observations"."expires_at" > "experience_observations"."created_at" and "experience_observations"."expires_at" <= "experience_observations"."created_at" + interval '35 days')
);
--> statement-breakpoint
ALTER TABLE "experience_observation_commands" ADD CONSTRAINT "experience_observation_commands_owner_fk" FOREIGN KEY ("company_id","user_id") REFERENCES "public"."experience_observation_preferences"("company_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_observation_preferences" ADD CONSTRAINT "experience_observation_preferences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_observation_preferences" ADD CONSTRAINT "experience_observation_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_observations" ADD CONSTRAINT "experience_observations_owner_fk" FOREIGN KEY ("company_id","user_id") REFERENCES "public"."experience_observation_preferences"("company_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "experience_observation_commands_expiry_idx" ON "experience_observation_commands" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "experience_observations_owner_window_idx" ON "experience_observations" USING btree ("company_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "experience_observations_expiry_idx" ON "experience_observations" USING btree ("expires_at");