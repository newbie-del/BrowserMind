import type { ShortlistItem } from "@/features/workflows/lib/run-browser-use-agent"

// Stable identity for a shortlisted item, used to dedupe across runs. Prefer the
// canonical source URL (host + path, no query/fragment); fall back to
// company|role. Returns "" when there is nothing stable to key on.
export function itemKey(item: ShortlistItem): string {
  const url = (item.sourceUrl ?? "").trim()
  if (/^https?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url)
      return `${parsed.host}${parsed.pathname}`.toLowerCase().replace(/\/+$/, "")
    } catch {
      // malformed URL — fall through to company|role
    }
  }
  const company = (item.company ?? "").toLowerCase().trim()
  const role = (item.role ?? "").toLowerCase().trim()
  const combo = `${company}|${role}`.replace(/\s+/g, " ").trim()
  return combo === "|" ? "" : combo
}

export type MemoryDiff = {
  items: ShortlistItem[] // every item, with isNew set
  newItems: ShortlistItem[] // isNew AND not rejected by the Checker
  newKeys: { key: string; payload: Record<string, unknown> }[] // to persist
  newCount: number
  seenCount: number
}

// Mark each item new/seen against previously-surfaced keys. An item with no
// stable key is treated as new (we cannot prove we have seen it). Only new,
// non-rejected items count as "new" and are persisted — rejected items are not
// remembered, so a corrected posting can resurface later.
export function diffAgainstSeen(
  items: ShortlistItem[],
  seenKeys: Iterable<string>
): MemoryDiff {
  const seen = new Set(seenKeys)
  const marked = items.map((item) => {
    const key = itemKey(item)
    return { ...item, isNew: key ? !seen.has(key) : true }
  })
  const newItems = marked.filter(
    (item) => item.isNew && item.verification?.verdict !== "reject"
  )
  const newKeys = newItems
    .map((item) => ({
      key: itemKey(item),
      payload: item as unknown as Record<string, unknown>,
    }))
    .filter((entry) => entry.key.length > 0)
  return {
    items: marked,
    newItems,
    newKeys,
    newCount: newItems.length,
    seenCount: marked.filter((item) => !item.isNew).length,
  }
}
