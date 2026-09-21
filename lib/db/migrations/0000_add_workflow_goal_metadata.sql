ALTER TABLE "workflows" ADD COLUMN IF NOT EXISTS "goal_text" text;
ALTER TABLE "workflows" ADD COLUMN IF NOT EXISTS "generation_status" text DEFAULT 'idle' NOT NULL;
