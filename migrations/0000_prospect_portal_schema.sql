CREATE TABLE "prospect_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"prospect_id" integer NOT NULL,
	"file_name" text NOT NULL,
	"original_file_name" text NOT NULL,
	"file_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"uploaded_by" varchar,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "prospect_documents_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "prospect_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"prospect_id" integer NOT NULL,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"type" text DEFAULT 'info' NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp,
	"created_by" varchar NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "merchant_prospects" ADD COLUMN "user_id" varchar;--> statement-breakpoint
ALTER TABLE "prospect_documents" ADD CONSTRAINT "prospect_documents_prospect_id_merchant_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."merchant_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_documents" ADD CONSTRAINT "prospect_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_notifications" ADD CONSTRAINT "prospect_notifications_prospect_id_merchant_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."merchant_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_notifications" ADD CONSTRAINT "prospect_notifications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_prospects" ADD CONSTRAINT "merchant_prospects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;