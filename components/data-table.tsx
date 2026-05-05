// Placeholder for dashboard-01's sample data table. The shipped sample
// used a Base-UI `render` prop on DrawerTrigger that our drawer
// primitive doesn't support, so the original wouldn't type-check.
// We'll replace this entirely with TanStack Table when we build the
// real Pipeline data table — the dashboard-01 sample's value was its
// LAYOUT (Cards + Chart + SectionCards), not this table specifically.

export function DataTable<T>({ data: _data }: { data: T[] }) {
  return (
    <div className="rounded-lg border border-border bg-card p-6 text-center">
      <p className="text-sm text-muted-foreground">
        Pipeline table coming soon (TanStack Table integration).
      </p>
    </div>
  )
}
