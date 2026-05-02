import type { Metadata, Viewport } from "next"
import localFont from "next/font/local"
import "./globals.css"

const inter = localFont({
  src: [
    { path: "./fonts/Inter-Variable.woff2",        weight: "100 900", style: "normal" },
    { path: "./fonts/Inter-Variable-Italic.woff2", weight: "100 900", style: "italic" },
  ],
  variable: "--font-inter",
  display: "swap",
  preload: true,
  fallback: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "system-ui", "sans-serif"],
})

const mono = localFont({
  src: [{ path: "./fonts/JetBrainsMono-Variable.woff2", weight: "100 800", style: "normal" }],
  variable: "--font-mono",
  display: "swap",
  preload: true,
  fallback: ["SF Mono", "ui-monospace", "Menlo", "monospace"],
})

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "RealVerdict", template: "%s · RealVerdict" },
  description: "Analyze any rental property as you browse. AI reads the listing. Real math does the analysis.",
}

export const viewport: Viewport = {
  themeColor: "#0a0b11",
}

// Apply dark class synchronously before first paint — reads from localStorage
// so the user never sees a flash of the wrong theme.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('rv-theme');if(t==='dark')document.documentElement.classList.add('dark');}catch(e){}})();`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body style={{ fontFamily: "var(--font-inter), -apple-system, BlinkMacSystemFont, system-ui, sans-serif" }} suppressHydrationWarning>
        {children}
      </body>
    </html>
  )
}
