CREATE TABLE "github_deliveries" (
	"binding_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_deliveries_binding_id_delivery_id_pk" PRIMARY KEY("binding_id","delivery_id")
);
--> statement-breakpoint
CREATE TABLE "linked_repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clan_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_event_sequence" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "github_deliveries" ADD CONSTRAINT "github_deliveries_binding_id_linked_repositories_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."linked_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linked_repositories" ADD CONSTRAINT "linked_repositories_clan_id_clans_id_fk" FOREIGN KEY ("clan_id") REFERENCES "public"."clans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linked_repositories" ADD CONSTRAINT "linked_repositories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "linked_repositories_clan_slug_idx" ON "linked_repositories" USING btree ("clan_id","slug");