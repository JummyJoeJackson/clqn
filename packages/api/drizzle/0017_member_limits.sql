-- Member limits now live only in chat member settings, which can exist before a session starts.
ALTER TABLE "chat_members" DROP CONSTRAINT "chat_members_clan_id_chats_clan_id_fk";
--> statement-breakpoint
UPDATE "chat_members" SET "settings" = "chat_members"."settings" || jsonb_build_object('allowedModels', coalesce("memberships"."agent_policy" -> 'allowedModels', 'null'::jsonb))
FROM "memberships"
WHERE "memberships"."clan_id" = "chat_members"."clan_id" AND "memberships"."user_id" = "chat_members"."user_id";
--> statement-breakpoint
-- Members with a saved policy who never joined a chat keep its token and model limits, with manual approval.
INSERT INTO "chat_members" ("clan_id", "user_id", "settings")
SELECT "clan_id", "user_id", jsonb_build_object(
  'approval', 'manual',
  'tokenLimit', coalesce("agent_policy" -> 'tokenLimit', 'null'::jsonb),
  'agentLimit', 'null'::jsonb,
  'allowedModels', coalesce("agent_policy" -> 'allowedModels', 'null'::jsonb)
)
FROM "memberships"
WHERE "agent_policy" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "memberships" DROP COLUMN "agent_policy";--> statement-breakpoint
ALTER TABLE "memberships" DROP COLUMN "policy_revision";
