# BrowserMind Implementation Map

Phase 0 inventory created from the accessible repositories in `D:\browsermind1`.
This document intentionally stops before Phase 1 implementation.

## 1. Existing BrowserMind / Main Project Structure

Main project / Antonio foundation: `browser-automation-app`

The current app is already a SaaS browser-automation product foundation, not a blank project. It is a private Next.js app with:

- Next.js 16, React 19, TypeScript, Tailwind CSS 4.
- Clerk auth and organizations.
- Neon/PostgreSQL with Drizzle.
- Liveblocks for collaborative rooms, presence, and React Flow sync.
- React Flow via `@xyflow/react`.
- Trigger.dev for durable workflow execution.
- Browserbase and Stagehand dependencies already installed.
- Resend email node support.
- Sentry instrumentation.
- A broad shadcn/Base UI-style component library in `components/ui`.

Important existing files:

- `browser-automation-app/package.json`
  - Defines scripts: `dev`, `build`, `lint`, `typecheck`, `db:generate`, `db:migrate`, `db:push`, `db:studio`.
  - Already depends on `@browserbasehq/sdk`, `@browserbasehq/stagehand`, Clerk, Liveblocks, Trigger.dev, Drizzle, React Flow, Resend, Sentry.
- `browser-automation-app/README.md`
  - Describes the current foundation as "Browser Automation SaaS".
  - Tutorial branches map to auth, dashboard, database, workflow page, canvas, execution, Browserbase, live status, console, replay, billing, polish.
- `browser-automation-app/app`
  - App Router pages for auth, dashboard, workflow detail, billing, API routes.
- `browser-automation-app/components`
  - App sidebar, theme provider, and a large reusable UI component set.
- `browser-automation-app/features/workflows`
  - Current workflow domain, including data access, actions, nodes, canvas, shell, console, run provider, replay component.
- `browser-automation-app/lib/db/schema.ts`
  - Current schema has a minimal `workflows` table with `id`, `orgId`, `name`, `graph`, timestamps.
- `browser-automation-app/features/workflows/tasks/run-workflow.ts`
  - Trigger.dev task that loads the persisted workflow graph, topologically sorts connected nodes, runs node executors, publishes live step metadata, creates a Browserbase session, connects Stagehand, and returns `browserbaseSessionId`.
- `browser-automation-app/features/workflows/nodes/node-registry.ts`
  - Current node types: `start`, `open-url`, `act`, `extract`, `observe`, `agent`, `send-email`.
- `browser-automation-app/features/workflows/nodes/node-executors.ts`
  - Current executor dispatch into Stagehand/browser nodes and Resend email.
- `browser-automation-app/app/api/replays/[sessionId]/route.ts`
  - Existing replay API surface.
- `browser-automation-app/lib/browserbase.ts`
  - Server-only Browserbase SDK client.

Current database coverage is much smaller than the conceptual BrowserMind model. It has workflow persistence, but not yet first-class workflow versions, executions, execution steps, approvals, documents, extractions, browser sessions, schedules, audit logs, memory, or team task ownership.

Git status note: `git -C .\browser-automation-app status --short` was blocked by Git's dubious ownership safety check for the sandbox user. I did not modify Git config.

## 2. Antonio Components To Reuse Directly

Because `code-with-antonio` is this `browser-automation-app`, reuse should be direct, in-place, and conservative.

Reusable SaaS foundation:

- Auth pages and Clerk integration under `app/(auth)`.
- Dashboard layout under `app/(dashboard)/layout.tsx`.
- Dashboard home under `app/(dashboard)/page.tsx`.
- Organization scoping patterns using Clerk org IDs.
- Sidebar/navigation from `components/app-sidebar.tsx` and `components/ui/sidebar.tsx`.
- Billing page and current pro-plan hook if needed later, but billing should not be a core demo blocker.

Reusable workflow UI:

- Workflow detail route: `app/(dashboard)/workflows/[id]/page.tsx`.
- `features/workflows/components/workflow-shell.tsx`.
- `features/workflows/components/canvas.tsx`.
- `features/workflows/components/step-node.tsx`.
- `features/workflows/components/inspector-panel.tsx`.
- `features/workflows/components/right-sidebar.tsx`.
- `features/workflows/components/workflow-nav.tsx`.
- `features/workflows/components/console-panel.tsx`.
- `features/workflows/components/logs-panel.tsx`.
- `features/workflows/components/session-replay.tsx`.
- `features/workflows/components/workflow-runs-provider.tsx`.

