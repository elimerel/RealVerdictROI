"use client"

// Button — unified, shadcn-backed.
//
// Foundation: shadcn's Button (Radix Slot + cva variants, Tailwind
// classes that consume our themed CSS variables). Existing call sites
// across the app pass our legacy API (variant: "primary" | "secondary"
// | "ghost", size: "sm" | "md", icon: ReactNode); newer call sites can
// pass shadcn's full API. Both work — the legacy props are mapped at
// the boundary so EVERY button across the app inherits the shadcn
// look automatically without per-file migration.

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:     "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        outline:     "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground",
        secondary:   "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
        ghost:       "hover:bg-accent hover:text-accent-foreground",
        destructive: "bg-destructive text-white shadow-xs hover:bg-destructive/90",
        link:        "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:    "h-9 px-4 py-2 has-[>svg]:px-3",
        xs:         "h-7 rounded-md gap-1.5 px-2.5 text-xs has-[>svg]:px-2",
        sm:         "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg:         "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon:       "size-9",
        "icon-xs":  "size-7",
        "icon-sm":  "size-8",
        "icon-lg":  "size-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

// Legacy API support — every existing call site uses one of these
// shapes. Mapped to shadcn's variant/size at the boundary so the
// app gains the shadcn look without touching call sites.
type LegacyVariant = "primary" | "secondary" | "ghost"
type LegacySize    = "sm" | "md"
type ShadcnVariant = "default" | "outline" | "secondary" | "ghost" | "destructive" | "link"
type ShadcnSize    = "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg"

const legacyVariantMap: Record<LegacyVariant, ShadcnVariant> = {
  primary:   "default",
  secondary: "secondary",
  ghost:     "ghost",
}
const legacySizeMap: Record<LegacySize, ShadcnSize> = {
  sm: "sm",
  md: "default",
}

type ButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "size"> & {
  variant?: LegacyVariant | ShadcnVariant
  size?:    LegacySize    | ShadcnSize
  /** Legacy: optional leading icon. Renders before children. New code
   *  can put icons inline as children — both work. */
  icon?:    React.ReactNode
  /** Disables the button while in-flight; kept for legacy compat. */
  loading?: boolean
  asChild?: boolean
}

export function Button({
  variant: rawVariant = "secondary",
  size:    rawSize    = "md",
  icon,
  loading,
  className,
  children,
  disabled,
  asChild = false,
  ...rest
}: ButtonProps) {
  const variant = (rawVariant in legacyVariantMap)
    ? legacyVariantMap[rawVariant as LegacyVariant]
    : rawVariant as ShadcnVariant
  const size = (rawSize in legacySizeMap)
    ? legacySizeMap[rawSize as LegacySize]
    : rawSize as ShadcnSize

  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      {...rest}
    >
      {icon}
      {children}
    </Comp>
  )
}

export { buttonVariants }
