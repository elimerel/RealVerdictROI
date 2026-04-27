import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} dark bg-background`}>
      <body className="font-sans antialiased">
        {children}
        {process.env.NODE_ENV === "production" && <Analytics />}
      </body>
    </html>
  )
}
