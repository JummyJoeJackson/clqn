ALTER TABLE "agents" ADD COLUMN "role" text DEFAULT 'worker' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "assigned_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "repository" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_agent_id_agents_id_fk" FOREIGN KEY ("assigned_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agents_one_orchestrator_per_clan" ON "agents" USING btree ("clan_id") WHERE "agents"."role" = 'orchestrator';--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_repository_branch_idx" ON "tasks" USING btree ("clan_id",("repository"->>'slug'),("repository"->>'branch')) WHERE "tasks"."repository" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_role_valid" CHECK ("agents"."role" IN ('worker', 'orchestrator'));