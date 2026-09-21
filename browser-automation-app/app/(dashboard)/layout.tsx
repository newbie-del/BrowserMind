import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"

import { AppSidebar } from "@/components/app-sidebar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const { orgId } = await auth.protect({ unauthenticatedUrl: "/sign-in" })

  if (!orgId) {
    redirect("/choose-organization")
  }

  return (
    <SidebarProvider className="h-svh">
      <AppSidebar />
      <SidebarInset className="min-h-0 overflow-hidden border shadow-none!">{children}</SidebarInset>
    </SidebarProvider>
  )
}
