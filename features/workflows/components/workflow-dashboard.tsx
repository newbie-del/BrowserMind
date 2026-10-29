"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  ArrowDownWideNarrow,
  ArrowUpRight,
  CircleAlert,
  Clock3,
  FileText,
  Search,
  Sparkles,
  Workflow as WorkflowIcon,
} from "lucide-react"
import { formatDistanceToNow } from "date-fns"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { GoalWorkflowForm } from "@/features/workflows/components/goal-workflow-form"
import { NewWorkflowButton } from "@/features/workflows/components/new-workflow-button"
import type { Workflow } from "@/lib/db/schema"

type Filter = "all" | "goal" | "manual"

function statusFor(workflow: Workflow) {
  if (workflow.generationStatus === "failed") {
    return { label: "Needs attention", variant: "destructive" as const }
  }
  if (workflow.graph) {
    return { label: "Ready to edit", variant: "secondary" as const }
  }
  return { label: "Draft", variant: "outline" as const }
}

export function WorkflowDashboard({ workflows }: { workflows: Workflow[] }) {
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const [sortNewestFirst, setSortNewestFirst] = useState(true)

  const goalBasedCount = workflows.filter(
    (workflow) => workflow.goalText
  ).length
  const attentionCount = workflows.filter(
    (workflow) => workflow.generationStatus === "failed"
  ).length

  const visibleWorkflows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return workflows
      .filter((workflow) => {
        const matchesSearch =
          !query ||
          workflow.name.toLocaleLowerCase().includes(query) ||
          workflow.goalText?.toLocaleLowerCase().includes(query)
        const matchesFilter =
          filter === "all" ||
          (filter === "goal" && Boolean(workflow.goalText)) ||
          (filter === "manual" && !workflow.goalText)
        return matchesSearch && matchesFilter
      })
      .sort((a, b) =>
        sortNewestFirst
          ? b.updatedAt.getTime() - a.updatedAt.getTime()
          : a.updatedAt.getTime() - b.updatedAt.getTime()
      )
  }, [filter, search, sortNewestFirst, workflows])

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-5 py-8 md:px-8 md:py-10">
        <header className="flex flex-wrap items-end justify-between gap-5">
          <div className="max-w-2xl">
            <p className="mb-2 text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
              Workspace
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">
              Build your browser workflows
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Describe the task or open a workflow to edit each step.
            </p>
          </div>
          <NewWorkflowButton />
        </header>

        <section
          id="create-from-goal"
          className="grid gap-6 rounded-2xl border border-border bg-card p-5 shadow-sm md:grid-cols-[minmax(0,1fr)_15rem] md:items-center md:p-7"
        >
          <div className="min-w-0">
            <div className="mb-4 flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-muted">
                <Sparkles className="size-4" />
              </span>
              <div>
                <h2 className="text-base font-semibold">Create from a goal</h2>
                <p className="text-xs text-muted-foreground">
                  Start with plain language; you can refine the workflow later.
                </p>
              </div>
            </div>
            <GoalWorkflowForm />
          </div>
          <div className="hidden rounded-xl border border-border bg-muted/40 p-4 md:block">
            <p className="text-xs font-medium">A good starting prompt</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Describe the website, the information to use, and what the agent
              should return. Attach reference documents inside the workflow.
            </p>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          <SummaryCard
            icon={<WorkflowIcon className="size-4" />}
            label="Workflows"
            value={workflows.length}
            detail="In this workspace"
          />
          <SummaryCard
            icon={<Sparkles className="size-4" />}
            label="Goal-based"
            value={goalBasedCount}
            detail="Planned from a description"
          />
          <SummaryCard
            icon={<CircleAlert className="size-4" />}
            label="Need attention"
            value={attentionCount}
            detail="Planning needs a retry"
          />
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Your workflows</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {workflows.length
                  ? "Search, filter, and continue where you left off."
                  : "Workflows you create will appear here."}
              </p>
            </div>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <label className="relative min-w-44 flex-1 sm:w-56 sm:flex-none">
                <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search workflows"
                  aria-label="Search workflows"
                  className="pl-9"
                />
              </label>
              <Button
                variant="outline"
                size="icon"
                aria-label={
                  sortNewestFirst
                    ? "Sort oldest updated first"
                    : "Sort newest updated first"
                }
                title={
                  sortNewestFirst
                    ? "Sort oldest updated first"
                    : "Sort newest updated first"
                }
                onClick={() => setSortNewestFirst((current) => !current)}
              >
                <ArrowDownWideNarrow
                  className={sortNewestFirst ? "" : "rotate-180"}
                />
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1 border-b border-border">
            {(
              [
                ["all", "All"],
                ["goal", "Goal-based"],
                ["manual", "Manual"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`border-b-2 px-3 py-2 text-sm transition-colors ${
                  filter === value
                    ? "border-foreground font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                aria-pressed={filter === value}
              >
                {label}
              </button>
            ))}
          </div>

          {visibleWorkflows.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visibleWorkflows.map((workflow) => {
                const status = statusFor(workflow)
                return (
                  <Link
                    key={workflow.id}
                    href={`/workflows/${workflow.id}`}
                    className="group flex min-h-52 flex-col rounded-xl border border-border bg-card p-4 transition-colors hover:border-foreground/25 hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                        {workflow.goalText ? (
                          <Sparkles className="size-4" />
                        ) : (
                          <FileText className="size-4" />
                        )}
                      </span>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </div>
                    <h3 className="mt-4 line-clamp-1 font-semibold">
                      {workflow.name}
                    </h3>
                    <p className="mt-1 line-clamp-2 min-h-10 text-sm leading-relaxed text-muted-foreground">
                      {workflow.goalText ||
                        "A manual workflow. Open it to add triggers and actions."}
                    </p>
                    <div className="mt-auto flex items-center justify-between gap-2 pt-4 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <Clock3 className="size-3.5" />
                        Updated{" "}
                        {formatDistanceToNow(workflow.updatedAt, {
                          addSuffix: true,
                        })}
                      </span>
                      <span className="inline-flex items-center gap-1 font-medium text-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                        Open <ArrowUpRight className="size-3.5" />
                      </span>
                    </div>
                  </Link>
                )
              })}
            </div>
          ) : (
            <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 text-center">
              <span className="flex size-11 items-center justify-center rounded-full bg-muted">
                <Search className="size-5 text-muted-foreground" />
              </span>
              <p className="mt-3 font-medium">
                {workflows.length
                  ? "No matching workflows"
                  : "Nothing here yet"}
              </p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                {workflows.length
                  ? "Try another search or filter."
                  : "Create your first workflow from the goal form above."}
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

function SummaryCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode
  label: string
  value: number
  detail: string
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="mt-0.5 flex items-baseline gap-2">
          <p className="text-xl font-semibold tabular-nums">{value}</p>
          <p className="truncate text-xs text-muted-foreground">{detail}</p>
        </div>
      </div>
    </div>
  )
}
