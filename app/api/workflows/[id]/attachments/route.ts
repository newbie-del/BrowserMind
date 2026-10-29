import { auth } from "@clerk/nextjs/server"

import {
  addWorkflowAttachment,
  getWorkflowAttachmentTotalSize,
  listWorkflowAttachments,
  getWorkflow,
} from "@/features/workflows/data"

const MAX_FILE_SIZE = 4 * 1024 * 1024
const MAX_TOTAL_SIZE = 20 * 1024 * 1024
const MAX_ATTACHMENTS = 10

type SupportedDocument = {
  contentType: "application/pdf" | "image/png" | "image/jpeg"
  extension: ".pdf" | ".png" | ".jpg" | ".jpeg"
}

const signatures: SupportedDocument[] = [
  { contentType: "application/pdf", extension: ".pdf" },
  { contentType: "image/png", extension: ".png" },
  { contentType: "image/jpeg", extension: ".jpg" },
  { contentType: "image/jpeg", extension: ".jpeg" },
]

function detectDocument(bytes: Uint8Array, filename: string) {
  const extension = filename.toLowerCase().slice(filename.lastIndexOf("."))
  const supported = signatures.find((item) => item.extension === extension)
  if (!supported) return undefined

  const isPdf =
    supported.contentType === "application/pdf" &&
    new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-"
  const isPng =
    supported.contentType === "image/png" &&
    bytes.subarray(0, 8).join(",") === "137,80,78,71,13,10,26,10"
  const isJpeg =
    supported.contentType === "image/jpeg" &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff

  return isPdf || isPng || isJpeg ? supported : undefined
}

function safeFilename(filename: string) {
  return filename
    .split(/[\\/]/)
    .pop()
    ?.replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 180)
    .trim()
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const workflow = await getWorkflow(orgId, id)
  if (!workflow) {
    return Response.json({ error: "Workflow not found" }, { status: 404 })
  }

  return Response.json(await listWorkflowAttachments(orgId, id))
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const workflow = await getWorkflow(orgId, id)
  if (!workflow) {
    return Response.json({ error: "Workflow not found" }, { status: 404 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return Response.json({ error: "Expected a multipart file upload." }, { status: 400 })
  }

  const upload = form.get("file")
  if (!(upload instanceof File)) {
    return Response.json({ error: "Choose a file to upload." }, { status: 400 })
  }
  if (upload.size === 0 || upload.size > MAX_FILE_SIZE) {
    return Response.json(
      { error: "Each document must be between 1 byte and 4 MB." },
      { status: 413 }
    )
  }

  const currentAttachments = await listWorkflowAttachments(orgId, id)
  if (currentAttachments.length >= MAX_ATTACHMENTS) {
    return Response.json(
      { error: `A workflow can have at most ${MAX_ATTACHMENTS} documents.` },
      { status: 413 }
    )
  }

  const totalSize = await getWorkflowAttachmentTotalSize(orgId, id)
  if (totalSize + upload.size > MAX_TOTAL_SIZE) {
    return Response.json(
      { error: "Documents for a workflow cannot exceed 20 MB in total." },
      { status: 413 }
    )
  }

  const filename = safeFilename(upload.name)
  if (!filename) {
    return Response.json({ error: "The filename is invalid." }, { status: 400 })
  }

  const bytes = new Uint8Array(await upload.arrayBuffer())
  const document = detectDocument(bytes, filename)
  if (!document) {
    return Response.json(
      { error: "Only valid PDF, PNG, and JPG/JPEG files are supported." },
      { status: 415 }
    )
  }

  const attachment = await addWorkflowAttachment({
    orgId,
    workflowId: id,
    filename,
    contentType: document.contentType,
    size: upload.size,
    contentBase64: Buffer.from(bytes).toString("base64"),
  })

  return Response.json(attachment, { status: 201 })
}
