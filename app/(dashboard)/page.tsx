import { auth } from "@clerk/nextjs/server"
import { notFound } from "next/navigation"

import { WorkflowDashboard } from "@/features/workflows/components/workflow-dashboard"
import { listWorkflows } from "@/features/workflows/data"

export default async function Page() {
  const { orgId } = await auth()
  if (!orgId) notFound()

  const workflows = await listWorkflows(orgId)

  return <WorkflowDashboard workflows={workflows} />
}
