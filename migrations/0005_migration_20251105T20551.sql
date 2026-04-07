CREATE TABLE "campaign_application_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"template_id" integer NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_application_templates_campaign_id_template_id_unique" UNIQUE("campaign_id","template_id")
);
--> statement-breakpoint
CREATE TABLE "signature_captures" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer,
	"prospect_id" integer,
	"role_key" text NOT NULL,
	"signer_type" text NOT NULL,
	"signer_name" text,
	"signer_email" text,
	"signature" text,
	"signature_type" text,
	"initials" text,
	"date_signed" timestamp,
	"timestamp_signed" timestamp,
	"timestamp_requested" timestamp,
	"timestamp_expires" timestamp,
	"request_token" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"notes" text,
	"ownership_percentage" numeric(5, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "signature_captures_request_token_unique" UNIQUE("request_token")
);
--> statement-breakpoint
ALTER TABLE "acquirer_application_templates" ADD COLUMN "address_groups" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "acquirer_application_templates" ADD COLUMN "signature_groups" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "pdf_form_fields" ADD COLUMN "pdf_field_id" text;--> statement-breakpoint
ALTER TABLE "campaign_application_templates" ADD CONSTRAINT "campaign_application_templates_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_application_templates" ADD CONSTRAINT "campaign_application_templates_template_id_acquirer_application_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."acquirer_application_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_captures" ADD CONSTRAINT "signature_captures_application_id_prospect_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."prospect_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_captures" ADD CONSTRAINT "signature_captures_prospect_id_merchant_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."merchant_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signature_captures_application_id_idx" ON "signature_captures" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "signature_captures_prospect_id_idx" ON "signature_captures" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX "signature_captures_request_token_idx" ON "signature_captures" USING btree ("request_token");--> statement-breakpoint
CREATE INDEX "signature_captures_status_idx" ON "signature_captures" USING btree ("status");