CREATE TABLE "email_wrappers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"type" varchar(50) NOT NULL,
	"header_gradient" text,
	"header_subtitle" text,
	"cta_button_text" text,
	"cta_button_url" text,
	"cta_button_color" text,
	"custom_footer" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "email_wrappers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "user_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"message" text NOT NULL,
	"type" varchar(20) DEFAULT 'info' NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp,
	"action_url" text,
	"action_activity_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN "use_wrapper" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN "wrapper_type" varchar(50) DEFAULT 'notification';--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN "header_gradient" text;--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN "header_subtitle" text;--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN "cta_button_text" text;--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN "cta_button_url" text;--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN "cta_button_color" text;--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN "custom_footer" text;--> statement-breakpoint
ALTER TABLE "user_alerts" ADD CONSTRAINT "user_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_alerts" ADD CONSTRAINT "user_alerts_action_activity_id_action_activity_id_fk" FOREIGN KEY ("action_activity_id") REFERENCES "public"."action_activity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_alerts_user_id_idx" ON "user_alerts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_alerts_is_read_idx" ON "user_alerts" USING btree ("is_read");--> statement-breakpoint
CREATE INDEX "user_alerts_created_at_idx" ON "user_alerts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "user_alerts_user_read_idx" ON "user_alerts" USING btree ("user_id","is_read");