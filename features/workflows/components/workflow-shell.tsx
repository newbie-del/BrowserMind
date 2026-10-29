import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Workflow as WorkflowIcon,
} from "lucide-react"
import Link from "next/link"

import { Canvas } from "./canvas"
import { ConsolePanel } from "./console-panel"
import { RightSidebar } from "./right-sidebar"
import type { Workflow, WorkflowAttachment } from "@/lib/db/schema"

type WorkflowMetadata = Pick<
  Workflow,
  "name" | "goalText" | "generationStatus" | "graph"
>

interface WorkflowShellProps {
  workflowId: string
  workflow: WorkflowMetadata
  attachments: Pick<
    WorkflowAttachment,
    "id" | "filename" | "contentType" | "size"
  >[]
}

export function WorkflowShell({
  workflowId,
  workflow,
  attachments,
}: WorkflowShellProps) {
  const status =
    workflow.generationStatus === "failed"
      ? {
          label: "Plan needs attention",
          icon: <CircleAlert className="size-3" />,
        }
      : workflow.graph
        ? { label: "Ready to edit", icon: <Check className="size-3" /> }
        : { label: "Draft", icon: <WorkflowIcon className="size-3" /> }

  return (
    <div className="flex size-full min-h-0 flex-col bg-background">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-background px-4 py-3 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            asChild
            variant="ghost"
            size="icon-sm"
            aria-label="Back to workflows"
          >
            <Link href="/">
              <ArrowLeft />
            </Link>
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="max-w-[min(48vw,36rem)] truncate text-sm font-semibold md:text-base">
                {workflow.name}
              </h1>
              <Badge
                variant={
                  workflow.generationStatus === "failed"
                    ? "destructive"
                    : "secondary"
                }
                className="gap-1"
              >
                {status.icon}
                {status.label}
              </Badge>
            </div>
            <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block">
              {workflow.graph?.nodes.length ?? 0} canvas steps
              {workflow.goalText
                ? " · Goal-based workflow"
                : " · Manual workflow"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Changes sync as you edit
          </span>
          <span className="flex size-8 items-center justify-center rounded-lg bg-muted">
            <WorkflowIcon className="size-4 text-muted-foreground" />
          </span>
        </div>
      </header>
      <div className="min-h-0 flex-1">
        <ResizablePanelGroup orientation="horizontal" className="size-full">
          <ResizablePanel minSize="30rem">
            <ResizablePanelGroup orientation="vertical">
              <ResizablePanel minSize="18rem">
                <Canvas initialGraph={workflow.graph} />
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize="9rem" minSize="6rem">
                <ConsolePanel />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            defaultSize="21rem"
            minSize="17rem"
            maxSize="38rem"
            groupResizeBehavior="preserve-pixel-size"
          >
            <RightSidebar
              workflowId={workflowId}
              workflow={workflow}
              attachments={attachments}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  )
}
