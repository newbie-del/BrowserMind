CREATE TABLE IF NOT EXISTS "workflow_applications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workflow_id" uuid NOT NULL REFERENCES "workflows"("id") ON DELETE CASCADE,
  "org_id" text NOT NULL,
  "application_key" text NOT NULL,
  "source_url" text NOT NULL,
  "company" text NOT NULL DEFAULT '',
  "role" text NOT NULL DEFAULT '',
  "match_score" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "last_run_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_applications_workflow_key_idx"
  ON "workflow_applications" ("workflow_id", "application_key");

CREATE INDEX IF NOT EXISTS "workflow_applications_org_workflow_idx"
  ON "workflow_applications" ("org_id", "workflow_id");
