"use client"

import { useRef, useState } from "react"
import {
  FileImage,
  FileText,
  Loader2,
  Paperclip,
  ShieldCheck,
  Trash2,
  UploadCloud,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import type { WorkflowAttachment } from "@/lib/db/schema"

type Attachment = Pick<
  WorkflowAttachment,
  "id" | "filename" | "contentType" | "size"
>

const MAX_FILE_SIZE = 4 * 1024 * 1024
const MAX_TOTAL_SIZE = 20 * 1024 * 1024
const MAX_ATTACHMENTS = 10

function formatSize(size: number) {
  return size < 1024 * 1024
    ? `${Math.ceil(size / 1024)} KB`
    : `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function isAttachment(value: unknown): value is Attachment {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "filename" in value &&
    typeof value.filename === "string" &&
    "contentType" in value &&
    typeof value.contentType === "string" &&
    "size" in value &&
    typeof value.size === "number"
  )
}

export function WorkflowAttachments({
  workflowId,
  initialAttachments,
}: {
  workflowId: string
  initialAttachments: Attachment[]
}) {
  const [attachments, setAttachments] = useState(initialAttachments)
  const [isUploading, setIsUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const totalSize = attachments.reduce((total, file) => total + file.size, 0)
  const remainingCount = Math.max(0, MAX_ATTACHMENTS - attachments.length)
  const storagePercent = Math.min((totalSize / MAX_TOTAL_SIZE) * 100, 100)

  const uploadFiles = async (files: FileList | File[] | null) => {
    if (!files?.length) return
    setIsUploading(true)
    let currentCount = attachments.length
    let currentTotalSize = totalSize

    try {
      for (const file of Array.from(files)) {
        if (currentCount >= MAX_ATTACHMENTS) {
          throw new Error(
            `A workflow can have at most ${MAX_ATTACHMENTS} documents.`
          )
        }
        if (file.size > MAX_FILE_SIZE) {
          throw new Error(`${file.name} is over the 4 MB per-file limit.`)
        }
        if (currentTotalSize + file.size > MAX_TOTAL_SIZE) {
          throw new Error(
            "These documents would exceed the 20 MB workflow limit."
          )
        }

        const form = new FormData()
        form.set("file", file)
        const response = await fetch(
          `/api/workflows/${workflowId}/attachments`,
          { method: "POST", body: form }
        )
        const result: unknown = await response.json()
        if (!response.ok) {
          const errorMessage =
            typeof result === "object" &&
            result !== null &&
            "error" in result &&
            typeof result.error === "string"
              ? result.error
              : `Could not upload ${file.name}.`
          throw new Error(errorMessage)
        }
        if (!isAttachment(result)) {
          throw new Error(
            `The server returned an invalid response for ${file.name}.`
          )
        }

        setAttachments((current) => [result, ...current])
        currentCount += 1
        currentTotalSize += file.size
      }
      toast.success("Documents attached to this workflow.")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not upload documents."
      )
    } finally {
      setIsUploading(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  const removeAttachment = async (attachment: Attachment) => {
    setDeletingId(attachment.id)
    try {
      const response = await fetch(
        `/api/workflows/${workflowId}/attachments/${attachment.id}`,
        { method: "DELETE" }
      )
      if (!response.ok) {
        const result = (await response.json()) as { error?: string }
        throw new Error(result.error ?? "Could not remove document.")
      }
      setAttachments((current) =>
        current.filter((item) => item.id !== attachment.id)
      )
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not remove document."
      )
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <details className="group border-b border-border" open>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-3 text-xs font-semibold [&::-webkit-details-marker]:hidden">
        <Paperclip className="size-3.5 text-muted-foreground" />
        <span>Reference documents</span>
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground tabular-nums">
          {attachments.length}/{MAX_ATTACHMENTS}
        </span>
      </summary>
      <div className="flex flex-col gap-3 px-3 pb-3">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Attach PDFs or images for the agent to use as source material for this
          workflow.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
          multiple
          className="sr-only"
          onChange={(event) => void uploadFiles(event.target.files)}
          disabled={isUploading}
        />
        <Button
          type="button"
          variant="outline"
          className={`h-auto min-h-20 w-full flex-col gap-1.5 border-dashed px-3 py-3 text-center ${
            isDragging ? "bg-accent ring-2 ring-ring/30" : "bg-muted/20"
          }`}
          disabled={isUploading || remainingCount === 0}
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => {
            event.preventDefault()
            setIsDragging(true)
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            const target = event.relatedTarget
            if (
              !(target instanceof Node) ||
              !event.currentTarget.contains(target)
            ) {
              setIsDragging(false)
            }
          }}
          onDrop={(event) => {
            event.preventDefault()
            setIsDragging(false)
            void uploadFiles(event.dataTransfer.files)
          }}
        >
          {isUploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <UploadCloud className="size-4 text-muted-foreground" />
          )}
          <span className="text-xs font-medium">
            {isUploading
              ? "Uploading documents…"
              : remainingCount === 0
                ? "Document limit reached"
                : "Drop files here or browse"}
          </span>
          <span className="text-[10px] font-normal text-muted-foreground">
            PDF, PNG, or JPG · up to 4 MB each
          </span>
        </Button>

        {attachments.length > 0 ? (
          <ul className="flex max-h-52 flex-col gap-1 overflow-y-auto">
            {attachments.map((attachment) => {
              const isImage = attachment.contentType.startsWith("image/")
              return (
                <li
                  key={attachment.id}
                  className="flex min-w-0 items-center gap-2 rounded-lg border border-border/70 bg-card px-2 py-2"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                    {isImage ? (
                      <FileImage className="size-4 text-muted-foreground" />
                    ) : (
                      <FileText className="size-4 text-muted-foreground" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className="block truncate text-[11px] font-medium"
                      title={attachment.filename}
                    >
                      {attachment.filename}
                    </span>
                    <span className="block text-[10px] text-muted-foreground">
                      {formatSize(attachment.size)}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${attachment.filename}`}
                    disabled={deletingId === attachment.id || isUploading}
                    onClick={() => void removeAttachment(attachment)}
                  >
                    {deletingId === attachment.id ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Trash2 />
                    )}
                  </Button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="rounded-lg bg-muted/40 px-3 py-2 text-center text-[11px] text-muted-foreground">
            No documents attached yet
          </p>
        )}

        <div className="space-y-1.5">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Document storage used"
            aria-valuenow={totalSize}
            aria-valuemin={0}
            aria-valuemax={MAX_TOTAL_SIZE}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${storagePercent}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{formatSize(totalSize)} used</span>
            <span>20 MB total</span>
          </div>
        </div>

        <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3 shrink-0" />
          Files persist with this workflow and are sent to OpenAI for analysis
          when the workflow runs.
        </p>
      </div>
    </details>
  )
}
