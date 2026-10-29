"use client"

import { useState, useTransition } from "react"
import { useReactFlow, useStore } from "@xyflow/react"
import {
  Lock,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Square,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"

import {
  cancelWorkflowRunAction,
  deleteWorkflowAction,
  renameWorkflowAction,
  runWorkflowAction,
} from "@/features/workflows/actions"
import { NodeIcon } from "@/features/workflows/components/node-icon"
import { WorkflowAttachments } from "@/features/workflows/components/workflow-attachments"
import {
  useConsoleRuns,
  useLiveRun,
  useRefreshWorkflowRuns,
} from "@/features/workflows/components/workflow-runs-provider"
import { Spinner } from "@/components/ui/spinner"
import { useProPlan } from "@/features/workflows/hooks/use-pro-plan"
import { useUpstreamConnections } from "@/features/workflows/hooks/use-upstream-connections"
import { validateGraph } from "@/features/workflows/lib/validate-graph"
import {
  nodeRegistry,
  type NodeDefinition,
  type NodeField,
  type NodeType,
  type StepNodeKind,
  type StepNodeType,
} from "@/features/workflows/nodes/node-registry"
import type {
  Workflow,
  WorkflowAttachment,
  WorkflowGenerationStatus,
} from "@/lib/db/schema"

// This file builds up to the RightSidebar component exported at the bottom: a
// header with workflow actions (delete, run), then two tabs — a Toolbar for
// adding nodes and an Editor for tweaking the selected node. Each helper below is
// defined just above the block that uses it.

// ---------------------------------------------------------------------------
// Shared pieces — used by both the Toolbar and the Editor.
// ---------------------------------------------------------------------------

// A titled, scrollable panel. Each tab renders its content inside one.
function Section({
  title,
  icon,
  children,
}: {
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-y border-border bg-card px-3 py-1.5 text-sm font-semibold">
        {icon}
        {title}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Editor tab — edits the fields of the selected node.
// ---------------------------------------------------------------------------

// A single editor field for a node property. Renders a multi-line textarea when
// the field opts in via `multiline`, otherwise a single-line input.
function Field({
  field,
  value,
  onChange,
  onFocus,
}: {
  field: NodeField
  value: string
  onChange: (value: string) => void
  // Fires when the field gains focus, so the Connections chips know which
  // field a clicked token should land in.
  onFocus: () => void
}) {
  if (field.multiline) {
    return (
      <Textarea
        id={field.key}
        value={value}
        placeholder={field.placeholder}
        onFocus={onFocus}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }

  return (
    <Input
      id={field.key}
      value={value}
      placeholder={field.placeholder}
      onFocus={onFocus}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

// The Editor tab: one input per field on the selected node, or an empty state.
function Inspector({ node }: { node: StepNodeType | undefined }) {
  const { updateNodeData } = useReactFlow<StepNodeType>()
  // Outputs of every node upstream of the selected one, as insertable {{ }}
  // tokens. Empty when nothing feeds into this node.
  const connections = useUpstreamConnections()
  // The field a clicked chip inserts into — whichever was focused most recently.
  // Reset per selected node since this component is keyed by node id.
  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(null)

  if (!node) {
    return (
      <Section title="Editor">
        <p className="p-3 text-sm text-muted-foreground">No node selected</p>
      </Section>
    )
  }

  const { type, title, values } = node.data
  const def: NodeDefinition = nodeRegistry[type]

  // Untouched fields fall back to the first one, so a chip always has a home.
  const targetKey = activeFieldKey ?? def.fields[0]?.key

  const insertToken = (token: string) => {
    if (!targetKey) return
    updateNodeData(node.id, {
      values: { ...values, [targetKey]: (values[targetKey] ?? "") + token },
    })
  }

  return (
    <Section title={title} icon={<NodeIcon type={type} />}>
      <div className="flex flex-col gap-3 p-3">
        {def.fields.length === 0 ? (
          <p className="text-xs text-muted-foreground">No properties</p>
        ) : (
          def.fields.map((field) => (
            <div key={field.key} className="flex flex-col gap-1.5">
              <Label htmlFor={field.key} className="text-xs">
                {field.label}
                {field.required && <span className="text-destructive">*</span>}
              </Label>
              <Field
                field={field}
                value={values[field.key] ?? ""}
                onFocus={() => setActiveFieldKey(field.key)}
                onChange={(value) => {
                  updateNodeData(node.id, {
                    values: { ...values, [field.key]: value },
                  })
                }}
              />
            </div>
          ))
        )}

        {/* Available upstream outputs — click to drop a token into the last
            focused field (or the first field if none has been touched). */}
        {connections.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Connections</Label>
            <div className="flex flex-wrap gap-1.5">
              {connections.map((connection) => (
                <button
                  key={connection.token}
                  type="button"
                  onClick={() => insertToken(connection.token)}
                  className="flex max-w-full items-center gap-1.5 rounded-md border border-border bg-card px-1.5 py-1 text-xs hover:bg-accent"
                >
                  <NodeIcon type={connection.nodeType} className="size-4" />
                  <span className="truncate">{connection.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Toolbar tab — adds nodes to the canvas, grouped by kind.
// ---------------------------------------------------------------------------

// The Toolbar's groups, one accordion section per node kind.
const sections: { kind: StepNodeKind; label: string }[] = [
  { kind: "trigger", label: "Triggers" },
  { kind: "action", label: "Actions" },
]

// Every node type from the registry, filtered into the groups below.
const definitions = Object.values(nodeRegistry)

// Node types that only orgs on the Pro plan can add. The Agent node is our most
// expensive node, so it's gated; every other node stays free to keep workflow
// building open to everyone.
const premiumNodes = new Set<NodeType>(["agent"])

// The Toolbar tab: a button per node type that adds it to the canvas.
function Palette() {
  const [query, setQuery] = useState("")
  // The shared React Flow store (lifted to a provider above the canvas and this
  // sidebar) lets us read the current nodes/viewport and add to them from here.
  const { getNodes, getViewport, addNodes } = useReactFlow<StepNodeType>()
  // The pane's measured size, used to find the center of the current view.
  const width = useStore((s) => s.width)
  const height = useStore((s) => s.height)
  // Whether the active org is on Pro, plus a way to send them to upgrade. Gates
  // the premium nodes below.
  const { isLoaded, isPro, goToUpgrade } = useProPlan()

  // A premium node is locked until the plan check has loaded and confirms Pro.
  // We wait for `isLoaded` so a Pro org never flashes a locked state on mount.
  const isLocked = (type: NodeType) =>
    premiumNodes.has(type) && isLoaded && !isPro

  const add = (type: NodeType) => {
    // Premium nodes route to upgrade instead of being added for non-pro orgs.
    if (isLocked(type)) {
      goToUpgrade()
      return
    }

    const def = nodeRegistry[type]
    const nodes = getNodes()

    // Only one trigger is allowed — a workflow has a single entry point.
    if (
      def.kind === "trigger" &&
      nodes.some((n) => n.data.kind === "trigger")
    ) {
      toast.error("A workflow can only have one trigger.")
      return
    }

    // Number nodes of the same type (e.g. "Open URL 1", "Open URL 2") so
    // duplicates stay easy to tell apart.
    const count = nodes.filter((n) => n.data.type === type).length
    const title = `${def.label} ${count + 1}`

    // Drop the node in the middle of the current view. The viewport transform
    // maps a flow point p to the screen as p * zoom + {x, y}, so the pane center
    // in flow coordinates is (center - offset) / zoom.
    const { x, y, zoom } = getViewport()
    const position = {
      x: (width / 2 - x) / zoom,
      y: (height / 2 - y) / zoom,
    }

    addNodes({
      id: crypto.randomUUID(),
      type: "step",
      position,
      data: { type, kind: def.kind, title, values: {} },
    })
  }

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matchingDefinitions = definitions.filter((definition) =>
    definition.label.toLocaleLowerCase().includes(normalizedQuery)
  )

  return (
    <Section title="Add steps" icon={<Plus className="size-3.5" />}>
      <div className="flex flex-col gap-2 px-3 pt-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search steps"
            aria-label="Search workflow steps"
            className="pl-8 text-xs"
          />
        </div>
        <p className="text-[10px] text-muted-foreground">
          Select a step to add it to the canvas.
        </p>
      </div>
      <Accordion
        type="multiple"
        defaultValue={sections.map((s) => s.kind)}
        className="px-3 py-2"
      >
        {sections.map((section) => {
          const sectionDefinitions = matchingDefinitions.filter(
            (definition) => definition.kind === section.kind
          )
          if (sectionDefinitions.length === 0) return null

          return (
            <AccordionItem
              key={section.kind}
              value={section.kind}
              className="not-last:border-b-0"
            >
              <AccordionTrigger className="py-2 text-xs font-medium text-muted-foreground hover:no-underline">
                {section.label}
              </AccordionTrigger>
              <AccordionContent className="flex flex-col gap-0.5">
                {sectionDefinitions.map((def) => {
                  const type = def.type as NodeType
                  const locked = isLocked(type)
                  return (
                    <Button
                      key={def.type}
                      variant="ghost"
                      onClick={() => add(type)}
                      title={
                        locked ? "Upgrade to Pro to add this node" : undefined
                      }
                      className="h-9 justify-start gap-2.5 rounded-lg px-2 text-xs"
                    >
                      <NodeIcon type={type} />
                      {def.label}
                      {locked && (
                        <Lock className="ml-auto size-3.5 text-muted-foreground" />
                      )}
                    </Button>
                  )
                })}
              </AccordionContent>
            </AccordionItem>
          )
        })}
        {matchingDefinitions.length === 0 && (
          <p className="px-1 py-3 text-xs text-muted-foreground">
            No steps match that search.
          </p>
        )}
      </Accordion>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Header — workflow-level actions shown above the tabs.
// ---------------------------------------------------------------------------

type WorkflowMetadata = Pick<
  Workflow,
  "name" | "goalText" | "generationStatus" | "graph"
>

const generationStatusLabels: Record<WorkflowGenerationStatus, string> = {
  idle: "Manual draft",
  pending_generation: "Awaiting plan",
  generated: "Plan ready",
  failed: "Plan failed",
}

function WorkflowNameEditor({
  workflowId,
  initialName,
}: {
  workflowId: string
  initialName: string
}) {
  const [name, setName] = useState(initialName)
  const [isPending, startTransition] = useTransition()

  const save = () => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === initialName) {
      setName(initialName)
      return
    }
    startTransition(async () => {
      try {
        await renameWorkflowAction(workflowId, trimmed)
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Couldn't rename the workflow."
        )
        setName(initialName)
      }
    })
  }

  return (
    <div className="border-b border-border px-3 py-2.5">
      <Label
        htmlFor="workflow-name"
        className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
      >
        Workflow name
      </Label>
      <Input
        id="workflow-name"
        value={name}
        disabled={isPending}
        maxLength={120}
        onChange={(event) => setName(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            event.currentTarget.blur()
          }
        }}
        className="mt-1 h-8 text-sm"
      />
    </div>
  )
}

function GoalSummary({ workflow }: { workflow: WorkflowMetadata }) {
  if (!workflow.goalText) {
    return null
  }

  return (
    <div className="border-b border-border px-3 py-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Workflow goal
        </p>
        <Badge variant="secondary">
          {generationStatusLabels[workflow.generationStatus]}
        </Badge>
      </div>
      <p className="line-clamp-3 text-xs leading-relaxed">
        {workflow.goalText}
      </p>
    </div>
  )
}

// The "..." menu for workflow-level actions.
function ActionsMenu({ workflowId }: { workflowId: string }) {
  const [isPending, startTransition] = useTransition()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        <DropdownMenuItem
          variant="destructive"
          disabled={isPending}
          className="text-xs [&_svg:not([class*='size-'])]:size-3.5"
          onSelect={(e) => {
            // Keep the menu mounted while the delete runs so the disabled state
            // stays visible. Running inside a transition lets the router handle
            // the action's redirect home on success.
            e.preventDefault()
            startTransition(async () => {
              await deleteWorkflowAction(workflowId)
            })
          }}
        >
          <Trash2 />
          Delete workflow
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Toggles between running the current workflow and stopping the run in flight.
// While a run is live it becomes a Stop button that cancels that run; otherwise
// it validates the graph and kicks off a new run.
function RunButton({ workflowId }: { workflowId: string }) {
  const { getNodes, getEdges } = useReactFlow<StepNodeType>()
  const [isPending, startTransition] = useTransition()
  const [stoppingRunId, setStoppingRunId] = useState<string | null>(null)
  const [startingRunId, setStartingRunId] = useState<string | null>(null)
  const refreshRuns = useRefreshWorkflowRuns()
  const runs = useConsoleRuns()
  const isAwaitingRun =
    startingRunId !== null && !runs.some((run) => run.id === startingRunId)

  // The run in flight, if any. At most one is live at a time, so its presence
  // decides which mode the button is in.
  const liveRun = useLiveRun()

  if (liveRun) {
    const isStopping = stoppingRunId === liveRun.id
    return (
      <Button
        size="sm"
        variant="destructive"
        disabled={isPending || isStopping}
        onClick={() => {
          setStoppingRunId(liveRun.id)
          startTransition(async () => {
            try {
              await cancelWorkflowRunAction(liveRun.id)
              refreshRuns()
            } catch {
              setStoppingRunId(null)
              toast.error("Couldn't stop the run.")
            }
          })
        }}
      >
        <Square fill="currentColor" />
        {isStopping ? "Stopping…" : "Stop"}
      </Button>
    )
  }

  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => {
        setStoppingRunId(null)
        const graph = { nodes: getNodes(), edges: getEdges() }
        const problems = validateGraph(graph)
        if (problems.length > 0) {
          toast.error(problems[0])
          return
        }

        startTransition(async () => {
          try {
            const handle = await runWorkflowAction({ id: workflowId, graph })
            setStartingRunId(handle.id)
            refreshRuns()
          } catch (error) {
            toast.error(
              error instanceof Error
                ? error.message
                : "Couldn't start the workflow."
            )
          }
        })
      }}
      disabled={isPending || isAwaitingRun}
    >
      {isPending || isAwaitingRun ? (
        <Spinner className="size-4" />
      ) : (
        <Play fill="primary" />
      )}
      {isPending || isAwaitingRun ? "Starting…" : "Run"}
    </Button>
  )
}

// ---------------------------------------------------------------------------
// The sidebar itself — header on top, then the Toolbar / Editor tabs.
// ---------------------------------------------------------------------------

export function RightSidebar({
  workflowId,
  workflow,
  attachments,
}: {
  workflowId: string
  workflow: WorkflowMetadata
  attachments: Pick<
    WorkflowAttachment,
    "id" | "filename" | "contentType" | "size"
  >[]
}) {
  const [tab, setTab] = useState("toolbar")

  // TODO: read the currently selected node from React Flow.
  const selected = useStore((s) => s.nodes.find((n) => n.selected)) as
    StepNodeType | undefined

  // TODO: auto-switch to the Editor tab when the selection changes.
  const [prevSelectedId, setPrevSelectedId] = useState(selected?.id)
  if (selected && selected.id !== prevSelectedId) {
    setPrevSelectedId(selected.id)
    setTab("editor")
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-y-contain bg-background">
      <Tabs
        value={tab}
        onValueChange={setTab}
        className="flex min-h-full flex-col gap-0"
      >
        <div className="sticky top-0 z-20 flex shrink-0 items-center justify-between border-b border-border bg-background/95 px-3 py-2 backdrop-blur">
          <div>
            <p className="text-xs font-semibold">Workflow settings</p>
            <p className="text-[11px] text-muted-foreground">
              Steps, files, and run controls
            </p>
          </div>
          <ActionsMenu workflowId={workflowId} />
          <RunButton workflowId={workflowId} />
        </div>
        <WorkflowNameEditor
          key={workflow.name}
          workflowId={workflowId}
          initialName={workflow.name}
        />
        <GoalSummary workflow={workflow} />
        <WorkflowAttachments
          workflowId={workflowId}
          initialAttachments={attachments}
        />
        <TabsList className="sticky top-12 z-10 mx-3 my-2 w-fit shrink-0 bg-muted/90 backdrop-blur">
          <TabsTrigger
            value="toolbar"
            className="flex-none rounded-sm data-active:bg-accent! data-active:text-accent-foreground! data-active:shadow-none! dark:data-active:border-transparent!"
          >
            Add steps
          </TabsTrigger>
          <TabsTrigger
            value="editor"
            className="flex-none rounded-sm data-active:bg-accent! data-active:text-accent-foreground! data-active:shadow-none! dark:data-active:border-transparent!"
          >
            Properties
          </TabsTrigger>
        </TabsList>
        <TabsContent
          value="toolbar"
          className="flex min-h-80 flex-1 shrink-0 flex-col overflow-hidden"
        >
          <Palette />
        </TabsContent>
        <TabsContent
          value="editor"
          className="flex min-h-80 flex-1 shrink-0 flex-col overflow-hidden"
        >
          <Inspector key={selected?.id} node={selected} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