Reusable collaboration foundation:

- `lib/liveblocks.ts`.
- `app/api/liveblocks/auth/route.ts`.
- `app/api/liveblocks/users/route.ts`.
- Liveblocks + React Flow integration already listed in dependencies.
- Existing room component in `features/workflows/components/room.tsx`.

Reusable workflow execution foundation:

- `features/workflows/actions.ts` for workflow mutations.
- `features/workflows/data.ts` for workflow data access.
- `features/workflows/lib/validate-graph.ts`.
- `features/workflows/lib/interpolate.ts`.
- `features/workflows/tasks/run-workflow.ts`.
- Existing node registry/executor pattern.
- Trigger.dev metadata updates for live step status.

Reusable UI components:

- Existing `components/ui/*` should be searched before creating new components.
- Existing controls cover buttons, dialogs, sheets, sidebars, tables, tabs, forms, inputs, textarea, selects, dropdowns, command menu, tooltip, progress, scroll area, resizable panels, badges, avatar, alert dialogs, etc.

Do not recreate:

- Dashboard shell.
- Sidebar/navigation.
- Workflow canvas/editor.
- Generic UI primitives.
- Trigger.dev task wiring.
- Browserbase SDK client basics.
- Session replay surface.

## 3. Browser-Use Components To Reuse Or Adapt

Reference repository: `browser-use`

License: MIT. Copying/adapting source is legally simpler than the AGPL references, but prefer using Browser-Use as a package/runtime capability where practical.

Useful verified areas:

- `browser-use/README.md`
  - Browser-Use positions remote/cloud browsers as the recommended scaling path.
- `browser-use/pyproject.toml`
  - Package name `browser-use`, Python `>=3.11,<4.0`.
  - Includes `browser-use-sdk`, `browser-harness`, `cdp-use`, document utilities like `pypdf`, `python-docx`, and LLM adapters.
- `browser-use/browser_use/browser/session.py`
  - `BrowserSession` supports `cdp_url` for remote CDP connection and cloud browser options.
  - It provides the event-driven browser session layer, tab/page lifecycle, navigation, CDP operations, download events, CAPTCHA watchdog types, and domain controls.
- `browser-use/browser_use/browser/profile.py`
  - `BrowserProfile` includes remote/local launch configuration, `allowed_domains`, `prohibited_domains`, headless handling, downloads, profile settings, and Chrome argument management.
- `browser-use/browser_use/actor/*`
  - Browser-control primitives for clicking, typing/input, scrolling, screenshots, DOM interaction, and direct CDP calls.
- `browser-use/browser_use/agent/*`
  - Agent loop, history, events, and cloud-event models.
- `browser-use/browser_use/dom/*`
  - DOM/state understanding and serialization.
- `browser-use/browser_use/controller/*` and `browser-use/browser_use/tools/*` should be inspected before adding custom browser actions in later phases.

BrowserMind reuse strategy:

- Use Browser-Use as the core browser execution layer for agentic tasks rather than extending the current Stagehand-only executor into a second homegrown automation engine.
- Connect Browser-Use to provider sessions via remote CDP URLs, using `BrowserSession(cdp_url=...)` or the current equivalent API.
- Keep Browser-Use execution server-side only. Do not expose CDP URLs, provider API keys, or session credentials to the frontend or LLM prompts.
- Preserve the current Trigger.dev durable task pattern and call Browser-Use from those tasks or a small server-side Python bridge.
- Reuse Browser-Use domain restriction support for demo safety where possible.
- Reuse Browser-Use upload/download, screenshot, DOM, extraction, and action primitives before writing equivalents.

Needs later inspection before implementation:

- Exact current Browser-Use API for file upload and human intervention events.
- Exact best way to run Browser-Use from the TypeScript Trigger.dev task: package boundary, Python subprocess/service, or isolated worker.
- Browser-Use Cloud vs direct Browserbase CDP compatibility in the installed version.

## 4. Workflow-Use Components And Concepts To Reuse

Reference repository: `reference/workflow-use`

License: AGPL-3.0. Treat as a reference unless deliberately consumed across a clean service boundary with license implications understood. Do not casually copy source into the private SaaS app.

