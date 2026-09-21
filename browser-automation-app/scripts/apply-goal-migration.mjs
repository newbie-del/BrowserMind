import { Client } from "@neondatabase/serverless"
import { config } from "dotenv"

config({ path: ".env" })
config({ path: ".env.local", override: true })

const connectionString =
  process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL

if (!connectionString) {
  throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL is required")
}

const client = new Client({ connectionString })

await client.connect()
await client.query(
  'ALTER TABLE "workflows" ADD COLUMN IF NOT EXISTS "goal_text" text'
)
await client.query(
  'ALTER TABLE "workflows" ADD COLUMN IF NOT EXISTS "generation_status" text DEFAULT \'idle\' NOT NULL'
)
await client.end()

console.log("Applied workflow goal columns")
