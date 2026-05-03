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

// Apply the theme class synchronously before first paint — reads from
// localStorage as the pre-paint hint (the IPC value from main.js is the
// source of truth, but it'd require an async round-trip and would cause
// a flash). The picker writes to localStorage immediately on change, so
// the next paint always lands on the right theme.
//
// Five options (matches main.js + lib/electron.ts):
//   system          → resolves to dark or light via prefers-color-scheme
//   dark            → no class needed (the :root tokens ARE dark)
//   charcoal-warm   → adds .theme-charcoal-warm
//   charcoal-cinema → adds .theme-charcoal-cinema
//   light           → adds .theme-light
//
// The .dark class also gets stamped for backwards compatibility with any
// remaining `dark:` Tailwind variants in the codebase.
const THEME_SCRIPT = `(function(){try{
  var picked = localStorage.getItem('rv-theme') || 'dark';
  // Migrate retired cinema choice to the closest live option (dark).
  if (picked === 'charcoal-cinema') { picked = 'dark'; localStorage.setItem('rv-theme', 'dark'); }
  var resolved = picked;
  if (picked === 'system') {
    resolved = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  var cls = document.documentElement.classList;
  cls.remove('theme-charcoal-warm', 'theme-charcoal-cinema', 'theme-light');
  if (resolved === 'charcoal-warm') cls.add('theme-charcoal-warm');
  if (resolved === 'light')         cls.add('theme-light');
  if (resolved === 'light') cls.remove('dark'); else cls.add('dark');
}catch(e){}})();`

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
