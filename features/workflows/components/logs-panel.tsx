"use client"

import { useState, useTransition } from "react"
import prettyMilliseconds from "pretty-ms"
import { Check, Lock, MonitorPlay, X } from "lucide-react"

import { cn } from "@/lib/utils"

import { NodeIcon } from "@/features/workflows/components/node-icon"
import { useProPlan } from "@/features/workflows/hooks/use-pro-plan"
import {
  useConsoleRuns,
  useWorkflowRunsError,
  type ConsoleRun,
} from "@/features/workflows/components/workflow-runs-provider"
import type { RunStep } from "@/features/workflows/tasks/run-workflow"
import { resolveWorkflowApprovalAction } from "@/features/workflows/actions"

// A step is identified across the whole console by which run it belongs to and
// which node it is — the same node id recurs across runs, so both are needed.
export interface StepSelection {
  kind: "step"
  runId: string
  nodeId: string
}

// The replay of a whole run, not a single step — identified by its run alone.
export interface ReplaySelection {
  kind: "replay"
  runId: string
}

export interface LiveSelection {
  kind: "live"
  runId: string
}

// What the console can have selected: one step's output, or one run's replay.
// Only one is active at a time.
export type ConsoleSelection = StepSelection | ReplaySelection | LiveSelection

// One step row: the node's icon, its title, and how long it took. It spins while
// running, reads red when it failed, and dims when it never ran. Clicking it
// toggles selection via the ConsolePanel above.
function StepRow({
  run,
  step,
  isSelected,
  onSelect,
}: {
  run: ConsoleRun
  step: RunStep
  isSelected: boolean
  onSelect: (selection: StepSelection) => void
}) {
  // Only spin while the run is actually live — a step left "running" by a run
  // that has since ended should stop rather than hang forever.
  const isRunning = step.status === "running" && run.isLive
  const isFailed = step.status === "failed"
  const isInactive = step.status === "pending"
  const isDone = step.status === "done"
  const statusLabel = isRunning
    ? "Executing"
    : isFailed
      ? "Failed"
      : isDone
        ? "Completed"
        : "Waiting"

  return (
    <button
      type="button"
      onClick={() => onSelect({ kind: "step", runId: run.id, nodeId: step.nodeId })}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-accent",
        isSelected && "bg-accent",
        isInactive && "opacity-50"
      )}
    >
      <NodeIcon type={step.type} running={isRunning} />
      <span className={cn("truncate font-medium", isFailed && "text-destructive")}>
        {step.title}
      </span>
      <span
        className={cn(
          "ml-auto flex shrink-0 items-center gap-1 text-[10px]",
          isFailed ? "text-destructive" : "text-muted-foreground"
        )}
      >
        {isDone && <Check aria-hidden="true" className="size-3 text-green-600" />}
        {isFailed && <X aria-hidden="true" className="size-3" />}
        {statusLabel}
      </span>
      {step.durationMs != null && (
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {prettyMilliseconds(step.durationMs)}
        </span>
      )}
    </button>
  )
}

// The replay row for a finished run: it sits with the step rows and selects the
// same way, but it stands for the whole run's recording rather than one step.
function ReplayRow({
  run,
  isSelected,
  onSelect,
}: {
  run: ConsoleRun
  isSelected: boolean
  onSelect: (selection: ReplaySelection) => void
}) {
  // Watching a recording is a Pro feature. Wait for `isLoaded` so a Pro org
  // never flashes a locked state on mount.
  const { isLoaded, isPro, goToUpgrade } = useProPlan()
  const isLocked = isLoaded && !isPro

  return (
    <button
      type="button"
      // Locked rows send the user to upgrade instead of opening the recording.
      onClick={() =>
        isLocked ? goToUpgrade() : onSelect({ kind: "replay", runId: run.id })
      }
      title={isLocked ? "Upgrade to Pro to watch replays" : undefined}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-accent",
        isSelected && "bg-accent"
      )}
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <MonitorPlay className="size-3.5" />
      </span>
      <span className="truncate font-medium">Replay</span>
      {isLocked && (
        <Lock className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
      )}
    </button>
  )
}

