import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"

import { Canvas } from "./canvas"
import { ConsolePanel } from "./console-panel"
import { RightSidebar } from "./right-sidebar"
import type { Workflow } from "@/lib/db/schema"

type WorkflowMetadata = Pick<
  Workflow,
  "name" | "goalText" | "generationStatus" | "graph"
>

interface WorkflowShellProps {
  workflowId: string
  workflow: WorkflowMetadata
}

export function WorkflowShell({ workflowId, workflow }: WorkflowShellProps) {
  return (
    <ResizablePanelGroup orientation="horizontal" className="size-full">
      <ResizablePanel minSize="30rem">
        <ResizablePanelGroup orientation="vertical">
          <ResizablePanel minSize="18rem">
            <Canvas initialGraph={workflow.graph} />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize="8rem" minSize="6rem">
            <ConsolePanel />
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize="16rem" minSize="14rem" maxSize="36rem">
        <RightSidebar workflowId={workflowId} workflow={workflow} />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
