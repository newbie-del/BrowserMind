import type { Edge } from "@xyflow/react"
import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

import type { StepNodeType } from "@/features/workflows/nodes/node-registry"

// Canonical, server-readable snapshot of the flow. Mirrors React Flow's own
// shape 1:1 so a future executor can read it without remapping. Persisted by the
// Run action; the live editing copy still lives in the Liveblocks room.
export type WorkflowGraph = { nodes: StepNodeType[]; edges: Edge[] }
export type WorkflowGenerationStatus =
  | "idle"
  | "pending_generation"
  | "generated"
  | "failed"

export const workflows = pgTable("workflows", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  goalText: text("goal_text"),
  generationStatus: text("generation_status")
    .$type<WorkflowGenerationStatus>()
    .notNull()
    .default("idle"),
  graph: jsonb("graph").$type<WorkflowGraph>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
})

export type Workflow = typeof workflows.$inferSelect
