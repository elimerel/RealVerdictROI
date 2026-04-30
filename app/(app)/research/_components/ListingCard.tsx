"use client"

import { cn } from "@/lib/utils"
import { MapPin, Home, Calendar, Building } from "lucide-react"
import { formatCurrency } from "@/lib/calculations"
import type { VerdictTier } from "@/lib/calculations"

export type ListingCardData = {
  address?: string
  purchasePrice?: number
  beds?: number | null
  baths?: number | null
  sqft?: number | null
  yearBuilt?: number | null
  propertyType?: string | null
  photos?: string[]
  /** Verdict is accepted for back-compat but never rendered. */
  verdict?: VerdictTier
}

export default function ListingCard({ data }: { data: ListingCardData }) {
  const { address, purchasePrice, beds, baths, sqft, yearBuilt, propertyType, photos } = data

  return (
    <div className="flex flex-col h-full bg-card overflow-hidden">
      {/* Photo area */}
      <div className="relative shrink-0 aspect-[16/9] bg-zinc-900 overflow-hidden">
        {photos && photos.length > 0 ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photos[0]}
            alt={address ?? "Property photo"}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <PropertyIllustration />
            <p className="text-[11px] text-muted-foreground/40 font-mono uppercase tracking-wider">
              No photos available
            </p>
          </div>
        )}

        {/* Asking price overlay */}
        {purchasePrice && (
          <div className="absolute bottom-3 left-3 px-2.5 py-1.5 rounded-md bg-black/60 backdrop-blur-sm">
            <p className="text-sm font-mono font-bold tabular-nums text-white">
              {formatCurrency(purchasePrice, 0)}
            </p>
            <p className="text-[10px] text-white/60 uppercase tracking-wider">Asking</p>
          </div>
        )}
      </div>

      {/* Property details */}
      <div className="p-5 flex-1 space-y-4">
        {/* Address */}
        {address && (
          <div className="flex gap-2 items-start">
            <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground/50" />
            <h2 className="text-sm font-semibold text-foreground leading-snug">{address}</h2>
          </div>
        )}

        {/* Specs grid */}
        <div className="grid grid-cols-2 gap-2.5">
          {beds != null && (
            <SpecItem icon={<Home className="h-3 w-3" />} label="Beds" value={`${beds}`} />
          )}
          {baths != null && (
            <SpecItem icon={<Home className="h-3 w-3" />} label="Baths" value={`${baths}`} />
          )}
          {sqft != null && (
            <SpecItem icon={<Building className="h-3 w-3" />} label="Sqft" value={sqft.toLocaleString()} />
          )}
          {yearBuilt != null && (
            <SpecItem icon={<Calendar className="h-3 w-3" />} label="Built" value={`${yearBuilt}`} />
          )}
          {propertyType && (
            <SpecItem icon={<Home className="h-3 w-3" />} label="Type" value={propertyType} className="col-span-2" />
          )}
        </div>

        {/* Photo thumbnails if multiple */}
        {photos && photos.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
            {photos.slice(1, 6).map((photo, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={photo}
                alt={`Photo ${i + 2}`}
                className="h-12 w-16 rounded object-cover shrink-0 opacity-80 hover:opacity-100 transition-opacity cursor-pointer"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SpecItem({
  icon,
  label,
  value,
  className,
}: {
  icon: React.ReactNode
  label: string
  value: string
  className?: string
}) {
  return (
    <div className={cn("flex items-center gap-2 rounded-lg border border-white/6 bg-white/3 px-3 py-2", className)}>
      <span className="text-muted-foreground/50">{icon}</span>
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/40">{label}</p>
        <p className="text-[13px] font-mono font-medium tabular-nums text-foreground">{value}</p>
      </div>
    </div>
  )
}

// Minimal SVG illustration for empty photo state
function PropertyIllustration() {
  return (
    <svg width="80" height="60" viewBox="0 0 80 60" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="10" y="28" width="60" height="28" rx="2" fill="currentColor" className="text-white/6" />
      <path d="M5 30 L40 8 L75 30" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-white/12" />
      <rect x="22" y="38" width="14" height="18" rx="1" fill="currentColor" className="text-white/8" />
      <rect x="44" y="38" width="14" height="12" rx="1" fill="currentColor" className="text-white/8" />
      <line x1="10" y1="56" x2="70" y2="56" stroke="currentColor" strokeWidth="1" className="text-white/10" />
    </svg>
  )
}
