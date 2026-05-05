import type { Metadata, Viewport } from "next"
import localFont from "next/font/local"
import { TooltipProvider } from "@/components/ui/tooltip"
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

// Source Serif 4 Variable — the typographic anchor for hero numbers and
// display text. Replaces the previous ui-serif/Charter/Georgia fallback
// chain which rendered differently across machines. Source Serif is
// designed for both display and body, free, and ships in a single
// ~50KB variable file. Loaded as a Next/font/local so it preloads with
// the page (no FOIT) and is scoped to the --font-display variable.
const display = localFont({
  src: [{ path: "./fonts/SourceSerif4-Variable.woff2", weight: "200 900", style: "normal" }],
  variable: "--font-display",
  display: "swap",
  preload: true,
  fallback: ["ui-serif", "Charter", "Georgia", "serif"],
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
// Theme picks (matches main.js + lib/electron.ts):
//   paper        → cream + sage TweakCN light (THE LIGHT)
//   paper-dark   → matching TweakCN dark (THE DARK)
//   system       → resolves to paper or paper-dark via prefers-color-scheme
//
// Legacy picks (charcoal-warm, charcoal-cinema, light, dark) all roll
// forward to either paper or paper-dark on next load. The old themes
// CSS classes are still present in globals.css for now; they'll be
// removed in a follow-up sweep.
const THEME_SCRIPT = `(function(){try{
  var picked = localStorage.getItem('rv-theme') || 'system';
  // Roll legacy picks forward to the paper palette. These were the
  // pre-rebrand options; the user's saved pick may still be one of
  // these. Map them to the closest paper variant.
  if (picked === 'charcoal-warm' || picked === 'charcoal-cinema' || picked === 'dark') {
    picked = 'paper-dark';
    localStorage.setItem('rv-theme', 'paper-dark');
  }
  if (picked === 'light') {
    picked = 'paper';
    localStorage.setItem('rv-theme', 'paper');
  }
  var resolved = picked;
  if (picked === 'system') {
    resolved = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'paper-dark' : 'paper';
  }
  var cls = document.documentElement.classList;
  cls.remove('theme-charcoal-warm', 'theme-charcoal-cinema', 'theme-light', 'theme-paper', 'theme-paper-dark');
  if (resolved === 'paper')      cls.add('theme-paper');
  if (resolved === 'paper-dark') cls.add('theme-paper-dark');
  // .dark drives any remaining \`dark:\` Tailwind variants. paper is light, paper-dark is dark.
  if (resolved === 'paper-dark') cls.add('dark'); else cls.remove('dark');
}catch(e){}})();`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable} ${display.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body style={{ fontFamily: "var(--font-inter), -apple-system, BlinkMacSystemFont, system-ui, sans-serif" }} suppressHydrationWarning>
        <TooltipProvider delay={300}>
          {children}
        </TooltipProvider>
      </body>
    </html>
  )
}
