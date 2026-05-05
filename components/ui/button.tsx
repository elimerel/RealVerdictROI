import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

// Backward-compat shim — RealVerdict's existing codebase uses two APIs
// that aren't in the stock shadcn Button:
//
//   1. `variant="primary"` — mapped to `variant="default"` (same visual)
//   2. `icon={<Icon />}` — places the icon at the START of children
//   3. `size="md"` — mapped to `size="default"`
//
// Without this shim, ~50 callsites across the app would need refactoring
// after a shadcn block install overwrites this file. The shim keeps the
// old call sites working while letting new code use the standard API.
type LegacyVariant = "primary"
type LegacySize    = "md"
type StandardVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>
type StandardSize    = NonNullable<VariantProps<typeof buttonVariants>["size"]>

interface ButtonProps extends Omit<ButtonPrimitive.Props, "size"> {
  variant?: StandardVariant | LegacyVariant
  size?:    StandardSize    | LegacySize
  /** Legacy prop — places an icon at the START of children. New code
   *  should put icons inline as children: <Button><Icon /> Text</Button>. */
  icon?:    React.ReactNode
}

function Button({
  className,
  variant = "default",
  size = "default",
  icon,
  children,
  ...props
}: ButtonProps) {
  // Map legacy variants/sizes to the standard shadcn API
  const mappedVariant: StandardVariant = variant === "primary" ? "default" : variant
  const mappedSize:    StandardSize    = size    === "md"      ? "default" : size
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant: mappedVariant, size: mappedSize, className }))}
      {...props}
    >
      {icon}
      {children}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
export type { ButtonProps }
