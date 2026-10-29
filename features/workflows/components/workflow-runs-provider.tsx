"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import {
  useRealtimeRun,
  useRealtimeRunsWithTag,
} from "@trigger.dev/react-hooks"

import type { RunStep, runWorkflowTask } from "@/features/workflows/tasks/run-workflow"

type WorkflowRun = ReturnType<
  typeof useRealtimeRunsWithTag<typeof runWorkflowTask>
>["runs"][number]

interface WorkflowRunsContextValue {
  runs: WorkflowRun[]
  error?: Error
  refreshRuns: () => void
}

const WorkflowRunsContext = createContext<WorkflowRunsContextValue | null>(null)

interface WorkflowRunsProviderProps {
  workflowId: string
  // A Public Access Token scoped to read this workflow's runs, minted on the
  // server (auth.createPublicToken) and handed down as a prop.
  accessToken: string
  children: React.ReactNode
}

// One shared realtime subscription to every run tagged workflow:<id>. Any
// component on the canvas reads it through the hooks below instead of opening
// its own socket.
export function WorkflowRunsProvider({
  workflowId,
  accessToken,
  children,
}: WorkflowRunsProviderProps) {
  const [subscriptionVersion, setSubscriptionVersion] = useState(0)
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [error, setError] = useState<Error>()
  const refreshRuns = useCallback(
    () => setSubscriptionVersion((version) => version + 1),
    []
  )
  const receiveRuns = useCallback((nextRuns: WorkflowRun[]) => {
    setRuns((currentRuns) =>
      JSON.stringify(currentRuns) === JSON.stringify(nextRuns)
        ? currentRuns
        : nextRuns
    )
  }, [])
  const receiveError = useCallback((nextError?: Error) => {
    setError(nextError)
  }, [])

  // Self-heal a frozen realtime stream. A long run can drop the live connection,
  // leaving the UI stuck on "executing" after the run actually finished. When the
  // tab becomes visible again (e.g. after switching to the inbox to read the
  // results email) or the network reconnects, re-subscribe so it re-fetches the
  // current — now completed — run state.
  useEffect(() => {
    const resubscribe = () => {
      if (document.visibilityState === "visible") {
        setSubscriptionVersion((version) => version + 1)
      }
    }
    document.addEventListener("visibilitychange", resubscribe)
    window.addEventListener("online", resubscribe)
    return () => {
      document.removeEventListener("visibilitychange", resubscribe)
      window.removeEventListener("online", resubscribe)
    }
  }, [])

  const newestLiveRun = useMemo(
    () =>
      runs
        .filter(isRunLive)
        .reduce<WorkflowRun | undefined>(
          (newest, run) =>
            !newest || run.createdAt > newest.createdAt ? run : newest,
          undefined
        ),
    [runs]
  )
  const { run: liveRun } = useRealtimeRun<typeof runWorkflowTask>(
    newestLiveRun?.id,
    { accessToken, enabled: Boolean(newestLiveRun) }
  )
  const currentRuns = useMemo(
    () =>
      liveRun
        ? runs.map((run) => (run.id === liveRun.id ? liveRun : run))
        : runs,
    [liveRun, runs]
  )

  const value = useMemo<WorkflowRunsContextValue>(
    () => ({
      runs: currentRuns,
      error,
      refreshRuns,
    }),
    [currentRuns, error, refreshRuns]
  )

  return (
    <WorkflowRunsContext.Provider value={value}>
      <RunsSubscription
        key={`${workflowId}:${subscriptionVersion}`}
        tag={`workflow:${workflowId}`}
        accessToken={accessToken}
        onRuns={receiveRuns}
        onError={receiveError}
      />
      {children}
    </WorkflowRunsContext.Provider>
  )
}

function RunsSubscription({
  tag,
  accessToken,
  onRuns,
  onError,
}: {
  tag: string
  accessToken: string
  onRuns: (runs: WorkflowRun[]) => void
  onError: (error?: Error) => void
}) {
  const { runs, error } = useRealtimeRunsWithTag<typeof runWorkflowTask>(tag, {
    accessToken,
  })

  useEffect(() => onRuns(runs), [onRuns, runs])
  useEffect(() => onError(error), [error, onError])

  return null
}

