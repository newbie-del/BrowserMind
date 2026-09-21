"use client"

import { useRouter } from "next/navigation"
import { PlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
export function NewWorkflowButton() {
  const router = useRouter()

  return (
    <Button onClick={() => router.push("/")}>
      <PlusIcon />
      Create task
    </Button>
  )
}
