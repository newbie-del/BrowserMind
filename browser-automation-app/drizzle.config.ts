import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env" });
config({ path: ".env.local", override: true });

// Migrations/DDL should run over a direct (unpooled) connection.
const migrationUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

if (!migrationUrl) {
  throw new Error("DATABASE_URL_UNPOOLED (or DATABASE_URL) is not set");
}

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: migrationUrl,
  },
  casing: "snake_case",
  verbose: true,
  strict: true,
});
