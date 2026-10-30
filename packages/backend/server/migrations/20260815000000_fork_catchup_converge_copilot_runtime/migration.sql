-- Fork-only catch-up for 20260803095500_converge_copilot_runtime.
--
-- That migration was rewritten upstream after it first shipped (#15448,
-- #15487): the destructive part moved to 20260820120000_cleanup_legacy_
-- copilot_runtime, and the new version creates structures the later
-- migrations rely on (workspace_artifacts, ai_message_artifacts, ...).
-- Databases that applied the early version have it recorded as applied, so
-- Prisma never runs the new one and 20260820 fails. This adds what the new
-- version would have added. Every step is guarded, so on a database that ran
-- the current 20260803 (any fresh install) it changes nothing. Columns and
-- tables the early version dropped (tokenCost, strategy, ai_prompts_*) are
-- gone from the current schema too, so they stay dropped.

-- The new version gives "definition" a default.
ALTER TABLE "ai_workspace_byok_configs" ALTER COLUMN "definition" SET DEFAULT '{}';

-- The old version renamed the enum; the current schema keeps the legacy
-- database name (@@map("AiPromptRole")), so rename it back.
DO $$
BEGIN
  IF to_regtype('"AiSessionMessageRole"') IS NOT NULL
     AND to_regtype('"AiPromptRole"') IS NULL THEN
    ALTER TYPE "AiSessionMessageRole" RENAME TO "AiPromptRole";
  END IF;
END $$;

ALTER TABLE "ai_sessions_messages" ADD COLUMN IF NOT EXISTS "scope_snapshot" JSONB;
ALTER TABLE "ai_sessions_metadata" ADD COLUMN IF NOT EXISTS "focus" JSONB;

CREATE TABLE IF NOT EXISTS "workspace_artifacts" (
  "id" UUID NOT NULL,
  "workspace_id" VARCHAR NOT NULL,
  "content_hash" VARCHAR NOT NULL,
  "display_name" VARCHAR,
  "file_name" VARCHAR,
  "canonical_media_type" VARCHAR NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "storage_scope" VARCHAR NOT NULL,
  "storage_key" TEXT NOT NULL,
  "status" VARCHAR NOT NULL,
  "library_owned" BOOLEAN NOT NULL DEFAULT false,
  "reservation_expires_at" TIMESTAMPTZ(3),
  "ready_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspace_artifacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workspace_artifacts_library_display_name_check"
    CHECK (NOT "library_owned" OR NULLIF(BTRIM("display_name"), '') IS NOT NULL),
  CONSTRAINT "workspace_artifacts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "workspace_artifacts_workspace_id_content_hash_key" ON "workspace_artifacts"("workspace_id", "content_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_artifacts_workspace_id_id_key" ON "workspace_artifacts"("workspace_id", "id");
CREATE INDEX IF NOT EXISTS "workspace_artifacts_workspace_id_status_idx" ON "workspace_artifacts"("workspace_id", "status");
CREATE INDEX IF NOT EXISTS "workspace_artifacts_status_reservation_expires_at_idx" ON "workspace_artifacts"("status", "reservation_expires_at");

CREATE TABLE IF NOT EXISTS "ai_message_artifacts" (
  "message_id" VARCHAR NOT NULL,
  "workspace_id" VARCHAR NOT NULL,
  "artifact_id" UUID NOT NULL,
  "role" VARCHAR NOT NULL,
  "display_name" VARCHAR,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_message_artifacts_pkey" PRIMARY KEY ("message_id", "artifact_id", "role"),
  CONSTRAINT "ai_message_artifacts_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "ai_sessions_messages"("id") ON DELETE CASCADE,
  CONSTRAINT "ai_message_artifacts_workspace_id_artifact_id_fkey" FOREIGN KEY ("workspace_id", "artifact_id") REFERENCES "workspace_artifacts"("workspace_id", "id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "ai_message_artifacts_workspace_id_artifact_id_idx" ON "ai_message_artifacts"("workspace_id", "artifact_id");
