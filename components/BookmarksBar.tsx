"use client"

// BookmarksBar — Chrome's third chrome row, adapted for an investor.
// Quick-access shortcuts to the listing sites people actually use day
// to day. Clicking a site navigates the ACTIVE tab to that site (or
// opens a new tab if no Browse tab exists yet). Sits between
// AppTopBar and the route content; only shown on /browse, collapses
// to 0 height elsewhere.

import { usePathname, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

interface SiteShortcut {
  /** Display label */
  name:    string
  /** URL to navigate to */
  url:     string
  /** Hostname for favicon fetch — usually equals new URL(url).hostname */
  favicon: string
}

const SITES: SiteShortcut[] = [
  { name: "Zillow",      url: "https://www.zillow.com",      favicon: "zillow.com"      },
  { name: "Redfin",      url: "https://www.redfin.com",      favicon: "redfin.com"      },
  { name: "Realtor",     url: "https://www.realtor.com",     favicon: "realtor.com"     },
  { name: "Trulia",      url: "https://www.trulia.com",      favicon: "trulia.com"      },
  { name: "LoopNet",     url: "https://www.loopnet.com",     favicon: "loopnet.com"     },
  { name: "Auction",     url: "https://www.auction.com",     favicon: "auction.com"     },
  { name: "Crexi",       url: "https://www.crexi.com",       favicon: "crexi.com"       },
]

export default function BookmarksBar() {
  const pathname = usePathname()
  const router   = useRouter()
  const isBrowse = pathname.startsWith("/browse")

  const go = (url: string) => {
    // If we're already on /browse, ask main to navigate the active
    // tab. Otherwise route to /browse with a deep-link param so
    // BrowsePage picks it up.
    if (isBrowse && typeof window !== "undefined" && window.electronAPI?.navigate) {
      window.electronAPI.navigate(url).catch(() => {})
      return
    }
    router.push(`/browse?url=${encodeURIComponent(url)}`)
  }

  return (
    <div
      className="shrink-0 flex items-center"
      style={{
        // 32px on Browse, 0 elsewhere. Animated alongside
        // BrowseTabsRow + AppTopBar's mode crossfade so all three
        // chrome animations resolve together.
        height:          isBrowse ? 32 : 0,
        // SAME tone as AppTopBar so visually it's an extension of
        // the URL band — Chrome's bookmarks bar reads as one with
        // the toolbar above it.
        background:      "var(--rv-surface)",
        // Hairline below to separate chrome from page content.
        borderBottom:    isBrowse ? "0.5px solid var(--rv-border)" : "none",
        overflow:        "hidden",
        transition:      "height 160ms cubic-bezier(0.32, 0.72, 0, 1)",
        zIndex:          49,
      }}
    >
      <div
        className="flex items-center w-full h-full px-3 gap-1"
        style={{
          opacity:       isBrowse ? 1 : 0,
          pointerEvents: isBrowse ? "auto" : "none",
          transition:    "opacity 160ms cubic-bezier(0.32, 0.72, 0, 1)",
          WebkitAppRegion: "no-drag",
        } as React.CSSProperties}
      >
        {SITES.map((s) => (
          <ShortcutButton key={s.url} site={s} onClick={() => go(s.url)} />
        ))}
      </div>
    </div>
  )
}

function ShortcutButton({ site, onClick }: { site: SiteShortcut; onClick: () => void }) {
  return (
    <Button
      onClick={onClick}
      title={`Open ${site.name}`}
      variant="ghost"
      size="xs"
      className="text-[12px] h-[24px]"
      style={{ color: "var(--rv-t2)" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://www.google.com/s2/favicons?domain=${site.favicon}&sz=32`}
        alt=""
        width={16}
        height={16}
        style={{ width: 16, height: 16, borderRadius: 3 }}
      />
      <span className="leading-none">{site.name}</span>
    </Button>
  )
}
