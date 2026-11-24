-- Removal now closes a member's pending invitations. Close those left open by earlier removals,
-- since invitations can now be accepted by signed-in email without the code.
UPDATE "invitations" SET "consumed_at" = now()
WHERE "consumed_at" IS NULL
  AND EXISTS (
    SELECT 1 FROM "events" e
    JOIN "users" u ON e."resource_id" = u."id"::text
    WHERE e."clan_id" = "invitations"."clan_id"
      AND u."email" = "invitations"."email"
      AND e."type" IN ('member.removed', 'member.left')
      AND e."created_at" >= "invitations"."created_at"
  );
