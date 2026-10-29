import { auth } from "@clerk/nextjs/server"

import {
  deleteWorkflowAttachment,
  getWorkflow,
} from "@/features/workflows/data"

export async function DELETE(
  _request: Request,
  {
    params,
  }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id, attachmentId } = await params
  const workflow = await getWorkflow(orgId, id)
  if (!workflow) {
    return Response.json({ error: "Workflow not found" }, { status: 404 })
  }

  const deleted = await deleteWorkflowAttachment({
    orgId,
    workflowId: id,
    attachmentId,
  })
  if (!deleted) {
    return Response.json({ error: "Document not found" }, { status: 404 })
  }

  return new Response(null, { status: 204 })
}
