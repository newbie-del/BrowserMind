CREATE TABLE IF NOT EXISTS "workflow_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workflow_id" uuid NOT NULL REFERENCES "workflows"("id") ON DELETE CASCADE,
  "org_id" text NOT NULL,
  "filename" text NOT NULL,
  "content_type" text NOT NULL,
  "size" integer NOT NULL,
  "content_base64" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "workflow_attachments_org_workflow_idx"
  ON "workflow_attachments" ("org_id", "workflow_id");
