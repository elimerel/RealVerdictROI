import { redirect } from "next/navigation"

// Root redirects to the pipeline (the workstation). Browse is one click
// away from the sidebar — but the default landing is the workspace, not
// the embedded browser, matching the CRM mental model.
export default function RootPage() {
  redirect("/pipeline")
}
