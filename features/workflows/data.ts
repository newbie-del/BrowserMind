import { and, desc, eq, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import {
  WorkflowGraph,
  workflowAttachments,
  workflowApplications,
  workflowSurfacedItems,
  type WorkflowApplicationStatus,
  workflows,
} from "@/lib/db/schema"
import { validateGraph } from "@/features/workflows/lib/validate-graph"
import type { RankedInternship } from "@/features/workflows/lib/internship-queue"

export async function saveWorkflowGraph({
  orgId,
  id,
  graph,
}: {
  orgId: string
  id: string
  graph: WorkflowGraph
}) {
  const problems = validateGraph(graph)
  if (problems.length > 0) throw new Error(problems.join(" "))
  await db
    .update(workflows)
    .set({ graph, updatedAt: new Date() })
    .where(and(eq(workflows.id, id), eq(workflows.orgId, orgId)))
}

export async function updateWorkflowName({
  orgId,
  id,
  name,
}: {
  orgId: string
  id: string
  name: string
}) {
  const trimmed = name.trim()
  if (!trimmed) throw new Error("Workflow name cannot be empty.")
  await db
    .update(workflows)
    .set({ name: trimmed.slice(0, 120), updatedAt: new Date() })
    .where(and(eq(workflows.id, id), eq(workflows.orgId, orgId)))
}

export function listWorkflows(orgId: string) {
  return db
    .select()
    .from(workflows)
    .where(eq(workflows.orgId, orgId))
    .orderBy(desc(workflows.createdAt))
}

export async function getWorkflow(orgId: string, id: string) {
  const [workflow] = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, id), eq(workflows.orgId, orgId)))

  return workflow
}

export async function createWorkflow(
  orgId: string,
  name: string,
  options: {
    goalText?: string
    generationStatus?: typeof workflows.$inferInsert.generationStatus
    graph?: WorkflowGraph
  } = {}
) {
  const [workflow] = await db
    .insert(workflows)
    .values({ orgId, name, ...options })
    .returning()

  return workflow
}

export async function deleteWorkflow(orgId: string, id: string) {
  await db
    .delete(workflowAttachments)
    .where(
      and(
        eq(workflowAttachments.workflowId, id),
        eq(workflowAttachments.orgId, orgId)
      )
    )

  const [workflow] = await db
    .delete(workflows)
    .where(and(eq(workflows.id, id), eq(workflows.orgId, orgId)))
    .returning()

  return workflow
}

export async function listWorkflowAttachments(orgId: string, workflowId: string) {
  return db
    .select({
      id: workflowAttachments.id,
      filename: workflowAttachments.filename,
      contentType: workflowAttachments.contentType,
      size: workflowAttachments.size,
      createdAt: workflowAttachments.createdAt,
    })
    .from(workflowAttachments)
    .where(
      and(
        eq(workflowAttachments.orgId, orgId),
        eq(workflowAttachments.workflowId, workflowId)
      )
    )
    .orderBy(desc(workflowAttachments.createdAt))
}

export async function getWorkflowAttachments(orgId: string, workflowId: string) {
  return db
    .select()
    .from(workflowAttachments)
    .where(
      and(
        eq(workflowAttachments.orgId, orgId),
        eq(workflowAttachments.workflowId, workflowId)
      )
    )
    .orderBy(desc(workflowAttachments.createdAt))
}

export async function addWorkflowAttachment({
  orgId,
  workflowId,
  filename,
  contentType,
  size,
  contentBase64,
}: {
  orgId: string
  workflowId: string
  filename: string
  contentType: string
  size: number
  contentBase64: string
}) {
  const [attachment] = await db
    .insert(workflowAttachments)
    .values({
      orgId,
      workflowId,
      filename,
      contentType,
      size,
      contentBase64,
    })
    .returning({
      id: workflowAttachments.id,
      filename: workflowAttachments.filename,
      contentType: workflowAttachments.contentType,
      size: workflowAttachments.size,
      createdAt: workflowAttachments.createdAt,
    })

  return attachment
}

export async function deleteWorkflowAttachment({
  orgId,
  workflowId,
  attachmentId,
}: {
  orgId: string
  workflowId: string
  attachmentId: string
}) {
  const [attachment] = await db
    .delete(workflowAttachments)
    .where(
      and(
        eq(workflowAttachments.id, attachmentId),
        eq(workflowAttachments.orgId, orgId),
        eq(workflowAttachments.workflowId, workflowId)
      )
    )
    .returning({ id: workflowAttachments.id })

  return attachment
}

