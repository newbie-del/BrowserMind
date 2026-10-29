import { runDesktopAgent } from "@/features/workflows/lib/run-desktop-agent"

export async function desktopControl({ instruction }: { instruction: string }) {
  return runDesktopAgent(instruction)
}