Useful verified areas:

- `reference/workflow-use/README.md`
  - Natural-language task generation mode.
  - Flow: describe task, run Browser-Use once, convert history to semantic workflow, store and reuse.
  - File-based storage at `workflows/storage`.
- `reference/workflow-use/workflows/README.md`
  - Recommends deterministic generation for most workflows.
  - Documents semantic-only element finding, variables, fallback strategies, and progress callbacks.
- `reference/workflow-use/workflows/workflow_use/healing/service.py`
  - `HealingService.generate_workflow_from_prompt(...)` is the main concept for prompt to workflow.
  - Supports progress callbacks: `on_step_recorded`, `on_status_update`.
  - Converts Browser-Use history into workflow steps.
  - Supports variable extraction, deterministic conversion, workflow validation, and selector generation.
- `reference/workflow-use/workflows/workflow_use/storage/service.py`
  - Shows a simple metadata/workflow storage split.
  - Useful conceptually, but BrowserMind should store workflows in the existing Postgres/Drizzle schema rather than file storage.
- `reference/workflow-use/workflows/workflow_use/workflow/views.py`
  - `WorkflowRunOutput` and structured output model concepts.
- `reference/workflow-use/workflows/workflow_use/workflow/semantic_executor.py`
  - Relevant before implementing deterministic execution or semantic fallback.
- `reference/workflow-use/workflows/workflow_use/healing/deterministic_converter.py`
  - Relevant before implementing goal to workflow generation.
- `reference/workflow-use/workflows/workflow_use/healing/variable_extractor.py`
  - Relevant before workflow variables.
- `reference/workflow-use/workflows/docs/VARIABLES.md`
  - Relevant before parameterization.
- `reference/workflow-use/workflows/docs/PROGRESS_TRACKING.md`
  - Relevant before live generation status UI.
- `reference/workflow-use/workflows/examples/workflows/form_filling/*`
  - Relevant for the student application demo, as a generic form-filling reference.

BrowserMind reuse strategy:

- Borrow the architecture, not the UI or file storage:
  - Goal prompt -> exploratory Browser-Use run or structured planner.
  - Execution history -> semantic workflow nodes.
  - Variables and outputs -> reusable workflow version.
  - Deterministic execution first, AI fallback/self-healing second.
- Convert Workflow-Use's workflow schema concepts into BrowserMind's existing React Flow graph model, or store both:
  - Human-editable React Flow graph for UI.
  - Server-readable semantic execution plan for reliable execution.
- Use progress callbacks as the model for live workflow-generation events in the UI.
- Store generated workflows in Postgres using the existing Drizzle stack, not `workflows/storage`.

Needs new implementation in BrowserMind:

- A TypeScript/DB representation of semantic workflows and variables.
- A mapper from generated semantic workflow steps to BrowserMind canvas nodes.
- A planner/generation service endpoint or Trigger.dev task.
- Progress events surfaced in the dashboard.

## 5. BrowserOS Concepts Worth Borrowing

Reference repository: `browser-os/BrowserOS`

License: AGPL-3.0. The prompt also explicitly says BrowserOS is concept-only. Do not compile, run, port, or copy Chromium/desktop code.

Useful concepts verified:

- BrowserOS neo is a secondary agent browser with live dashboard, replay, parallel sessions, and a step-by-step action timeline.
- `browser-os/BrowserOS/README.md` describes:
  - Live dashboard showing active agent sessions, current site, current action, and progress.
  - Replay as a scrubbable video plus action timeline.
  - Agent sessions isolated by tab.
  - Local profile/import ideas, useful conceptually but not directly applicable to multi-tenant SaaS.
- `browser-os/BrowserOS/packages/browseros-agent/README.md` describes:
  - Sidecar server config.
  - CDP port and server port split.
  - Agent platform split into app, server, browser-core, browser-mcp, API client.
- `browser-os/BrowserOS/packages/browseros-agent/contracts/claw-mcp/README.md` lists a mature browser MCP tool surface:
  - `tabs`, `tab_groups`, `windows`, `navigate`, `snapshot`, `diff`, `act`, `grep`, `read`, `evaluate`, `run`, `screenshot`, `pdf`, `wait`, `upload`, `download`, `name_session`.
  - Also calls out ownership isolation, untrusted-content fencing, auto-context, audit records, cancellation, browser-down guidance, and transport hygiene.

