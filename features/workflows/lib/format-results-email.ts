import type {
  BrowserUseResult,
  ShortlistItem,
} from "@/features/workflows/lib/run-browser-use-agent"
import type { DesktopAgentResult } from "@/features/workflows/lib/run-desktop-agent"
import type { VerificationSummary } from "@/features/workflows/lib/verify-shortlist"

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character
  )
}

function cell(value: string | undefined) {
  const text = (value ?? "").trim()
  return `<td style="padding:6px 10px;border:1px solid #e2e8f0;vertical-align:top">${
    text ? escapeHtml(text) : "<span style='color:#94a3b8'>—</span>"
  }</td>`
}

function sourceCell(url: string | undefined) {
  const href = (url ?? "").trim()
  if (!href || !/^https?:\/\//i.test(href)) return cell(href)
  return `<td style="padding:6px 10px;border:1px solid #e2e8f0;vertical-align:top"><a href="${escapeHtml(
    href
  )}">link</a></td>`
}

function verdictCell(item: ShortlistItem) {
  const v = item.verification
  if (!v)
    return `<td style="padding:6px 10px;border:1px solid #e2e8f0">—</td>`
  const pass = v.verdict === "pass"
  const color = pass ? "#047857" : "#b91c1c"
  const label = pass ? "✓ verified" : "✗ rejected"
  return `<td style="padding:6px 10px;border:1px solid #e2e8f0;color:${color}"><strong>${label}</strong><br/><span style="color:#64748b;font-size:12px">${escapeHtml(
    v.reason ?? ""
  )}</span></td>`
}

function shortlistTable(items: ShortlistItem[], showVerdict: boolean) {
  const head = [
    "#",
    "Company",
    "Role",
    "CTC",
    "Eligibility",
    "Deadline",
    "Source",
    showVerdict ? "Checker" : "",
  ]
    .filter(Boolean)
    .map(
      (h) =>
        `<th style="padding:6px 10px;border:1px solid #cbd5e1;background:#f1f5f9;text-align:left">${h}</th>`
    )
    .join("")

  const rows = items
    .map((item, index) => {
      const newBadge = item.isNew
        ? ' <span style="background:#dcfce7;color:#166534;font-size:11px;padding:1px 6px;border-radius:9999px">NEW</span>'
        : ""
      return `<tr>
        <td style="padding:6px 10px;border:1px solid #e2e8f0">${index + 1}${newBadge}</td>
        ${cell(item.company)}
        ${cell(item.role)}
        ${cell(item.ctc)}
        ${cell(item.eligibility)}
        ${cell(item.deadline)}
        ${sourceCell(item.sourceUrl)}
        ${showVerdict ? verdictCell(item) : ""}
      </tr>`
    })
    .join("")

  return `<table style="border-collapse:collapse;border:1px solid #cbd5e1;font-size:14px;width:100%"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`
}

// Builds the results email. When the agent produced a structured shortlist it
// renders a real table (company / role / CTC / eligibility / deadline / source),
// with a Checker verdict column (dual-agent) and NEW badges (cross-run memory).
// Otherwise it falls back to the plain-text summary.
export function renderResultsEmail({
  workflowName,
  result,
  verification,
  memory,
}: {
  workflowName: string
  result: BrowserUseResult | DesktopAgentResult
  verification?: VerificationSummary
  memory?: { newCount: number; seenCount: number }
}): string {
  const shortlist =
    "shortlist" in result && Array.isArray(result.shortlist)
      ? result.shortlist
      : null
  const header = `<h2>${escapeHtml(workflowName)} results</h2>`

  if (shortlist && shortlist.length > 0) {
    const showVerdict = Boolean(verification?.ranVerifier)
    const summaryBits = [
      `${shortlist.length} opening${shortlist.length === 1 ? "" : "s"} shortlisted`,
      showVerdict
        ? `${verification!.passed} verified, ${verification!.rejected} rejected by the Checker`
        : "",
      memory ? `${memory.newCount} new, ${memory.seenCount} already reported before` : "",
    ].filter(Boolean)

    return [
      header,
      `<p>${escapeHtml(summaryBits.join(" · "))}</p>`,
      shortlistTable(shortlist, showVerdict),
      result.message
        ? `<p style="color:#64748b;font-size:13px"><strong>Agent summary:</strong> ${escapeHtml(
            result.message
          )}</p>`
        : "",
    ]
      .filter(Boolean)
      .join("")
  }

  // Fallback: no structured shortlist — keep the previous prose format.
  const sources =
    "sourceDomains" in result
      ? result.sourceDomains?.join(", ") || "Not available"
      : "Local desktop session"
  return [
    header,
    `<p>${escapeHtml(result.message ?? "The browser task completed.")}</p>`,
    `<p><strong>Actions:</strong> ${escapeHtml(result.actions.join(", "))}</p>`,
    `<p><strong>Source domains:</strong> ${escapeHtml(sources)}</p>`,
    `<p><strong>Sources visited:</strong> ${escapeHtml(
      (result.urls ?? []).join("\n")
    )}</p>`,
  ]
    .join("")
    .replace(/\n/g, "<br />")
}
