"use client"

import { FormEvent, useState, useTransition } from "react"
import { SparklesIcon } from "lucide-react"
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
    <form onSubmit={handleSubmit} className="w-full max-w-2xl">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="workflow-goal">
            What should BrowserMind do?
          </FieldLabel>
          <Textarea
            id="workflow-goal"
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            maxLength={MAX_GOAL_LENGTH}
            placeholder="Find suitable software engineering opportunities this week."
            className="min-h-28 max-h-[45vh] resize-y overflow-y-auto"
            disabled={isPending}
          />
          <FieldDescription>{remaining} characters left</FieldDescription>
        </Field>
        <Button
          type="submit"
          className="self-start"
          disabled={isPending || goal.trim().length === 0}
        >
          <SparklesIcon />
          Create from goal
        </Button>
      </FieldGroup>
    </form>
  )
}