Borrow as product/UX concepts:

- Activity timeline attached to each execution.
- Live session dashboard/status.
- Replay with timeline.
- Browser tool taxonomy and naming.
- Session naming.
- Cancellation and recovery states.
- Untrusted-content fencing concept.
- Clear ownership isolation per session/workflow/user.
- Human-readable audit records.

Do not borrow:

- Chromium fork code.
- Desktop app architecture.
- Local profile import implementation.
- Rust/Go/TypeScript BrowserOS server internals.
- MCP server implementation code.

## 6. Chosen Remote-Browser Provider

Chosen provider: Browserbase.

Reasons:

- The main app already depends on `@browserbasehq/sdk` and `@browserbasehq/stagehand`.
- Existing execution code already creates Browserbase sessions in `features/workflows/tasks/run-workflow.ts`.
- Existing replay API and session replay UI are already oriented around Browserbase.
- The prompt prefers Browserbase first.
- Browserbase provides isolated remote Chromium sessions and replay/inspection capabilities, avoiding custom remote-browser infrastructure.

Connection plan:

- Keep Browserbase session creation server-side inside Trigger.dev tasks or server actions.
- For Browser-Use execution, create a Browserbase session and connect Browser-Use to that session's remote CDP endpoint.
- Browser-Use supports remote CDP via `BrowserSession(cdp_url=...)` in the inspected code.
- Store only safe session metadata in BrowserMind:
  - provider name,
  - provider session ID,
  - live view URL or replay URL when safe to expose,
  - status,
  - timestamps,
  - associated execution ID.
- Never expose Browserbase API keys, raw CDP credentials, or provider secrets to the frontend or LLM prompts.
- Use Browserbase live view/iframe/inspector capability for the execution UI rather than custom streaming.

Open integration question for Phase 6:

- The current app uses Stagehand over Browserbase. BrowserMind's target architecture says Browser-Use should be the browser execution layer. Phase 6 should decide whether Stagehand remains only for legacy nodes during migration or is replaced by Browser-Use for all browser nodes. The credit-conserving path is to preserve working Stagehand nodes until Browser-Use parity is implemented.

## 7. Features Requiring New Implementation

These are not fully covered by the current app or references as integrated BrowserMind features.

### Phase 1: Stabilize existing main application

Required because the current project already has a lot of functionality but may not be in a verified working state. Need to run `typecheck`, `lint`, relevant build/tests, and manually verify core routes.

### Phase 3: Goal/task creation

Current app starts from manually edited workflow nodes. BrowserMind needs a first-class natural-language goal input that creates a workflow generation job.

Existing coverage:

- Dashboard shell and UI components exist.
- Workflow creation button exists.

New work:

- Goal entry UI.
- Server action/API to create a draft workflow from a goal.
- Persist original goal text.
- Track generation status.

### Phase 4: Workflow generation

Workflow-Use provides strong concepts, but not integrated TypeScript/Next/Drizzle code.

New work:

- Server-side generation task.
- BrowserMind workflow schema for semantic steps, variables, outputs, and approval policies.
- Mapper from generated plan to existing React Flow nodes/edges.
- Three demo goal templates/seeds without hard-coding scenario-specific execution logic.

### Phase 5: Workflow canvas/editor enhancements

Current canvas exists, but BrowserMind needs review/edit/publish semantics.

New work:

- Draft vs published workflow state.
- Validation for BrowserMind node types.
- Editable variables/approvals/assignees.
- Better node types for approval, document extraction, verification, browser task, and report/email draft.

### Phase 6: Browser-Use + Browserbase execution

Current execution uses Stagehand directly. BrowserMind requires Browser-Use as the browser execution layer.

New work:

- Browser-Use server-side integration boundary.
- Remote CDP handoff from Browserbase to Browser-Use.
- Execution context that maps BrowserMind nodes to Browser-Use tasks/actions.
- Safe file upload handling.
- Domain restrictions and credentials policy.

### Phase 7: Live browser execution UI

Current app has live run metadata and replay. Need a stronger live view.

New work:

- Browserbase live session embed.
- Current URL/action display.
- Execution state panel matching BrowserMind acceptance test.
- Real-time timeline from execution steps.

