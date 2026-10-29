import type { Edge } from "@xyflow/react"
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

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

export const workflowAttachments = pgTable(
  "workflow_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    orgId: text("org_id").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    contentBase64: text("content_base64").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("workflow_attachments_org_workflow_idx").on(
      table.orgId,
      table.workflowId
    ),
  ]
)

// Cross-run memory of openings/items a workflow has already surfaced, so repeat
// runs only report genuinely new results (demo: "skip what was seen last week").
// itemKey is a normalized identity (canonical source URL, else company|role).
export const workflowSurfacedItems = pgTable(
  "workflow_surfaced_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    orgId: text("org_id").notNull(),
    itemKey: text("item_key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    lastRunId: text("last_run_id"),
    firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("workflow_surfaced_items_workflow_key_idx").on(
      table.workflowId,
      table.itemKey
    ),
    index("workflow_surfaced_items_org_workflow_idx").on(
      table.orgId,
      table.workflowId
    ),
  ]
)

export type Workflow = typeof workflows.$inferSelect
export type WorkflowAttachment = typeof workflowAttachments.$inferSelect
export type WorkflowSurfacedItem = typeof workflowSurfacedItems.$inferSelect

export type WorkflowApplicationStatus =
  | "pending"
  | "processing"
  | "applied"
  | "needs-attention"
  | "failed"
  | "uncertain"
  | "duplicate"

export const workflowApplications = pgTable(
  "workflow_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    orgId: text("org_id").notNull(),
    applicationKey: text("application_key").notNull(),
    sourceUrl: text("source_url").notNull(),
    company: text("company").notNull().default(""),
    role: text("role").notNull().default(""),
    matchScore: integer("match_score").notNull().default(0),
    status: text("status")
      .$type<WorkflowApplicationStatus>()
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    lastRunId: text("last_run_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("workflow_applications_workflow_key_idx").on(
      table.workflowId,
      table.applicationKey
    ),
    index("workflow_applications_org_workflow_idx").on(
      table.orgId,
      table.workflowId
    ),
  ]
)

export type WorkflowApplication = typeof workflowApplications.$inferSelect
