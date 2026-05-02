import { redirect } from "next/navigation"

// Root redirects to the browse page (Electron loads this directly)
export default function RootPage() {
  redirect("/browse")
}
