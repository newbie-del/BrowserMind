import type {
  BrowserUseResult,
  ShortlistItem,
} from "@/features/workflows/lib/run-browser-use-agent"

export type RankedInternship = {
  applicationKey: string
  sourceUrl: string
  company: string
  role: string
  matchScore: number
}

export type InternshipApplicationStatus =
  | "pending"
  | "processing"
  | "applied"
  | "needs-attention"
  | "failed"
  | "uncertain"
  | "duplicate"

export const MAX_INTERNSHIP_APPLICATIONS = 100

const STOP_WORDS = new Set([
  "about", "above", "after", "apply", "applying", "based", "below", "between",
  "company", "current", "find", "from", "have", "intern", "internship",
  "internships", "into", "jobs", "looking", "match", "more", "only", "open",
  "role", "roles", "search", "should", "that", "their", "there", "these",
  "this", "those", "through", "with", "within", "work", "year", "years",
])

function normalizedUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    url.hash = ""
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|gclid|fbclid|ref|source)$/i.test(key)) {
        url.searchParams.delete(key)
      }
    }
    url.searchParams.sort()
    url.pathname = url.pathname.replace(/\/+$/, "") || "/"
    return url.toString().toLowerCase()
  } catch {
    return null
  }
}

function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .match(/[a-z][a-z0-9+#.-]{1,}/g)
      ?.filter((word) => !STOP_WORDS.has(word)) ?? []
  )
}

export function rankInternships(
  items: ShortlistItem[],
  profile: string,
  limit = MAX_INTERNSHIP_APPLICATIONS
): RankedInternship[] {
  const profileWords = keywords(profile)
  const seen = new Set<string>()
  const ranked: RankedInternship[] = []

  for (const item of items) {
    const sourceUrl = normalizedUrl(item.sourceUrl ?? "")
    if (!sourceUrl || seen.has(sourceUrl)) continue
    seen.add(sourceUrl)

    const role = item.role?.trim() ?? ""
    const company = item.company?.trim() ?? ""
    const evidence = keywords(
      [role, item.eligibility, item.notes].filter(Boolean).join(" ")
    )
    let overlap = 0
    for (const word of evidence) {
      if (profileWords.has(word)) overlap += 1
    }
    const matchScore =
      profileWords.size === 0
        ? 0
        : Math.min(100, Math.round((overlap / profileWords.size) * 100))

    ranked.push({ applicationKey: sourceUrl, sourceUrl, company, role, matchScore })
  }

  return ranked
    .sort((left, right) => right.matchScore - left.matchScore)
    .slice(0, Math.max(0, Math.min(MAX_INTERNSHIP_APPLICATIONS, Math.floor(limit))))
}

export function parseInternshipQueueLimit(goal: string): number {
  const match = goal.match(
    /\b(?:find|search|apply to|apply for|top|up to)\s+(\d{1,3})\b/i
  )
  const requested = match ? Number(match[1]) : 50
  return Math.max(1, Math.min(MAX_INTERNSHIP_APPLICATIONS, requested))
}

export function canProcessInternshipApplication(
  status: InternshipApplicationStatus,
  attempts: number
) {
  return (
    attempts < 2 &&
    (status === "pending" || status === "failed")
  )
}

export function canSafelyRetryInternshipApplication(
  status: string | undefined,
  actions: string[],
  attempts: number
) {
  return (
    status === "not_applied" &&
    attempts === 0 &&
    !actions.some((action) =>
      /\b(click|input|type|upload|submit|press|select|fill|send|apply)\b/i.test(
        action.replace(/_/g, " ")
      )
    )
  )
}

export function persistedInternshipOutcome(
  status: string | undefined
): "applied" | "needs-attention" | "uncertain" {
  if (status === "applied") return "applied"
  if (status === "uncertain") return "uncertain"
  return "needs-attention"
}

export type QueuedInternshipApplication = {
  id: string
  company: string
  role: string
  sourceUrl: string
  status: InternshipApplicationStatus
  attempts: number
}

export type ProcessedInternshipApplication = {
  id: string
  company: string
  role: string
  status: "applied" | "needs-attention" | "uncertain"
  url: string
  error?: string
}

export async function processInternshipQueue({
  applications,
  runApplication,
  updateApplication,
}: {
  applications: QueuedInternshipApplication[]
  runApplication: (
    application: QueuedInternshipApplication
  ) => Promise<BrowserUseResult>
  updateApplication: (update: {
    id: string
    status: InternshipApplicationStatus
    lastError?: string | null
    incrementAttempt?: boolean
  }) => Promise<void>
}) {
  const results: ProcessedInternshipApplication[] = []

  for (const application of applications) {
    if (!canProcessInternshipApplication(application.status, application.attempts)) {
      continue
    }

    let status: ProcessedInternshipApplication["status"] = "needs-attention"
    let errorMessage: string | undefined
    try {
      await updateApplication({
        id: application.id,
        status: "processing",
        incrementAttempt: true,
      })
      let outcome = await runApplication(application)
      if (
        canSafelyRetryInternshipApplication(
          outcome.applicationStatus,
          outcome.actions,
          application.attempts
        )
      ) {
        await updateApplication({
          id: application.id,
          status: "processing",
          lastError: outcome.message ?? "Safe retry before any form action.",
          incrementAttempt: true,
        })
        outcome = await runApplication(application)
      }

      status = persistedInternshipOutcome(outcome.applicationStatus)
      errorMessage =
        status === "applied"
          ? undefined
          : outcome.applicationMessage ||
            outcome.message ||
            "The browser agent did not report a confirmed submission."
    } catch (error) {
      status = "uncertain"
      errorMessage = error instanceof Error ? error.message : String(error)
    }

    await updateApplication({
      id: application.id,
      status,
      lastError: errorMessage ?? null,
    })
    results.push({
      id: application.id,
      company: application.company,
      role: application.role,
      status,
      url: application.sourceUrl,
      ...(errorMessage ? { error: errorMessage } : {}),
    })
  }

  return results
}
