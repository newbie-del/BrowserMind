CREATE TABLE IF NOT EXISTS "workflow_surfaced_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workflow_id" uuid NOT NULL REFERENCES "workflows"("id") ON DELETE CASCADE,
  "org_id" text NOT NULL,
  "item_key" text NOT NULL,
  "payload" jsonb,
  "last_run_id" text,
  "first_seen_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_surfaced_items_workflow_key_idx"
  ON "workflow_surfaced_items" ("workflow_id", "item_key");

CREATE INDEX IF NOT EXISTS "workflow_surfaced_items_org_workflow_idx"
  ON "workflow_surfaced_items" ("org_id", "workflow_id");
