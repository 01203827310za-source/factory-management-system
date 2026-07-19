-- Migration: add_rbac
-- Adds database-backed roles, permissions, and per-user permission overrides.
-- Run this SQL against the database, then: npx prisma generate

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "role_id" INTEGER;

ALTER TABLE "users"
  ALTER COLUMN "role" DROP DEFAULT;

ALTER TABLE "users"
  ALTER COLUMN "role" TYPE TEXT USING "role"::TEXT;

ALTER TABLE "users"
  ALTER COLUMN "role" SET DEFAULT 'viewer';

DROP TYPE IF EXISTS "Role";

CREATE TABLE IF NOT EXISTS "roles" (
  "id"           SERIAL       NOT NULL,
  "name"         TEXT         NOT NULL,
  "display_name" TEXT         NOT NULL,
  "description"  TEXT         NOT NULL DEFAULT '',
  "is_system"    BOOLEAN      NOT NULL DEFAULT true,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "roles_name_key" ON "roles"("name");

CREATE TABLE IF NOT EXISTS "permissions" (
  "id"         SERIAL       NOT NULL,
  "key"        TEXT         NOT NULL,
  "module"     TEXT         NOT NULL,
  "action"     TEXT         NOT NULL,
  "label"      TEXT         NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "permissions_key_key" ON "permissions"("key");

CREATE TABLE IF NOT EXISTS "role_permissions" (
  "id"            SERIAL  NOT NULL,
  "role_id"       INTEGER NOT NULL,
  "permission_id" INTEGER NOT NULL,
  CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "role_permissions_role_id_permission_id_key"
  ON "role_permissions"("role_id", "permission_id");

CREATE TABLE IF NOT EXISTS "user_permissions" (
  "id"            SERIAL  NOT NULL,
  "user_id"       INTEGER NOT NULL,
  "permission_id" INTEGER NOT NULL,
  "allowed"       BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_permissions_user_id_permission_id_key"
  ON "user_permissions"("user_id", "permission_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_role_id_fkey'
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_role_id_fkey"
      FOREIGN KEY ("role_id") REFERENCES "roles"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'role_permissions_role_id_fkey'
  ) THEN
    ALTER TABLE "role_permissions"
      ADD CONSTRAINT "role_permissions_role_id_fkey"
      FOREIGN KEY ("role_id") REFERENCES "roles"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'role_permissions_permission_id_fkey'
  ) THEN
    ALTER TABLE "role_permissions"
      ADD CONSTRAINT "role_permissions_permission_id_fkey"
      FOREIGN KEY ("permission_id") REFERENCES "permissions"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_permissions_user_id_fkey'
  ) THEN
    ALTER TABLE "user_permissions"
      ADD CONSTRAINT "user_permissions_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_permissions_permission_id_fkey'
  ) THEN
    ALTER TABLE "user_permissions"
      ADD CONSTRAINT "user_permissions_permission_id_fkey"
      FOREIGN KEY ("permission_id") REFERENCES "permissions"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "roles" ("name", "display_name", "description", "is_system")
VALUES ('admin', 'Administrator', 'Full system access', true)
ON CONFLICT ("name") DO UPDATE
SET "display_name" = EXCLUDED."display_name",
    "description" = EXCLUDED."description",
    "is_system" = true;

UPDATE "users"
SET "role" = 'admin',
    "role_id" = (SELECT "id" FROM "roles" WHERE "name" = 'admin')
WHERE "username" = 'admin';

DELETE FROM "user_permissions"
WHERE "user_id" IN (
  SELECT "id"
  FROM "users"
  WHERE "username" = 'admin' OR "role" = 'admin'
);
