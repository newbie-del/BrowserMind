import assert from "node:assert/strict"
import test from "node:test"

import {
  canProcessInternshipApplication,
  canSafelyRetryInternshipApplication,
  parseInternshipQueueLimit,
  processInternshipQueue,
  persistedInternshipOutcome,
  rankInternships,
} from "./internship-queue.ts"

test("deduplicates canonical listing URLs without discarding job identifiers", () => {
  const ranked = rankInternships(
    [
      {
        company: "Acme",
        role: "Software engineering",
        sourceUrl: "https://jobs.example.com/role/1?utm_source=search#apply",
      },
      {
        company: "Acme",
        role: "Software engineering",
        sourceUrl: "https://jobs.example.com/role/1",
      },
      {
        company: "Acme",
        role: "Software engineering",
        sourceUrl: "https://jobs.example.com/?job=2",
      },
    ],
    "software engineering intern",
    50
  )

  assert.equal(ranked.length, 2)
  assert.equal(ranked[0]?.applicationKey, "https://jobs.example.com/role/1")
  assert.equal(ranked[1]?.sourceUrl, "https://jobs.example.com/?job=2")
})

test("filters invalid URLs, ranks profile overlap, and caps results at 100", () => {
  const listings = Array.from({ length: 130 }, (_, index) => ({
    company: `Company ${index}`,
    role: index === 0 ? "Python data science internship" : "Marketing assistant",
    sourceUrl: `https://jobs.example.com/${index}`,
  }))
  listings.push({
    company: "Not a web URL",
    role: "Python intern",
    sourceUrl: "file:///resume.pdf",
  })

  const ranked = rankInternships(listings, "Python data science", 100)

  assert.equal(ranked.length, 100)
  assert.equal(ranked[0]?.company, "Company 0")
  assert.ok(ranked[0].matchScore > ranked[1].matchScore)
})

test("limits requested queue size to 1–100", () => {
  assert.equal(parseInternshipQueueLimit("Find 12 internships"), 12)
  assert.equal(parseInternshipQueueLimit("Apply to 75 internships"), 75)
  assert.equal(parseInternshipQueueLimit("Apply to 150 internships"), 100)
  assert.equal(parseInternshipQueueLimit("Search 0 internships"), 1)
  assert.equal(parseInternshipQueueLimit("Find internships"), 50)
})

test("only retries a first attempt proven to have made no form changes", () => {
  assert.equal(canSafelyRetryInternshipApplication("not_applied", ["navigate"], 0), true)
  assert.equal(canSafelyRetryInternshipApplication("not_applied", ["click_element"], 0), false)
  assert.equal(canSafelyRetryInternshipApplication("not_applied", ["upload_file"], 0), false)
  assert.equal(canSafelyRetryInternshipApplication("not_applied", [], 1), false)
  assert.equal(canSafelyRetryInternshipApplication("uncertain", [], 0), false)
})

test("queue eligibility and outcome mapping preserve uncertain submissions", () => {
  assert.equal(canProcessInternshipApplication("pending", 0), true)
  assert.equal(canProcessInternshipApplication("failed", 1), true)
  assert.equal(canProcessInternshipApplication("failed", 2), false)
  assert.equal(canProcessInternshipApplication("processing", 0), false)
  assert.equal(persistedInternshipOutcome("applied"), "applied")
  assert.equal(persistedInternshipOutcome("uncertain"), "uncertain")
  assert.equal(persistedInternshipOutcome("not_applied"), "needs-attention")
})

test("processes applications sequentially, retries safe failures, and recovers per item", async () => {
  const applications = [
    {
      id: "safe-retry",
      company: "First",
      role: "Intern",
      sourceUrl: "https://jobs.example.com/first",
      status: "pending",
      attempts: 0,
    },
    {
      id: "blocked",
      company: "Second",
      role: "Intern",
      sourceUrl: "https://jobs.example.com/second",
      status: "pending",
      attempts: 0,
    },
    {
      id: "interrupted",
      company: "Third",
      role: "Intern",
      sourceUrl: "https://jobs.example.com/third",
      status: "pending",
      attempts: 0,
    },
    {
      id: "already-applied",
      company: "Fourth",
      role: "Intern",
      sourceUrl: "https://jobs.example.com/fourth",
      status: "applied",
      attempts: 1,
    },
  ]
  const calls = []
  const updates = []
  const results = await processInternshipQueue({
    applications,
    updateApplication: async (update) => updates.push(update),
    runApplication: async (application) => {
      calls.push(application.id)
      if (application.id === "safe-retry" && calls.filter((id) => id === "safe-retry").length === 1) {
        return {
          applicationStatus: "not_applied",
          actions: ["navigate"],
          message: "Temporary page load failure.",
        }
      }
      if (application.id === "safe-retry") {
        return { applicationStatus: "applied", actions: ["click_submit"] }
      }
      if (application.id === "blocked") {
        return {
          applicationStatus: "needs_attention",
          applicationMessage: "OTP verification is required.",
          actions: ["navigate"],
        }
      }
      throw new Error("Browser process exited after navigation.")
    },
  })

  assert.deepEqual(calls, ["safe-retry", "safe-retry", "blocked", "interrupted"])
  assert.deepEqual(
    results.map(({ id, status }) => [id, status]),
    [
      ["safe-retry", "applied"],
      ["blocked", "needs-attention"],
      ["interrupted", "uncertain"],
    ]
  )
  assert.equal(
    updates.filter(
      ({ id, status, incrementAttempt }) =>
        id === "safe-retry" && status === "processing" && incrementAttempt
    ).length,
    2
  )
  assert.equal(
    updates.filter(({ id }) => id === "interrupted").at(-1)?.status,
    "uncertain"
  )
})
