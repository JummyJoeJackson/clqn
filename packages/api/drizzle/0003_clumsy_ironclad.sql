CREATE TYPE "public"."task_status" AS ENUM('open', 'claimed', 'completed');--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clan_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "context_entries" (
	"clan_id" uuid NOT NULL,
	"key" text NOT NULL,
	"text" text NOT NULL,
	"revision" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "context_entries_clan_id_key_pk" PRIMARY KEY("clan_id","key")
);
--> statement-breakpoint
CREATE TABLE "context_revisions" (
	"clan_id" uuid NOT NULL,
	"key" text NOT NULL,
	"text" text NOT NULL,
	"revision" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "context_revisions_clan_id_key_revision_pk" PRIMARY KEY("clan_id","key","revision")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clan_id" uuid NOT NULL,
	"description" text NOT NULL,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"owner_id" uuid,
	"owner_agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_owner_matches_status" CHECK (("tasks"."status" = 'open' AND "tasks"."owner_id" IS NULL AND "tasks"."owner_agent_id" IS NULL) OR ("tasks"."status" IN ('claimed', 'completed') AND "tasks"."owner_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "sequence" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "resource_id" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_clan_id_clans_id_fk" FOREIGN KEY ("clan_id") REFERENCES "public"."clans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_entries" ADD CONSTRAINT "context_entries_clan_id_clans_id_fk" FOREIGN KEY ("clan_id") REFERENCES "public"."clans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_revisions" ADD CONSTRAINT "context_revisions_clan_id_clans_id_fk" FOREIGN KEY ("clan_id") REFERENCES "public"."clans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_clan_id_clans_id_fk" FOREIGN KEY ("clan_id") REFERENCES "public"."clans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_clan_idx" ON "tasks" USING btree ("clan_id");--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_sequence_unique" UNIQUE("sequence");