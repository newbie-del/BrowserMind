import { WorkflowIcon } from "lucide-react"

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { GoalWorkflowForm } from "@/features/workflows/components/goal-workflow-form"
import { NewWorkflowButton } from "@/features/workflows/components/new-workflow-button"

export default function Page() {
  return (
    <Empty className="h-full min-h-0 justify-start overflow-y-auto border-none py-8">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <WorkflowIcon />
        </EmptyMedia>
        <EmptyTitle>No workflow selected</EmptyTitle>
        <EmptyDescription>
          Select a workflow from the sidebar or create a new one to get started.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <GoalWorkflowForm />
        <NewWorkflowButton />
      </EmptyContent>
    </Empty>
  )
}
