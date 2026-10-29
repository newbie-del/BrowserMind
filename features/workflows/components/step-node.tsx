import { memo } from "react"
import {
  Handle,
  NodeToolbar,
  Position,
  useReactFlow,
  type NodeProps,
} from "@xyflow/react"
import { Check, Trash2, X } from "lucide-react"
import { toast } from "sonner"

import {
  nodeRegistry,
  type StepNodeType,
} from "@/features/workflows/nodes/node-registry"
import { useLatestRunSteps } from "@/features/workflows/components/workflow-runs-provider"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

function StepNodeComponent({ id, data, selected }: NodeProps<StepNodeType>) {
  const { deleteElements } = useReactFlow<StepNodeType>()
  const { type, kind, title, values } = data
  const def = nodeRegistry[type]
  const Icon = def.icon
  const fields = def.fields.filter((field) => values[field.key])

  // Reflect this node's state in the latest run. A node is only "running" while
  // the run is actually live — once it ends, a node left marked running stops
  // spinning rather than hanging forever.
  const { steps, isLive } = useLatestRunSteps()
  const status = steps.find((step) => step.nodeId === id)?.status
  const isRunning = status === "running" && isLive
  const isFailed = status === "failed"
  const isDone = status === "done"

  // A trigger starts the flow and takes no input, so it has no target handle.
  const hasTarget = kind !== "trigger"

  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}>
        <button
          type="button"
          aria-label={`Delete ${title} step`}
          title="Delete step"
          className="flex size-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-destructive hover:text-destructive-foreground"
          onClick={async (event) => {
            event.stopPropagation()
            try {
              await deleteElements({ nodes: [{ id }] })
            } catch {
              toast.error(`Couldn't delete the ${title} step.`)
            }
          }}
        >
          <Trash2 className="size-4" />
        </button>
      </NodeToolbar>
      <div
        className={cn(
          "relative min-w-50 max-w-80 rounded-(--radius) border-2 border-border bg-card text-card-foreground",
          isRunning && "border-blue-500",
          isDone && "border-green-600/70",
          isFailed && "border-destructive",
          selected && "ring-2 ring-ring ring-offset-2 ring-offset-background"
        )}
      >
        {(isDone || isFailed) && (
          <span
            aria-label={isFailed ? "Step failed" : "Step done"}
            className={cn(
              "absolute -right-2 -top-2 z-10 flex size-5 items-center justify-center rounded-full text-white shadow",
              isFailed ? "bg-destructive" : "bg-green-600"
            )}
          >
            {isFailed ? <X className="size-3" /> : <Check className="size-3" />}
          </span>
        )}
        {hasTarget && (
          <Handle
            type="target"
            position={Position.Left}
            style={{ transform: "translate(-100%, -50%)" }}
            className="h-3.5! w-1.5! min-w-0! rounded-l-xs! rounded-r-none! border-0! bg-border!"
          />
        )}

        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <div
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-md",
              def.accent
            )}
          >
            {isRunning ? <Spinner className="size-4" /> : <Icon className="size-4" />}
          </div>
          <span className="text-sm font-semibold">{title}</span>
        </div>

        {fields.length > 0 && (
          <>
            <div className="border-t border-border" />
            <div className="flex flex-col gap-1.5 px-3 py-2.5">
              {fields.map((field) => (
                <div
                  key={field.key}
                  className="flex items-center justify-between gap-4 text-xs"
                >
                  <span className="shrink-0 text-muted-foreground">{field.label}</span>
                  <span className="truncate font-medium">{values[field.key]}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <Handle
          type="source"
          position={Position.Right}
          style={{ transform: "translate(100%, -50%)" }}
          className="h-3.5! w-1.5! min-w-0! rounded-l-none! rounded-r-xs! border-0! bg-border!"
        />
      </div>
    </>
  )
}

export const StepNode = memo(StepNodeComponent)