### Phase 8: Observer, verifier, recovery

Current app has `observe` and `extract` nodes, but not a general verification/recovery layer.

New work:

- Verification step model.
- Failure categories.
- Recovery attempt records.
- Retry/self-healing policy inspired by Workflow-Use.

### Phase 9: Human approval gates

Current app has no first-class approval entity or pause/resume flow.

New work:

- Approval node type.
- Approval DB table.
- Pause/resume in execution engine.
- Approve/reject/ask-user UI.
- Mandatory policies for submission, sending emails, payments, destructive actions, account changes.
- OTP/CAPTCHA handoff state.

### Phase 10: Document upload + analysis

Current app has no document domain.

New work:

- Document upload UI and storage.
- Document metadata table.
- Extraction pipeline for PDFs/images/documents.
- DocumentExtraction records.
- Security rules for storage and access.

### Phase 11: General document-to-form-field mapping

No existing implementation covers matching uploaded documents to arbitrary form upload fields.

New work:

- Generic document classification.
- Field intent detection.
- Matching algorithm for text fields and file inputs.
- Guardrails so photo/signature/category/etc. map correctly without JEE-specific hard-coding.

### Phase 12: Team collaboration ownership

Liveblocks collaboration exists, but workflow step ownership is not first class.

New work:

- Task/assignee model.
- Step ownership UI.
- Membership-aware permissions.
- Team review states for TechFest workflow.

### Phase 13: Workflow versioning

Current schema stores one mutable `graph` on `workflows`.

New work:

- `WorkflowVersion` table.
- Published version snapshots.
- Running executions pinned to a version.
- Editing a published workflow creates a new draft/version.

### Phase 14: Scheduled workflows

No schedule model found.

New work:

- Schedule table.
- Trigger existing published workflow on a schedule.
- Keep this as scheduling existing workflows, not a separate automation platform.

### Phase 15: Demo integrations only

Current app has Resend email node. Other integrations are not present.

New work:

- Only integrations needed for JEE-style form demo, TPO opportunity workflow, and TechFest sponsorship workflow.
- Email draft/send approval path.
- Report generation/export/email.

### Phase 16: Memory + audit trail + analytics

Current run metadata exists but not durable audit/memory.

New work:

- AuditLog table.
- ExecutionStep table.
- Memory table for reusable facts/workflow learnings.
- Basic analytics on runs, failures, approvals, recovery.

### Phase 17: UI polish

Current UI is already a polished SaaS base. Final polish should be delayed until core flows work.

New work:

- BrowserMind branding/theme pass.
- Clean light SaaS consistency.
- Scenario demo data polish.
- Canvas clarity and timeline polish.

## Database Direction

Keep existing Drizzle + Neon/PostgreSQL.

Current table:

- `workflows`

Likely additions over phases:

- `workflow_versions`
- `workflow_nodes` or embedded version graph snapshots
- `workflow_edges` or embedded version graph snapshots
- `tasks`
- `executions`
- `execution_steps`
- `approvals`
- `documents`
- `document_extractions`
- `browser_sessions`
- `integrations`
- `schedules`
- `audit_logs`
- `memories`

Credit-conserving recommendation:

- Do not over-normalize React Flow graphs immediately.
- Add durable entities only when their phase requires them.
- For versioning, store immutable graph snapshots first; split nodes/edges into tables only if querying requires it.

## Licensing Notes

- `browser-use`: MIT license.
- `reference/workflow-use`: AGPL-3.0.
- `browser-os/BrowserOS`: AGPL-3.0.
- `browser-automation-app`: private project; no LICENSE file was found in the inspected root listing.

Implications:

- Browser-Use can be used/adapted more freely under MIT, preserving notice requirements.
- Workflow-Use and BrowserOS should be treated as references unless the project is prepared for AGPL obligations or uses them through a carefully reviewed service/dependency boundary.
- Before copying any source code from a reference repository, re-check the exact file license and attribution requirements.

## Immediate Next Step After Review

After this map is reviewed, start Phase 1 only:

1. Verify the existing app scripts: `typecheck`, `lint`, and a build if environment variables allow it.
2. Manually inspect core routes/components for breakage.
3. Fix only issues required to stabilize the existing app.
4. Do not begin goal generation, Browser-Use integration, document handling, or approval gates during Phase 1.