export async function getWorkflowAttachmentTotalSize(
  orgId: string,
  workflowId: string
) {
  const [result] = await db
    .select({
      total: sql<number>`coalesce(sum(${workflowAttachments.size}), 0)::bigint`,
    })
    .from(workflowAttachments)
    .where(
      and(
        eq(workflowAttachments.orgId, orgId),
        eq(workflowAttachments.workflowId, workflowId)
      )
    )

  return Number(result?.total ?? 0)
}

export async function listWorkflowApplications(orgId: string, workflowId: string) {
  return db
    .select()
    .from(workflowApplications)
    .where(
      and(
        eq(workflowApplications.orgId, orgId),
        eq(workflowApplications.workflowId, workflowId)
      )
    )
    .orderBy(desc(workflowApplications.matchScore), workflowApplications.createdAt)
}

export async function enqueueWorkflowApplications({
  orgId,
  workflowId,
  runId,
  items,
}: {
  orgId: string
  workflowId: string
  runId: string
  items: RankedInternship[]
}) {
  if (items.length === 0) return
  await db
    .insert(workflowApplications)
    .values(
      items.map((item) => ({
        orgId,
        workflowId,
        lastRunId: runId,
        applicationKey: item.applicationKey,
        sourceUrl: item.sourceUrl,
        company: item.company,
        role: item.role,
        matchScore: item.matchScore,
      }))
    )
    .onConflictDoNothing({
      target: [
        workflowApplications.workflowId,
        workflowApplications.applicationKey,
      ],
    })
}

export async function updateWorkflowApplication({
  orgId,
  workflowId,
  id,
  status,
  lastError,
  runId,
  incrementAttempt = false,
}: {
  orgId: string
  workflowId: string
  id: string
  status: WorkflowApplicationStatus
  lastError?: string | null
  runId?: string
  incrementAttempt?: boolean
}) {
  await db
    .update(workflowApplications)
    .set({
      status,
      lastError: lastError ?? null,
      lastRunId: runId,
      updatedAt: new Date(),
      ...(incrementAttempt
        ? { attempts: sql`${workflowApplications.attempts} + 1` }
        : {}),
    })
    .where(
      and(
        eq(workflowApplications.orgId, orgId),
        eq(workflowApplications.workflowId, workflowId),
        eq(workflowApplications.id, id)
      )
    )
}

// Cross-run memory: the normalized keys of items this workflow has already
// surfaced in previous runs, so a new run can report only genuinely new ones.
export async function getSurfacedItemKeys(orgId: string, workflowId: string) {
  const rows = await db
    .select({ itemKey: workflowSurfacedItems.itemKey })
    .from(workflowSurfacedItems)
    .where(
      and(
        eq(workflowSurfacedItems.orgId, orgId),
        eq(workflowSurfacedItems.workflowId, workflowId)
      )
    )
  return rows.map((row) => row.itemKey)
}

export async function recordSurfacedItems({
  orgId,
  workflowId,
  runId,
  items,
}: {
  orgId: string
  workflowId: string
  runId?: string
  items: { key: string; payload?: Record<string, unknown> }[]
}) {
  // Dedupe by itemKey first: Postgres rejects an INSERT ... ON CONFLICT whose
  // own VALUES contain the same conflict key twice ("cannot affect row a second
  // time"), which happens when several shortlisted items share a sourceUrl.
  const byKey = new Map<
    string,
    {
      orgId: string
      workflowId: string
      itemKey: string
      payload: Record<string, unknown> | null
      lastRunId: string | null
    }
  >()
  for (const item of items) {
    const key = item.key.trim()
    if (!key) continue
    byKey.set(key, {
      orgId,
      workflowId,
      itemKey: key,
      payload: item.payload ?? null,
      lastRunId: runId ?? null,
    })
  }
  const values = [...byKey.values()]
  if (values.length === 0) return
  await db
    .insert(workflowSurfacedItems)
    .values(values)
    .onConflictDoUpdate({
      target: [workflowSurfacedItems.workflowId, workflowSurfacedItems.itemKey],
      set: { lastRunId: runId ?? null },
    })
}
