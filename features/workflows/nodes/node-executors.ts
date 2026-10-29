import type { Stagehand } from "@browserbasehq/stagehand"
import { runBrowserUseAgent } from "@/features/workflows/lib/run-browser-use-agent"

import type {
  ActionNodeType,
  NodeType,
} from "@/features/workflows/nodes/node-registry"
import { act } from "./act"
import { agent } from "./agent"
import { extract } from "./extract"
import { desktopControl } from "./desktop-control"
import { observe } from "./observe"
import { openUrl } from "./open-url"
import { sendEmail } from "./send-email"

export type NodeContext = {
  values: Record<string, string>
  getStagehand: () => Promise<Stagehand>
  getBrowserUseCdpUrl: () => Promise<string>
}

export type NodeExecutor = (ctx: NodeContext) => Promise<unknown>

export const nodeExecutors: Partial<Record<NodeType, NodeExecutor>> = {
  "open-url": async ({ values, getStagehand }) =>
    openUrl({ stagehand: await getStagehand(), url: values.url }),
  act: async ({ values, getStagehand }) =>
    act({ stagehand: await getStagehand(), instruction: values.instruction }),
  extract: async ({ values, getStagehand }) =>
    extract({ stagehand: await getStagehand(), instruction: values.instruction }),
  observe: async ({ values, getStagehand }) =>
    observe({ stagehand: await getStagehand(), instruction: values.instruction }),
  agent: async ({ values, getBrowserUseCdpUrl }) =>
    agent({
      instruction: values.instruction,
      runBrowserUse: async (task) =>
        runBrowserUseAgent({
          cdpUrl: await getBrowserUseCdpUrl(),
          task,
        }),
    }),
  "desktop-control": async ({ values }) =>
    desktopControl({ instruction: values.instruction }),
  "send-email": async ({ values }) =>
    sendEmail({ to: values.to, subject: values.subject, body: values.body }),
  // Approval is enforced by the run task via a Trigger.dev waitpoint, not here;
  // this entry only satisfies the executor map. The real pause/resume lives in
  // run-workflow.ts.
  approval: async ({ values }) => ({
    status: "pending" as const,
    reason: values.reason ?? "",
  }),
} satisfies Record<ActionNodeType, NodeExecutor>