function LiveRow({
  run,
  isSelected,
  onSelect,
}: {
  run: ConsoleRun
  isSelected: boolean
  onSelect: (selection: LiveSelection) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect({ kind: "live", runId: run.id })}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-accent",
        isSelected && "bg-accent"
      )}
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-green-500/15 text-green-500">
        <MonitorPlay className="size-3.5" />
      </span>
      <span className="truncate font-medium">Live browser</span>
    </button>
  )
}

// A pending human-in-the-loop approval: the run is paused on a Trigger.dev
// waitpoint. Approve/Reject completes the token and resumes the run. Renders
// nothing unless this run is actually waiting for a decision.
function ApprovalRow({ run }: { run: ConsoleRun }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const approval = run.approval
  if (!approval || approval.status !== "pending" || !approval.tokenId) {
    return null
  }
  const tokenId = approval.tokenId
  const resolve = (approved: boolean) => {
    setError(null)
    startTransition(async () => {
      try {
        await resolveWorkflowApprovalAction({ tokenId, approved })
      } catch (resolveError) {
        setError(
          resolveError instanceof Error
            ? resolveError.message
            : String(resolveError)
        )
      }
    })
  }
  return (
    <div className="mx-2 my-1 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-2 text-xs">
      <div className="mb-1 font-medium text-yellow-700 dark:text-yellow-400">
        Approval required
      </div>
      {approval.reason && (
        <p className="mb-2 text-muted-foreground">{approval.reason}</p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => resolve(true)}
          className="rounded-md bg-green-600 px-2.5 py-1 font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          {isPending ? "…" : "Approve"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => resolve(false)}
          className="rounded-md bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
      {error && <p className="mt-1 text-destructive">{error}</p>}
    </div>
  )
}

// The list of runs, newest first, each with its steps below it. Reads the shared
// realtime run history and reports step clicks up to the ConsolePanel, which owns
// the selection.
export function LogsPanel({
  selected,
  onSelect,
}: {
  selected: ConsoleSelection | null
  onSelect: (selection: ConsoleSelection) => void
}) {
  const runs = useConsoleRuns()
  const error = useWorkflowRunsError()

  if (runs.length === 0) {
    return (
      <div
        role={error ? "alert" : undefined}
        className="flex size-full items-center justify-center px-4 text-center text-sm text-muted-foreground"
      >
        {error ? `Couldn't load run updates: ${error.message}` : "No runs yet"}
      </div>
    )
  }

  return (
    <div className="flex size-full flex-col gap-3 overflow-y-auto p-2">
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-xs text-destructive"
        >
          Live run updates disconnected: {error.message}
        </div>
      )}
      {runs.map((run) => (
        <div key={run.id} className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-muted-foreground">
            <span>{run.createdAt.toLocaleTimeString()}</span>
            <span className="lowercase">{run.status}</span>
          </div>
          {run.steps.map((step) => (
            <StepRow
              key={step.nodeId}
              run={run}
              step={step}
              isSelected={
                selected?.kind === "step" &&
                selected.runId === run.id &&
                selected.nodeId === step.nodeId
              }
              onSelect={onSelect}
            />
          ))}
          <ApprovalRow run={run} />
          {run.isLive && run.liveViewUrl && (
            <LiveRow
              run={run}
              isSelected={
                selected?.kind === "live" && selected.runId === run.id
              }
              onSelect={onSelect}
            />
          )}
          {/* A recording only exists once the run has finished — its session id
              is present and it's no longer live. */}
          {run.browserbaseSessionId && !run.isLive && (
            <ReplayRow
              run={run}
              isSelected={
                selected?.kind === "replay" && selected.runId === run.id
              }
              onSelect={onSelect}
            />
          )}
          {run.email && run.email.status !== "not-configured" && (
            <div
              className={cn(
                "px-2 py-1 text-[11px]",
                run.email.status === "failed"
                  ? "text-destructive"
                  : "text-muted-foreground"
              )}
            >
              {run.email.status === "sent"
                ? `Results email sent${run.email.to ? ` to ${run.email.to}` : ""}`
                : run.email.status === "skipped"
                  ? `Results email skipped${run.email.reason ? ` (${run.email.reason})` : ""}`
                  : `Results email failed${run.email.error ? `: ${run.email.error}` : ""}`}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
