ALTER TABLE "merchant_prospects" ADD COLUMN "agent_signature" text;--> statement-breakpoint
ALTER TABLE "merchant_prospects" ADD COLUMN "agent_signature_type" text;--> statement-breakpoint
ALTER TABLE "merchant_prospects" ADD COLUMN "agent_signed_at" timestamp;