export function useRefreshWorkflowRuns() {
  return useWorkflowRuns().refreshRuns
}

export function useWorkflowRunsError() {
  return useWorkflowRuns().error
}

function useWorkflowRuns() {
  const ctx = useContext(WorkflowRunsContext)
  if (!ctx) {
    throw new Error(
      "useWorkflowRuns must be used within a WorkflowRunsProvider"
    )
  }
  return ctx
}

// A run is still producing steps while it's queued or executing.
function isRunLive(run: WorkflowRun): boolean {
  return (
    !run.finishedAt &&
    [
      "DELAYED",
      "DEQUEUED",
      "EXECUTING",
      "FROZEN",
      "PENDING",
      "PENDING_VERSION",
      "QUEUED",
      "REATTEMPTING",
      "WAITING",
      "WAITING_FOR_DEPLOY",
    ].includes(run.status)
  )
}

// The steps of a run, wherever they live. Prefer the run's final output steps
// (guaranteed once it succeeds) and fall back to the live metadata steps the
// task publishes while it runs — a failed or in-flight run only has the latter.
function stepsForRun(run: WorkflowRun): RunStep[] {
  const metadataSteps = run.metadata?.steps as RunStep[] | undefined
  return run.output?.steps ?? metadataSteps ?? []
}

interface LatestRunSteps {
  steps: RunStep[]
  // True while the latest run is queued or executing — i.e. still producing steps.
  isLive: boolean
}

// The steps of the most recent run, plus whether it's still going.
export function useLatestRunSteps(): LatestRunSteps {
  const { runs } = useWorkflowRuns()

  return useMemo<LatestRunSteps>(() => {
    const latest = runs.reduce<WorkflowRun | undefined>((newest, run) => {
      if (!newest || run.createdAt > newest.createdAt) return run
      return newest
    }, undefined)

    if (!latest) return { steps: [], isLive: false }

    return { steps: stepsForRun(latest), isLive: isRunLive(latest) }
  }, [runs])
}

// The run currently in flight, if any — at most one is live at a time. A Stop
// button reads this to know whether there's a run to cancel and, if so, its id.
export function useLiveRun(): WorkflowRun | undefined {
  const { runs } = useWorkflowRuns()

  return useMemo(() => runs.find(isRunLive), [runs])
}

// The Browserbase session id a finished run drove, read from its final output so
// a panel can fetch the replay. Only the output carries it — the recording lags
// the session close, so the live metadata never has it — so an in-flight or
// failed run reports undefined.
function sessionIdForRun(run: WorkflowRun): string | undefined {
  return (
    run.output?.browserbaseSessionId ??
    (run.metadata?.browserbaseSessionId as string | undefined)
  )
}

export type ApprovalMetadata = {
  status: "pending" | "approved" | "rejected" | "timed-out"
  tokenId?: string
  reason?: string | null
  requestedAt?: string
  decidedAt?: string
}

// One run flattened for the console: its identity and status, whether it's still
// live, and its steps with everything each one produced.
export interface ConsoleRun {
  id: string
  status: WorkflowRun["status"]
  createdAt: Date
  isLive: boolean
  steps: RunStep[]
  // The Browserbase session id to replay, present only once the run has finished.
  browserbaseSessionId?: string
  liveViewUrl?: string
  approval?: ApprovalMetadata
  email?: {
    status: "sent" | "failed" | "not-configured" | "skipped"
    to?: string
    error?: string
    reason?: string
  }
}

// Every run, newest first, with its steps resolved — the full history a console
// panel below the canvas renders as a list of runs to drill into.
export function useConsoleRuns(): ConsoleRun[] {
  const { runs } = useWorkflowRuns()

  return useMemo<ConsoleRun[]>(
    () =>
      [...runs]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((run) => ({
          id: run.id,
          status: run.status,
          createdAt: run.createdAt,
          isLive: isRunLive(run),
          steps: stepsForRun(run),
          browserbaseSessionId: sessionIdForRun(run),
          liveViewUrl: run.metadata?.liveViewUrl as string | undefined,
          approval: run.metadata?.approval as ApprovalMetadata | undefined,
          email: run.output?.email,
        })),
    [runs]
  )
}
