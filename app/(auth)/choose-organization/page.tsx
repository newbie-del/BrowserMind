import { OrganizationList } from "@clerk/nextjs"

// A new user (e.g. first Google sign-up) has no organization, and the dashboard
// layout hard-requires an active org. TaskChooseOrganization only renders when
// Clerk has a pending "choose-organization" session task; without one it
// immediately redirects to "/", which bounces straight back here — an infinite
// loop. OrganizationList always lets the user create or pick an org, sets it
// active, and then sends them to the dashboard, which breaks the loop.
export default function ChooseOrganizationPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <OrganizationList
        hidePersonal
        skipInvitationScreen
        afterCreateOrganizationUrl="/"
        afterSelectOrganizationUrl="/"
      />
    </div>
  )
}
