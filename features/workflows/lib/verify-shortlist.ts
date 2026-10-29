import type { ShortlistItem } from "@/features/workflows/lib/run-browser-use-agent"

// Dual-agent verification. The browser agent (the "Doer") produces a shortlist;
// this independent "Checker" re-reads each item against the goal's hard
// eligibility criteria and can REJECT the Doer's choice. It is a separate LLM
// call with its own prompt — it does not share the Doer's browser context — so
// it is a genuine second opinion, not the same agent grading itself.

export type VerificationSummary = {
  checked: number
  passed: number
  rejected: number
  items: ShortlistItem[]
  ranVerifier: boolean
  note?: string
}

type CheckerVerdict = { index?: number; verdict?: string; reason?: string }

const CHECKER_SYSTEM =
  "You are an INDEPENDENT eligibility Checker — a second AI agent whose only job " +
  "is to catch mistakes the first agent (the Doer) may have made. You never trust " +
  "the Doer's judgement; you re-check each shortlisted item against the goal's hard " +
  "criteria yourself. Be strict and conservative: if an item clearly violates a " +
  "stated criterion, mark it reject with a one-line reason. Mark pass only when the " +
  "item plausibly satisfies every stated criterion."

function describeItem(item: ShortlistItem, index: number) {
  return [
    `#${index}`,
    item.company && `company: ${item.company}`,
    item.role && `role: ${item.role}`,
    item.ctc && `ctc: ${item.ctc}`,
    item.eligibility && `eligibility: ${item.eligibility}`,
    item.deadline && `deadline: ${item.deadline}`,
    item.sourceUrl && `source: ${item.sourceUrl}`,
    item.notes && `notes: ${item.notes}`,
  ]
    .filter(Boolean)
    .join(" | ")
}

export async function verifyShortlist({
  goal,
  items,
  signal,
}: {
  goal: string
  items: ShortlistItem[]
  signal?: AbortSignal
}): Promise<VerificationSummary> {
  const base: VerificationSummary = {
    checked: items.length,
    passed: items.length,
    rejected: 0,
    items,
    ranVerifier: false,
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return { ...base, note: "Checker skipped: OPENAI_API_KEY not set." }
  if (items.length === 0) return { ...base, note: "No items to verify." }

  const model =
    process.env.WORKFLOW_CHECKER_MODEL ||
    process.env.BROWSER_USE_OPENAI_MODEL ||
    "gpt-4o-mini"

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)
  signal?.addEventListener("abort", () => controller.abort(), { once: true })

  try {
    const prompt = [
      "GOAL (contains the eligibility criteria — CGPA, branch, year, role type, deadline):",
      goal,
      "",
      "SHORTLIST produced by the first agent (the Doer). Re-verify EACH item independently and strictly:",
      ...items.map((item, index) => describeItem(item, index)),
      "",
      'Return ONLY JSON of this shape: {"verdicts":[{"index":<number>,"verdict":"pass"|"reject","reason":"<short>"}]}',
      "Reject an item if it violates a stated criterion (e.g. it requires a higher CGPA than the student has, the wrong branch or year, or a closed deadline), is a duplicate, or if a hard criterion cannot be confirmed from the item. Keep each reason under 20 words.",
    ].join("\n")

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: CHECKER_SYSTEM },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      }),
    })

    if (!response.ok) {
      return {
        ...base,
        note: `Checker call failed (HTTP ${response.status}); items left unverified.`,
      }
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string | null } }[]
    }
    const text = payload.choices?.[0]?.message?.content
    const parsed = text
      ? (JSON.parse(text) as { verdicts?: CheckerVerdict[] })
      : null
    const byIndex = new Map<number, CheckerVerdict>()
    for (const verdict of parsed?.verdicts ?? []) {
      if (typeof verdict.index === "number") byIndex.set(verdict.index, verdict)
    }

    let passed = 0
    let rejected = 0
    const verifiedItems = items.map((item, index) => {
      const found = byIndex.get(index)
      const verdict: "pass" | "reject" =
        found?.verdict === "reject" ? "reject" : "pass"
      if (verdict === "reject") rejected += 1
      else passed += 1
      return {
        ...item,
        verification: {
          verdict,
          reason:
            found?.reason?.trim() ||
            (verdict === "pass"
              ? "Meets the stated criteria."
              : "Rejected by the Checker."),
        },
      }
    })

    return {
      checked: items.length,
      passed,
      rejected,
      items: verifiedItems,
      ranVerifier: true,
    }
  } catch (error) {
    return {
      ...base,
      note: `Checker error: ${
        error instanceof Error ? error.message : String(error)
      }; items left unverified.`,
    }
  } finally {
    clearTimeout(timeout)
  }
}
