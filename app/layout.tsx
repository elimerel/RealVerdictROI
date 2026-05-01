import type { Metadata, Viewport } from "next"
import localFont from "next/font/local"
import { Analytics } from "@vercel/analytics/next"
import { THEME_INIT_SCRIPT } from "@/lib/theme"
import "./globals.css"

// ---------------------------------------------------------------------------
// Local fonts — bundled as woff2 files in app/fonts/.
// next/font/local self-hosts these alongside the rest of the static bundle and
// generates a metric-matched system fallback that prevents layout shift during
// the brief swap from fallback to webfont. There is no runtime CDN dependency
// and no Google Fonts request.
// ---------------------------------------------------------------------------

const inter = localFont({
  src: [
    { path: "./fonts/Inter-Variable.woff2",        weight: "100 900", style: "normal" },
    { path: "./fonts/Inter-Variable-Italic.woff2", weight: "100 900", style: "italic" },
  ],
  variable: "--font-inter",
  display: "swap",
  preload: true,
  // System fallbacks tuned to Inter's metrics — keeps line-heights stable while
  // the variable font is still loading.
  fallback: ["ui-sans-serif", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
})

// Variable name is --rv-font-mono (not --font-mono) so it doesn't collide
// with the Tailwind 4 @theme inline token name in globals.css.
const mono = localFont({
  src: [
    { path: "./fonts/JetBrainsMono-Variable.woff2", weight: "100 800", style: "normal" },
  ],
  variable: "--rv-font-mono",
  display: "swap",
  preload: true,
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
})

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "RealVerdict — Underwrite any rental listing instantly",
    template: "%s · RealVerdict",
  },
  description:
    "Browse Zillow, Redfin, and Realtor inside the app. DSCR, cash flow, and cap rate populate as you scroll.",
  openGraph: {
    type: "website",
    siteName: "RealVerdict",
    images: ["/api/og"],
  },
}

export const viewport: Viewport = {
  themeColor: "#08080f",
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // No theme class hardcoded: the inline THEME_INIT_SCRIPT in <head>
    // applies "dark" / "paper" / nothing-for-light synchronously before
    // first paint, based on the user's saved preference. SuppressHydrationWarning
    // because the server has no localStorage and renders a class that the
    // client may immediately swap for a different one.
    <html lang="en" className={`${inter.variable} ${mono.variable} bg-background`} suppressHydrationWarning>
      <head>
        {/* Avoid FOUC: apply the saved theme synchronously. Must run before
            React hydrates so the user never sees a flash of the wrong
            background color. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="font-sans antialiased" suppressHydrationWarning>
        {children}
        {process.env.NODE_ENV === "production" && <Analytics />}
      </body>
    </html>
  )
}
