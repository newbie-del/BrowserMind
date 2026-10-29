"use client"

import { FormEvent, useState, useTransition } from "react"
import { Loader2, SparklesIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { createWorkflowFromGoalAction } from "@/features/workflows/actions"

const MAX_GOAL_LENGTH = 2_000

export function GoalWorkflowForm() {
  const [goal, setGoal] = useState("")
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    startTransition(async () => {
      try {
        await createWorkflowFromGoalAction(goal)
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not create workflow."
        )
      }
    })
  }

  const remaining = MAX_GOAL_LENGTH - goal.length

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel htmlFor="workflow-goal" className="sr-only">
            What should BrowserMind do?
          </FieldLabel>
          <Textarea
            id="workflow-goal"
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            maxLength={MAX_GOAL_LENGTH}
            placeholder="Describe a task, for example: find suitable internships, compare the requirements, and summarize the application links."
            className="max-h-[45vh] min-h-24 resize-y overflow-y-auto border-border bg-background text-sm leading-relaxed placeholder:text-muted-foreground/80 md:min-h-28"
            disabled={isPending}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <FieldDescription>
              Include the website, information to use, and the result you want.
            </FieldDescription>
            <FieldDescription>{remaining} characters left</FieldDescription>
          </div>
        </Field>
        <Button
          type="submit"
          className="self-start"
          disabled={isPending || goal.trim().length === 0}
        >
          {isPending ? <Loader2 className="animate-spin" /> : <SparklesIcon />}
          {isPending ? "Planning workflow…" : "Create workflow"}
        </Button>
      </FieldGroup>
    </form>
  )
}
