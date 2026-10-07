-- Every account is a person in the execution graph, so work can be assigned
-- to it. Accounts created before this rule get one now.

-- Claim the unclaimed person CytoHub Brain already knows by the same email.
UPDATE "User" u
SET "personId" = (
  SELECT p."id" FROM "Person" p
  WHERE lower(p."email") = lower(u."email")
    AND NOT EXISTS (SELECT 1 FROM "User" o WHERE o."personId" = p."id")
  ORDER BY p."createdAt"
  LIMIT 1
)
WHERE u."personId" IS NULL;

UPDATE "Person" p
SET "type" = 'TEAM', "updatedAt" = CURRENT_TIMESTAMP
FROM "User" u
WHERE u."personId" = p."id" AND u."role" <> 'ADVISOR' AND p."type" <> 'TEAM';

-- Add a person for the rest. The unique email stays with a person that
-- already holds it.
WITH pending AS (
  SELECT u."id" AS user_id,
         'person_' || replace(gen_random_uuid()::text, '-', '') AS person_id,
         u."name", u."email", u."title", u."role"
  FROM "User" u
  WHERE u."personId" IS NULL
), created AS (
  INSERT INTO "Person" ("id", "name", "email", "title", "type", "updatedAt")
  SELECT person_id, "name",
         CASE WHEN EXISTS (SELECT 1 FROM "Person" p WHERE p."email" = pending."email") THEN NULL ELSE "email" END,
         "title",
         CASE WHEN "role" = 'ADVISOR' THEN 'ADVISOR'::"PersonType" ELSE 'TEAM'::"PersonType" END,
         CURRENT_TIMESTAMP
  FROM pending
  RETURNING "id"
)
UPDATE "User" u
SET "personId" = pending.person_id
FROM pending
WHERE u."id" = pending.user_id;
