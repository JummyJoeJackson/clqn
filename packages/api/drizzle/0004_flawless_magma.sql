ALTER TABLE "memberships" ADD COLUMN "agent_policy" jsonb;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "policy_revision" integer DEFAULT 0 NOT NULL;