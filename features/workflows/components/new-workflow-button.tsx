"use client"

import { useTransition } from "react"
import { PlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { createWorkflowAction } from "@/features/workflows/actions"

export function NewWorkflowButton() {
  const [isPending, startTransition] = useTransition()

  return (
    <Button
      variant="outline"
      className="gap-2"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          await createWorkflowAction("Untitled workflow")
        })
      }}
    >
      <PlusIcon />
      {isPending ? "Creating workflow…" : "New workflow"}
    </Button>
  )
}
