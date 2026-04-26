import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { createClient } from "@/lib/supabase/server"
import { supabaseEnv } from "@/lib/supabase/config"
import { getProStatus } from "@/lib/pro"
import "./globals.css"

const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" })
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" })

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "RealVerdict — Walk-away price for buy-and-hold rental investors",
    template: "%s · RealVerdict",
  },
  description:
    "Underwrite a rental listing in one pass: verdict, cash flow, cap rate, DSCR, IRR — and the maximum offer where the deal still clears your bar.",
  openGraph: {
    type: "website",
    siteName: "RealVerdict",
    images: ["/api/og"],
  },
}

export const viewport: Viewport = {
  themeColor: "#09090b",
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Fetch user + pro status server-side so the sidebar footer shows real data.
  // Falls back gracefully when Supabase isn't configured (e.g. local dev without env).
  let userEmail: string | undefined
  let isPro = false
  let dealCount: number | undefined

  if (supabaseEnv().configured) {
    try {
      const supabase = await createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        userEmail = user.email
        const [pro, { count }] = await Promise.all([
          getProStatus(user.id),
          supabase.from("deals").select("id", { count: "exact", head: true }),
        ])
        isPro = pro.isPro
        dealCount = count ?? undefined
      }
    } catch {
      // Non-fatal — sidebar just shows guest state
    }
  }

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} dark bg-background`}>
      <body className="font-sans antialiased">
        <SidebarProvider>
          <AppSidebar userEmail={userEmail} isPro={isPro} dealCount={dealCount} />
          <main className="flex-1 overflow-auto">{children}</main>
        </SidebarProvider>
        {process.env.NODE_ENV === "production" && <Analytics />}
      </body>
    </html>
  )
}
